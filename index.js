// QQ Music for MyGo Music.
//
// Browse and search QQ Music anonymously, or sign in with your QQ account
// (Settings > Plugins > QQ Music > Sign In, through the app's sign-in window)
// to play what needs an account, such as VIP tracks.
//
// Verified against QQ Music's web endpoints, no signing server needed:
//   search        c.y.qq.com/soso/fcgi-bin/client_search_cp
//   suggest       c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg
//   charts        u.y.qq.com/cgi-bin/musicu.fcg  musicToplist.ToplistInfoServer
//   new albums    u.y.qq.com/cgi-bin/musicu.fcg  newalbum.NewAlbumServer
//   playlist      u.y.qq.com/cgi-bin/musicu.fcg  music.srfDissInfo.aiDissInfo
//   album info    u.y.qq.com/cgi-bin/musicu.fcg  music.musichallAlbum.AlbumInfoServer
//   stream (vkey) u.y.qq.com/cgi-bin/musicu.fcg  vkey.GetVkeyServer
//   lyrics        c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg
// A track ID is its songmid, an album ID its albummid, and an artist ID
// carries its name ("ar:<singerMid>:<name>") because singer pages are not
// open to anonymous calls, so their page is a search over the singer's name.

const REF = "https://y.qq.com/";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const t = (s) => host.t(s);
const load = (k, f) => host.storage.get(k) ?? f;
const save = (k, v) => host.storage.set(k, v);

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// g_tk, as QQ Music computes it from the login key; 5381 when anonymous.
function hash33(s) {
  let n = 5381;
  for (let i = 0; i < s.length; i++) n += (n << 5) + s.charCodeAt(i);
  return n & 0x7fffffff;
}

// Base64 to text, in plain JavaScript: the sandbox may have no atob.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function utf8(bytes) {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const a = bytes.charCodeAt(i);
    if (a < 0x80) {
      out += String.fromCharCode(a);
      i += 1;
    } else if (a < 0xe0) {
      out += String.fromCharCode(((a & 0x1f) << 6) | (bytes.charCodeAt(i + 1) & 0x3f));
      i += 2;
    } else if (a < 0xf0) {
      out += String.fromCharCode(
        ((a & 0x0f) << 12) |
          ((bytes.charCodeAt(i + 1) & 0x3f) << 6) |
          (bytes.charCodeAt(i + 2) & 0x3f),
      );
      i += 3;
    } else {
      out += String.fromCodePoint(
        ((a & 0x07) << 18) |
          ((bytes.charCodeAt(i + 1) & 0x3f) << 12) |
          ((bytes.charCodeAt(i + 2) & 0x3f) << 6) |
          (bytes.charCodeAt(i + 3) & 0x3f),
      );
      i += 4;
    }
  }
  return out;
}
function b64decode(s) {
  if (!s) return "";
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return utf8(out);
}

