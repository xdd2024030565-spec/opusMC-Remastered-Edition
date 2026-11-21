# opusMC Remastered Edition

> ## 🎮 立即游玩（国内推荐，秒开）：https://opusmc-10h3d8c30u.maozi.io/
>
> 备用线路（GitHub Pages）：https://xdd2024030565-spec.github.io/opusMC-Remastered-Edition/
>
> 两个地址是同一份代码、同一个云端存档，随便用哪个，进度互通。手机 / 电脑浏览器打开即可。首次进入输入存档密码（见下方），之后自动加载云端存档、自动保存。本仓库是个人学习 / 备份用途的游戏还原版。

网页版 Minecraft（OpusMC / YYMC）的个人还原版，游戏本体完整保留，**存档完全托管在 GitHub**：进入自动加载云端存档，游玩中自动保存，**本地不留任何存档**，刷新 / 换设备进度都不丢。

## 这是什么

- 原项目：B 站 UP「土豆味小哲」用 Claude Opus 开发的网页版 MC（2026-11 从 B 站下架）。
- 游戏本体取自 2026-11-14 的最新开源镜像 `cswfwm/opusmc-web`（含原版 11-04 之后全部 bug 修复），并拆成「小首页 + 真实 js/ 目录 + 真实 mods/ 目录」的结构——首页只有 116KB，不再内联 24MB 数据块，手机不会卡在红色加载页。
- 只改造存档层与登录方式，游戏玩法、材质、手感、模组内容与原网页版一致。
- 原项目说明见 [ORIGINAL_README.md](ORIGINAL_README.md)。

## 内置模组

| 模组 | 说明 |
| --- | --- |
| 匠魂 Tinkers' Construct | 匠魂工具系统（141 个文件，含手册、冶炼炉、精灵图） |
| 农夫乐事 Farmer's Delight | 厨具、作物、食物（40 个文件，含音效） |
| 连锁挖矿 Veinminer | 挖一个方块挖掉整条矿脉 |
| 夜视 Night Vision | 可开关的夜视效果 |
| 移动光源 Dynamic Lights | 手持光源实时照亮周围 |
| 沉浸盔甲 Immersive Armor | 10 套材料 × 4 件 = 40 件盔甲，含专属穿戴层外观 |
| 匠魂教程地图 / 农夫乐事教程地图 | 打开即玩的示范世界 |

模组贴图与音效全部走真实文件路径（`mods/<id>/textures|sounds`），地形生成与区块网格化的 Web Worker 也会加载模组数据，所以模组方块在世界里显示正常、不会缺面。

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

## 世界管理

在「选择世界」界面可以：

- **编辑世界**：改名（随时可改）、切换游戏模式（生存 / 创造 / 旁观）、调整难度、开关「允许命令」。
  - 和原版一致：**没有开启「允许命令」时，游戏模式与难度是锁定的**（会提示原因）；极限模式下两者都锁死。「允许命令」本身在极限模式下也不能开。
  - 世界正在游玩中时改这几项，保存后立即生效。
- **删除世界**：**三次确认**（继续 → 我确定 → 永久删除）才会真正删除。
  - 如果删掉了最后一个世界，云端 `saves/main.json` 会**一并删除**（否则下次进入又会把旧进度拉回来，等于没删）。
  - 只要还剩至少一个世界，云端存档就保留，只删除该世界的方块与元数据。

## 打开游戏

- 国内（推荐，帽子云 CDN）：<https://opusmc-10h3d8c30u.maozi.io/>
- 备用（GitHub Pages）：<https://xdd2024030565-spec.github.io/opusMC-Remastered-Edition/>
- 本地：在本目录起一个静态服务器，例如 `python3 -m http.server 8080`，浏览器访问 `http://localhost:8080/`。

> 目录结构：`index.html`（小首页）+ `js/`（97 个游戏脚本，含 `cloud-github.js` 云存档层）+ `mods/`（8 个模组）。首页用真实的 `<script src>` 逐个加载，方便浏览器缓存与压缩传输。

> 注意：需要通过 http(s) 打开（`file://` 下浏览器会拒绝跨域存档 API）。

## 操作

与网页版 MC 一致：WASD 移动、空格跳跃、鼠标左键破坏 / 右键放置、E 背包、Esc 菜单。手机端用屏幕触控（游戏内自带虚拟按键）。

## 管理员：部署与维护

- 站点：帽子云（`opusmc-10h3d8c30u.maozi.io`，导入本仓库 `main` 分支，国内 CDN 加速，推送自动重建）+ GitHub Pages（`xdd2024030565-spec.github.io/opusMC-Remastered-Edition/`，备用）。两者同一份代码、同一云端存档。
- 帽子云保存密码后不需要重复配置：GitHub 仓库授权后推送即自动部署。
- 存档代理：Cloudflare Worker `opusmc-save`，脚本 `worker-live.js`（仅管理员本地保存，含 GH token 与密码明文，**不要提交到本仓库**），通过 CF API 部署并绑定路由 `yongjiu.ccwu.cc/opusmc-save/*`。
- 更新密码 / 轮换 token：重新部署 Worker（改 `worker-live.js` 里的 `SAVE_PASSWORD` / `GITHUB_TOKEN` 常量），前端无需改动。
- GitHub token 最小权限：Fine-grained token，仅授权本仓库 **Contents: Read and write**；会定期轮换。

## 致谢

- 原作者：土豆味小哲（B 站），基于 Claude Opus 开发。
- 游戏本体镜像：[OpusMCLLL/OpusMC-OpenSource](https://github.com/OpusMCLLL/OpusMC-OpenSource)、[cswfwm/opusmc-web](https://github.com/cswfwm/opusmc-web)、[X1aoZhe/OpusMC](https://github.com/X1aoZhe/OpusMC)。
- 本项目为个人学习 / 备份用途，未用于任何商业行为。

## 隐私提示

本仓库为公开仓库（GitHub Pages 免费版要求），`saves/main.json` 的内容理论上公开可见。存档仅含游戏进度，不含 token 或个人敏感信息。若需私密，可把游戏站点与存档拆成两个仓库（存档仓库设 private，token 只授权私仓）。
