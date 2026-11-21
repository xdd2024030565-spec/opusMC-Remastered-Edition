# opusMC Remastered Edition

> ## 🎮 立即游玩：https://xdd2024030565-spec.github.io/opusMC-Remastered-Edition/
>
> 手机 / 电脑浏览器打开即可。首次进入输入存档密码（见下方），之后自动加载云端存档、自动保存。本仓库是个人学习 / 备份用途的游戏还原版。

网页版 Minecraft（OpusMC / YYMC）的个人还原版，游戏本体完整保留，**存档完全托管在 GitHub**：进入自动加载云端存档，游玩中自动保存，**本地不留任何存档**，刷新 / 换设备进度都不丢。

## 这是什么

- 原项目：B 站 UP「土豆味小哲」用 Claude Opus 开发的网页版 MC（2026-11 从 B 站下架）。
- 本项目使用原作者开源镜像 `OpusMCLLL/OpusMC-OpenSource` 的游戏本体（轻量版，首页仅 5KB，手机秒开），仅改造存档层与登录方式，游戏玩法、材质、手感与原网页版一致。
- 原项目说明见 [ORIGINAL_README.md](ORIGINAL_README.md)。

## 登录（存档密码）

游戏**不再使用 GitHub token、B站登录、识别码或离线账号**。入口统一为一个存档密码框：

1. 打开游戏页面（上方游玩链接），首次会弹出「登录 · 云端存档」。
2. 输入站点管理员告知的存档密码，点「登录并进入」。
3. 验证通过后自动从云端载入存档并进入游戏；密码错误无法进入，可重试。

- 密码只保存在当前浏览器 `localStorage` 的 `opusmc_remastered_password` 键里，**真实 GitHub token 永远只在 Cloudflare Worker 服务端**，浏览器接触不到。
- 密码验证在 Cloudflare Worker 完成（SHA-256 定长比较）；密码错误返回 401，前端不允许进入。
- 登录态只在本页内存中，**刷新页面需重新验证密码**（但密码已记住时自动静默验证，无感进入）。
- 游戏内的「登录」入口（左上角 / 选项 → 账号）也走同一个密码框，用于更换密码。

## 云端存档（核心）

| 行为 | 说明 |
| --- | --- |
| 进入游戏 | 自动从本仓库 `saves/main.json` 拉取存档并载入，无需任何操作 |
| 游玩中 | 任何存档变更（方块、背包、世界）约 1.2 秒后自动写入云端 |
| 兜底 | 每 5 秒检查一次，切后台 / 关页面时再存一次 |
| 本地 | 不写 IndexedDB、不写 localStorage 存档，旧存档会自动清除 |
| 上传/下载按钮 | **没有**——全自动，进度始终以云端为准 |

链路：浏览器 → Cloudflare Worker（校验密码、注入 token）→ GitHub Contents API。存档是 deflate 压缩后再转十六进制纯文本的 JSON（避开 GitHub API 对二进制的转码损坏），包含所有世界、区块、玩家背包与位置。云端**只有 `saves/main.json` 一个存档文件**。并发写入用 sha 乐观锁 + 串行队列 + 冲突重试，保证「存档始终是最新的、进度不丢失」。

## 打开游戏

- 在线（推荐）：<https://xdd2024030565-spec.github.io/opusMC-Remastered-Edition/>
- 本地：在本目录起一个静态服务器，例如 `python3 -m http.server 8080`，浏览器访问 `http://localhost:8080/`。

> 注意：需要通过 http(s) 打开（`file://` 下浏览器会拒绝跨域存档 API）。

## 操作

与网页版 MC 一致：WASD 移动、空格跳跃、鼠标左键破坏 / 右键放置、E 背包、Esc 菜单。手机端用屏幕触控（游戏内自带虚拟按键）。

## 管理员：部署与维护

- 站点：GitHub Pages（本仓库 `main` 分支根目录，已在 Settings → Pages 开启）；也可在帽子云导入本仓库做国内加速镜像。
- 存档代理：Cloudflare Worker `opusmc-save`，脚本 `worker-live.js`（仅管理员本地保存，含 GH token 与密码明文，**不要提交到本仓库**），通过 CF API 部署并绑定路由 `yongjiu.ccwu.cc/opusmc-save/*`。
- 更新密码 / 轮换 token：重新部署 Worker（改 `worker-live.js` 里的 `SAVE_PASSWORD` / `GITHUB_TOKEN` 常量），前端无需改动。
- GitHub token 最小权限：Fine-grained token，仅授权本仓库 **Contents: Read and write**；会定期轮换。

## 致谢

- 原作者：土豆味小哲（B 站），基于 Claude Opus 开发。
- 游戏本体镜像：[OpusMCLLL/OpusMC-OpenSource](https://github.com/OpusMCLLL/OpusMC-OpenSource)、[cswfwm/opusmc-web](https://github.com/cswfwm/opusmc-web)、[X1aoZhe/OpusMC](https://github.com/X1aoZhe/OpusMC)。
- 本项目为个人学习 / 备份用途，未用于任何商业行为。

## 隐私提示

本仓库为公开仓库（GitHub Pages 免费版要求），`saves/main.json` 的内容理论上公开可见。存档仅含游戏进度，不含 token 或个人敏感信息。若需私密，可把游戏站点与存档拆成两个仓库（存档仓库设 private，token 只授权私仓）。
