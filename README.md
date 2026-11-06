# QQ Music for MyGo Music

[MyGo Music](https://github.com/egoist/mygo-music) 的 QQ 音乐插件。直接搜索、浏览、播放 QQ 音乐曲库，扫码登录后可听"我喜欢"的歌单、看自己的昵称头像。

[![安装到 MyGo Music](https://img.shields.io/badge/安装-mygo--music%3A%2F%2Finstall--plugin-blue)](https://github.com/dddaniel1/mygo-plugin-qqmusic)

## 安装

在 MyGo Music 的 **设置 → 插件 → +** 里输入仓库地址 `dddaniel1/mygo-plugin-qqmusic`，确认安装即可。

也可以手动：把本仓库克隆或下载后，将整个文件夹放进 MyGo Music 的插件目录（设置 → 插件 → ⋯ → 打开插件文件夹），重启应用。

## 功能

- **搜索**：歌曲、专辑、歌手、歌单；输入联想
- **首页**：热歌、新碟上架、排行榜入口、精选歌单
- **排行榜**：飙升榜、热歌榜、新歌榜、流行指数等全部官方榜单，分页浏览
- **新碟上架**：按地区浏览最新专辑
- **精选歌单**：华语 / 流行 / 欧美 / 轻音乐等分类，整份播放
- **专辑页 / 歌手页**：完整歌曲列表（歌手页通过按歌手名搜索聚合）
- **我喜欢**：登录后看到自己在 QQ 音乐里红心的歌
- **歌词**：LRC 歌词 + 翻译（有翻译的歌显示双语）
- **音质**：standard / high / lossless（超出账号权益的歌，QQ 音乐会返回 60 秒试听）

## 登录

设置 → 插件 → QQ Music → **Sign In**，应用会打开 y.qq.com 的登录窗口：

1. 点页面右上角的 QQ 图标
2. 用手机 QQ 扫描二维码（或输入账号密码）
3. 登录成功后窗口自动关闭

登录后显示你的 QQ 昵称和头像，侧边栏多出"我喜欢"。匿名状态下免费歌曲可直接播放。

## 实现说明

- 全部走 QQ 音乐 Web 端**免签名**接口（`client_search_cp`、`musicu.fcg` 的 `musicToplist` / `newalbum` / `srfDissInfo` / `musichallAlbum` / `vkey.GetVkeyServer`、`fcg_get_profile_homepage` 等），已在 2026-11 实测可用，无需内嵌官方 VMP 签名/加密引擎。
- `g_tk` 按 `hash33(qm_keyst)` 动态计算，匿名时为默认 5381。
- 播放地址：`vkey.GetVkeyServer` 返回的 `sip + purl`，音质代码用 2026 年的 `RS01/RS02/RS03`（老的 `M500/M800/F000` 对登录态已失效）；vkey 与本机生成的 `guid` 绑定。
- 歌单接口的 `disstid` 必须是数字；歌手详情与专辑曲目列表对匿名请求关闭，插件用"按名称搜索 + 按 mid 过滤"的降级方案聚合。
- 用户的昵称、头像与"我喜欢"列表 id 来自网页版播放器的个人主页 CGI（`fcg_get_profile_homepage`），仅登录后可用。

## 声明

仅供个人学习与本地播放使用，请勿用于商业用途；歌曲版权归腾讯与权利方所有。