// The login state: the cookie the app captured when the listener signed in
// through the sign-in window (scan the QR with the QQ mobile app).
function rawCookie() {
  return (load("cookie", "") || "").trim();
}
function cookieValue(name) {
  const m = rawCookie().match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
function signedIn() {
  return !!cookieValue("qm_keyst");
}
function uin() {
  const u = cookieValue("uin") || cookieValue("qqmusic_uin") || "";
  return u.replace(/^o/, "").replace(/^0+/, "") || "0";
}
function gtk() {
  const k = cookieValue("qm_keyst");
  return k ? hash33(k) : 5381;
}

// A client id QQ Music's stream URLs are bound to; one per install.
function guid() {
  let g = load("guid", "");
  if (!g) {
    g = String(Math.floor(1e9 + Math.random() * 9e9));
    save("guid", g);
  }
  return g;
}

// songmid -> the middle of its file name on the CDN (media_mid), remembered
// as tracks are seen, so stream() can ask for the right file.
function rememberMedia(songmid, mediaMid) {
  if (!songmid || !mediaMid) return;
  const m = load("mediaMid", {});
  if (m[songmid] === mediaMid) return;
  m[songmid] = mediaMid;
  const keys = Object.keys(m);
  if (keys.length > 4000) for (const k of keys.slice(0, 600)) delete m[k];
  save("mediaMid", m);
}
function mediaOf(songmid) {
  return load("mediaMid", {})[songmid] || songmid;
}

// --- network ---

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

async function fetchJson(url, withAuth) {
  const key = (withAuth ? "auth" : "") + "|" + url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  const headers = { referer: REF, "user-agent": UA };
  const cookie = withAuth
    ? "uin=" + uin() + "; qm_keyst=" + cookieValue("qm_keyst") + "; qqmusic_key=" + cookieValue("qm_keyst") + "; tmeLoginType=2"
    : "";
  if (cookie && cookieValue("qm_keyst")) headers.cookie = cookie;
  const res = await fetch(url, { headers });
  if (!res.ok) throw fail("unavailable", "HTTP " + res.status);
  const j = JSON.parse((await res.text()).replace(/^\w+\(|\)$/g, ""));
  cache.set(key, { t: Date.now(), v: j });
  return j;
}

// The one CGI most modules answer through, GET with the data in the query.
function musicu(data) {
  return fetchJson(
    "https://u.y.qq.com/cgi-bin/musicu.fcg?g_tk=" + gtk() + "&format=json&data=" + encodeURIComponent(JSON.stringify(data)),
    true,
  );
}

// The listener's profile page: their nickname, avatar and the id of their
// "我喜欢" playlist. The web player's own profile page asks the same CGI.
async function myProfile() {
  if (!signedIn()) return null;
  const id = uin();
  const r = await fetchJson(
    "https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&uin=861397272&g_tk_new_20200303=" +
      gtk() + "&g_tk=725250446&cid=205360838&userid=" + id + "&reqfrom=1&reqtype=0&hostUin=0&loginUin=" + id,
    true,
  );
  const creator = (r.data && r.data.creator) || {};
  return { nick: creator.nick || "", avatar: creator.headpic || "" };
}

// The id of the listener's "我喜欢" list, kept once found: the profile page
// of the web player links it as taoge.html?id=...
async function likedListId() {
  const known = load("likedListId", "");
  if (known) return known;
  const r = await fetchJson(
    "https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&uin=861397272&g_tk_new_20200303=" +
      gtk() + "&g_tk=725250446&cid=205360838&userid=" + uin() + "&reqfrom=1&reqtype=0&hostUin=0&loginUin=" + uin(),
    true,
  );
  const items = (r.data && r.data.mymusic) || [];
  for (const it of items) {
    const m = String(it.jumpurl || "").match(/[?&]id=(\d+)/);
    if (m && (it.title === "我喜欢" || it.title === "I Like")) {
      save("likedListId", m[1]);
      return m[1];
    }
  }
  return "";
}

function searchSongs(query, page, n) {
  return fetchJson(
    "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?ct=24&qqmusic_ver=1298&remoteplace=txt.yqq.top&t=0&aggr=1&cr=1&catZhida=0&lossless=0&flag_qc=0&p=" +
      page + "&n=" + n + "&w=" + encodeURIComponent(query) + "&format=json&g_tk=" + gtk(),
    true,
  );
}

// --- shapes ---

const cover = (albumMid) =>
  albumMid ? "https://y.gtimg.cn/music/photo_new/T002R500x500M000" + albumMid + ".jpg" : "";

function artistRef(a) {
  return { id: "ar:" + (a.mid || "") + ":" + (a.name || ""), name: a.name || "" };
}

function toSong(s) {
  const mid = s.songmid || s.mid || "";
  const albumMid = s.albummid || (s.album && s.album.mid) || "";
  rememberMedia(mid, s.media_mid || (s.file && s.file.media_mid) || "");
  return {
    id: mid,
    name: s.songname || s.name || "",
    artists: (s.singer || []).map(artistRef),
    album: { id: albumMid, name: s.albumname || (s.album && s.album.name) || "", imageUrl: cover(albumMid) },
    duration: (s.interval || 0) * 1000,
    url: "https://y.qq.com/n/ryqq/songDetail/" + mid,
  };
}

function toPlaylist(p) {
  return {
    id: String(p.dissid ?? p.diss_tid ?? ""),
    name: p.dissname || "",
    imageUrl: p.imgurl || "",
    trackCount: p.song_count ?? p.songnum ?? 0,
    owner: p.nickname || (p.creator && p.creator.nick) || "",
  };
}

// --- pages' sources ---

async function toplistPage(topId, offset, num, period) {
  const ask = (p) =>
    musicu({
      comm: { ct: 24, cv: 0 },
      detail: {
        module: "musicToplist.ToplistInfoServer",
        method: "GetDetail",
        param: p === undefined ? { topId: Number(topId), offset: offset, num: num } : { topId: Number(topId), offset: offset, num: num, period: p },
      },
    });
  let r = await ask(period);
  let d = r.detail && r.detail.data;
  if (!d || !d.data) throw fail("unavailable", "chart not found");
  const real = d.data.period;
  if (real && real !== period) {
    r = await ask(real);
    d = r.detail && r.detail.data;
  }
  return {
    title: d.data.title,
    period: d.data.period,
    total: d.data.totalNum || 0,
    tracks: (d.songInfoList || []).map(toSong),
  };
}

async function toplistGroups() {
  const r = await musicu({
    comm: { ct: 23, cv: 0 },
    topList: { module: "musicToplist.ToplistInfoServer", method: "GetAll", param: {} },
  });
  const groups = (r.topList && r.topList.data && r.topList.data.group) || [];
  const out = [];
  for (const g of groups) {
    for (const tl of g.toplist || []) {
      out.push({ id: tl.topId, title: tl.title, imageUrl: tl.headPicUrl || tl.frontPicUrl || "" });
    }
  }
  return out.filter((x) => x.id && x.title).slice(0, 24);
}

async function newAlbums(sin, num) {
  const r = await musicu({
    comm: { ct: 24, cv: 1859 },
    na: { module: "newalbum.NewAlbumServer", method: "get_new_album_info", param: { area: 1, sin: sin, num: num } },
  });
  const list = (r.na && r.na.data && r.na.data.albums) || [];
  return list.map((a) => ({
    id: a.mid,
    name: a.name || "",
    imageUrl: cover(a.mid),
    artists: (a.singers || []).map((s) => ({ id: "ar:" + (s.mid || "") + ":" + (s.name || ""), name: s.name || "" })),
    released: a.publish_date || a.pubTime || "",
  }));
}

async function featuredPlaylists(query, n) {
  const r = await fetchJson(
    "https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist&page_no=0&num_per_page=" +
      n + "&query=" + encodeURIComponent(query) + "&format=json",
  );
  return ((r.data && r.data.list) || []).map(toPlaylist);
}

// --- account ---

// The app opens y.qq.com's own login page in a window of its own: scan the
// QR code there with the QQ mobile app (or sign in by account), and once the
// login cookies appear the window closes and the plugin keeps them. The
// Cookie setting below stays as a fallback.
export async function signIn() {
  const res = await host.webSignIn({
    url: "https://y.qq.com/",
    cookiesOf: "https://y.qq.com/",
    until: ["uin", "qm_keyst"],
    userAgent: UA,
  });
  if (res && res.cookie) save("cookie", res.cookie);
  cache.clear();
  return account();
}

export function signOut() {
  host.storage.remove("cookie");
  cache.clear();
}

export function account() {
  if (!signedIn()) return null;
  const id = uin();
  // Fetch the real nickname and avatar, best effort; fall back to the QQ id.
  try {
    return cacheOnce("account:" + id, 60, async () => {
      const p = await myProfile().catch(() => null);
      return { id: id, name: (p && p.nick) || "QQ " + id, imageUrl: (p && p.avatar) || "" };
    });
  } catch (e) {
    return { id: id, name: "QQ " + id };
  }
}

// A tiny promise cache for values asked often.
const onceCache = new Map();
function cacheOnce(key, seconds, make) {
  const hit = onceCache.get(key);
  if (hit && Date.now() - hit.t < seconds * 1000) return hit.v;
  const v = make();
  onceCache.set(key, { t: Date.now(), v: v });
  return v;
}

export function setSetting() {
  cache.clear();
}

// --- pages ---

// The listener's liked songs: their "我喜欢" playlist on QQ Music.
export async function liked({ offset }) {
  const id = await likedListId();
  if (!id) return { tracks: [], more: false };
  const NUM = 100;
  const r = await musicu({
    comm: { uin: uin(), ct: 24, cv: 4747474, format: "json", platform: "yqq.json", needNewCode: 1 },
    pl: {
      module: "music.srfDissInfo.aiDissInfo",
      method: "uniform_get_Dissinfo",
      param: { song_begin: Number(offset) || 0, song_num: NUM, disstid: Number(id), ctx: 1 },
    },
  });
  const d = r.pl && r.pl.data;
  const list = (d && d.songlist) || [];
  const tracks = list.map((it) => toSong(it.songinfo || it)).filter((s) => s.id);
  const total = (d && d.total_song_num) || 0;
  return { tracks: tracks, more: total > (Number(offset) || 0) + tracks.length };
}

export async function home() {
  const [hot, fresh, tops, feat] = await Promise.all([
    toplistPage(26, 0, 10).catch(() => null), // 热歌榜
    newAlbums(0, 10).catch(() => null),
    toplistGroups().catch(() => null),
    featuredPlaylists("华语", 8).catch(() => []),
  ]);
  const sections = [];
  if (hot && hot.tracks.length) sections.push({ title: t("Hot Songs"), tracks: hot.tracks });
  if (fresh && fresh.length) {
    const sec = { title: t("New Releases"), albums: fresh };
    if (fresh.length >= 10) sec.morePage = "newalbums|10";
    sections.push(sec);
  }
  if (tops && tops.length)
    sections.push({
      title: t("Charts"),
      links: tops.slice(0, 12).map((x) => ({ title: x.title, imageUrl: x.imageUrl, page: "top:" + x.id })),
    });
  if (feat.length) sections.push({ title: t("Featured Playlists"), playlists: feat });
  return { title: t("QQ Music"), sections: sections };
}

export async function browse({ page }) {
  const raw = String(page);
  const kind = raw.split(/[|:]/)[0];

  if (kind === "charts") {
    const tops = await toplistGroups();
    return {
      title: t("Charts"),
      sections: [{ title: t("All charts"), links: tops.map((x) => ({ title: x.title, imageUrl: x.imageUrl, page: "top:" + x.id })) }],
    };
  }

  if (kind === "top") {
    // top:<topId>|<period>|<offset>
    const parts = raw.slice(4).split("|");
    const NUM = 30;
    const p = await toplistPage(Number(parts[0]), Number(parts[2] || 0), NUM, parts[1] || undefined);
    const sec = { title: p.title, tracks: p.tracks };
    if (p.total > Number(parts[2] || 0) + NUM) sec.morePage = "top:" + parts[0] + "|" + p.period + "|" + (Number(parts[2] || 0) + NUM);
    return { title: p.title || t("Charts"), sections: [sec] };
  }

  if (kind === "newalbums") {
    const NUM = 20;
    const sin = Number(raw.slice(10) || 0);
    const albums = await newAlbums(sin, NUM);
    const sec = { title: t("New Releases"), albums: albums };
    if (albums.length >= NUM) sec.morePage = "newalbums|" + (sin + NUM);
    return { title: t("New Releases"), sections: [sec] };
  }

  if (kind === "playlists") {
    const cats = ["华语", "流行", "欧美", "轻音乐", "影视原声", "电子"];
    const lists = await Promise.all(cats.map((c) => featuredPlaylists(c, 10).catch(() => [])));
    return {
      title: t("Featured Playlists"),
      subtitle: t("Open one to hear it whole"),
      sections: cats.map((c, i) => ({ title: c, playlists: lists[i] })),
    };
  }

  throw fail("unavailable", "no such page");
}

// --- search ---

export async function search({ query, kind, offset }) {
  const PAGE = 30;
  if (kind === "tracks") {
    const page = Math.floor(offset / PAGE) + 1;
    const r = await searchSongs(query, page, PAGE);
    const song = (r.data && r.data.song) || {};
    return { tracks: (song.list || []).map(toSong), more: (song.totalnum || 0) > page * PAGE };
  }
  if (kind === "albums" || kind === "artists") {
    // Singer and album searches are closed to anonymous calls, so derive
    // them from a track search instead.
    const r = await searchSongs(query, 1, 60);
    const list = ((r.data && r.data.song) || {}).list || [];
    if (kind === "albums") {
      const albums = [];
      const seen = new Set();
      for (const s of list) {
        const mid = s.albummid;
        if (!mid || seen.has(mid)) continue;
        seen.add(mid);
        albums.push({ id: mid, name: s.albumname || "", imageUrl: cover(mid), artists: (s.singer || []).map(artistRef) });
        if (albums.length >= 20) break;
      }
      return { albums: albums.slice(offset, offset + 20), more: albums.length > offset + 20 };
    }
    const artists = [];
    const seen = new Set();
    for (const s of list) {
      for (const a of s.singer || []) {
        if (!a.mid || seen.has(a.mid)) continue;
        seen.add(a.mid);
        artists.push(artistRef(a));
        if (artists.length >= 20) break;
      }
      if (artists.length >= 20) break;
    }
    return { artists: artists.slice(offset, offset + 20), more: artists.length > offset + 20 };
  }
  if (kind === "playlists") {
    const page = Math.floor(offset / 20);
    const r = await fetchJson(
      "https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist&page_no=" +
        page + "&num_per_page=20&query=" + encodeURIComponent(query) + "&format=json",
    );
    const list = (r.data && r.data.list) || [];
    return { playlists: list.map(toPlaylist), more: list.length >= 20 };
  }
  return {};
}

export async function suggest({ query }) {
  const r = await fetchJson(
    "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=" + encodeURIComponent(query) + "&g_tk=" + gtk() + "&format=json",
  );
  const d = r.data || {};
  const out = [];
  const seen = new Set();
  for (const s of (d.song && d.song.itemlist) || []) out.push(s.name);
  for (const s of (d.singer && d.singer.itemlist) || []) out.push(s.name);
  for (const s of (d.album && d.album.itemlist) || []) out.push(s.name);
  return out.filter((x) => x && !seen.has(x) && seen.add(x)).slice(0, 10);
}

// --- albums, artists, playlists ---

export async function album({ id }) {
  const mid = String(id);
  const r = await musicu({
    comm: { ct: 24, cv: 1859 },
    album: { module: "music.musichallAlbum.AlbumInfoServer", method: "GetAlbumDetail", param: { albumMid: mid } },
  });
  const d = r.album && r.album.data;
  const basic = (d && d.basicInfo) || {};
  const name = basic.albumName || "";
  const singers = (d && d.singer && d.singer.singerList) || basic.singers || [];
  let tracks = [];
  if (name) {
    // The album's track list is not open to anonymous calls either, so
    // search the album's name and keep the songs that belong to it.
    const sr = await searchSongs(name, 1, 60);
    const list = ((sr.data && sr.data.song) || {}).list || [];
    tracks = list.filter((s) => (s.albummid || "") === mid).map(toSong);
    if (!tracks.length) tracks = list.filter((s) => (s.albumname || "") === name).map(toSong);
  }
  return {
    album: {
      id: mid,
      name: name,
      imageUrl: cover(mid),
      artists: singers.map((s) => ({ id: "ar:" + (s.mid || s.singer_mid || "") + ":" + (s.name || ""), name: s.name || "" })),
      released: basic.publishDate || "",
    },
    tracks: tracks,
  };
}

export async function artist({ id }) {
  const parts = String(id).split(":");
  const mid = parts[1] || "";
  const name = parts.slice(2).join(":");
  if (!name) throw fail("unavailable", "no such artist");
  const sr = await searchSongs(name, 1, 60);
  const list = ((sr.data && sr.data.song) || {}).list || [];
  let tracks = list.filter((s) => (s.singer || []).some((a) => a.mid === mid));
  if (!tracks.length) tracks = list.filter((s) => (s.singer || []).some((a) => a.name === name));
  const albums = [];
  const seen = new Set();
  for (const s of tracks) {
    const m = s.albummid;
    if (!m || seen.has(m)) continue;
    seen.add(m);
    albums.push({ id: m, name: s.albumname || "", imageUrl: cover(m) });
  }
  return {
    artist: { id: String(id), name: name },
    tracks: tracks.map(toSong),
    albums: albums.slice(0, 20),
  };
}

export async function playlist({ id }) {
  // disstid must be a number here, or the CGI answers 10006.
  const tid = Number(String(id)) || 0;
  if (!tid) throw fail("unavailable", "no such playlist");
  const NUM = 100;
  let items = [];
  let total = 0;
  let info = {};
  let begin = 0;
  for (let page = 0; page < 6; page++) {
    const r = await musicu({
      comm: { ct: 24, cv: 1859 },
      pl: {
        module: "music.srfDissInfo.aiDissInfo",
        method: "uniform_get_Dissinfo",
        param: { song_begin: begin, song_num: NUM, disstid: tid, ctx: 1 },
      },
    });
    const d = r.pl && r.pl.data;
    if (!d) {
      if (r.pl && r.pl.code === 10006) throw fail("setup", t("Paste your QQ Music cookie in the plugin's settings to open this playlist"));
      throw fail("unavailable", "playlist not found");
    }
    info = d.dirinfo || info;
    const sl = d.songlist || [];
    items = items.concat(sl);
    total = d.total_song_num || total || items.length;
    begin += sl.length;
    if (!sl.length || items.length >= total) break;
  }
  const songs = items.map((it) => toSong(it.songinfo || it)).filter((s) => s.id);
  return {
    id: String(tid),
    name: info.title || t("Playlist"),
    imageUrl: info.picurl || info.logo || "",
    trackCount: total || songs.length,
    tracks: songs,
  };
}

// --- words and sound ---

export async function lyrics({ id }) {
  const mid = String(id);
  let lrc = "";
  let trans = "";
  // The play-page lyric service answers anonymously for most songs and is
  // the one that carries translations.
  try {
    const r = await musicu({
      comm: { uin: uin(), ct: 24, cv: 1859, format: "json", platform: "yqq.json" },
      req: { module: "music.musichallSong.PlayLyricInfo", method: "GetPlayLyricInfo", param: { songMID: mid, songID: 0 } },
    });
    const d = r.req && r.req.data;
    if (r.req && r.req.code === 0 && d) {
      lrc = b64decode(d.lyric || "");
      trans = b64decode(d.trans || "");
    }
  } catch (e) {
    // fall through to the plain lyric CGI
  }
  if (!lrc) {
    const r = await fetchJson(
      "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" + encodeURIComponent(mid) + "&g_tk=5381&format=json&nob=1",
    );
    lrc = b64decode(r.lyric || "");
    trans = b64decode(r.trans || "");
  }
  if (!lrc) throw fail("unavailable", t("No lyrics"));
  return trans ? { lrc: lrc, translation: trans } : { lrc: lrc };
}

export async function stream({ id }) {
  const mid = String(id);
  const media = mediaOf(mid);
  const q = (host.setting("quality") || "standard").trim().toLowerCase();
  // The web player's 2026 quality codes, best first: RS02 = 128k mp3 (what
  // M500 used to be), RS03 = 320k, RS01 = lossless master. Older prefixes
  // (M500/M800/F000) now answer 104003 for signed-in accounts, and RS02 is
  // what the web page itself asks for. A song beyond the account's rights
  // comes back as a 60s trial clip; nothing we can do about that here.
  const chain =
    q === "lossless"
      ? [["RS01", ".mp3"], ["RS02", ".mp3"]]
      : q === "high"
        ? [["RS03", ".mp3"], ["RS02", ".mp3"]]
        : [["RS02", ".mp3"]];
  for (const [prefix, ext] of chain) {
    const r = await musicu({
      req_0: {
        module: "vkey.GetVkeyServer",
        method: "CgiGetVkey",
        param: {
          guid: guid(),
          songmid: [mid],
          filename: [prefix + media + ext],
          songtype: [0],
          uin: uin(),
          loginflag: 1,
          platform: "20",
        },
      },
      comm: { uin: uin(), format: "json", ct: 24, cv: 0 },
    });
    const d = r.req_0 && r.req_0.data;
    const m = d && d.midurlinfo && d.midurlinfo[0];
    const sip = d && d.sip && d.sip.filter((s) => s)[0];
    if (m && m.purl && sip) return { url: sip + m.purl, type: "mp3" };
  }
  throw fail(
    signedIn() ? "unavailable" : "setup",
    signedIn() ? t("This track cannot be played (VIP or region limited)") : t("Paste your QQ Music cookie in the plugin's settings to play this track"),
  );
}
