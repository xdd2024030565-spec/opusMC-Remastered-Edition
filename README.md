# opusMC Remastered Edition

网页版 Minecraft（OpusMC / YYMC）的个人还原版，游戏本体完整保留，**存档完全托管在 GitHub**：进入自动加载云端存档，游玩中自动保存，**本地不留任何存档**，刷新 / 换设备进度都不丢。

## 这是什么

- 原项目：B 站 UP「土豆味小哲」用 Claude Opus 开发的网页版 MC（2026-11 从 B 站下架）。
- 本项目基于玩家搬运的开源镜像 `cswfwm/opusmc-web` 的游戏本体（`js/` + `mods/`），仅改造存档层，游戏玩法、材质、模组、手感与原网页版一致。
- 原项目说明见 [ORIGINAL_README.md](ORIGINAL_README.md)。

## 云端存档（核心）

| 行为 | 说明 |
| --- | --- |
| 进入游戏 | 自动从本仓库 `saves/main.json` 拉取存档并载入，无需任何操作 |
| 游玩中 | 任何存档变更（方块、背包、世界）约 1.2 秒后自动写入云端 |
| 兜底 | 每 5 秒检查一次，切后台 / 关页面时再存一次 |
| 本地 | 不写 IndexedDB、不写 localStorage 存档，旧存档会自动清除 |
| 上传/下载按钮 | **没有**——全自动，进度始终以云端为准 |

存档是 deflate 压缩的 JSON，包含所有世界、区块、玩家背包与位置。并发写入用 sha 乐观锁 + 串行队列 + 冲突重试，保证「存档始终是最新的、进度不丢失」。

## 首次使用（配置 token）

存档读写走 GitHub REST API，需要一个 Personal Access Token（只在本机浏览器保存，不是存档内容）：

1. 打开 <https://github.com/settings/personal-access-tokens/new>（Fine-grained token）。
2. Repository access 只选本仓库 `opusMC-Remastered-Edition`。
3. Permissions → **Contents: Read and write**（这一项即可）。
4. 生成后复制 token（`github_pat_...`）。
5. 打开游戏页面，首次会弹出输入框，粘贴 token 点「保存并开始」。

token 只存在当前浏览器 `localStorage` 的 `opusmc_remastered_token` 键里。若失效，控制台执行 `CloudGitHub.setToken('新token')` 即可。客户端标识 `opusmc_remastered_client` 仅用于区分设备，不含敏感信息。

## 打开游戏

- 在线：GitHub Pages <https://xdd2024030565-spec.github.io/opusMC-Remastered-Edition/>（仓库 Settings → Pages 需在 Source 选 `main` / root 开启）。
- 本地：本目录起一个静态服务器，例如 `python3 -m http.server 8080`，浏览器访问 `http://localhost:8080/`。

> 注意：需要通过 http(s) 打开（`file://` 下浏览器会拒绝跨域存档 API）。

## 已包含的模组

`mods/` 内含：匠魂 Tinkers' Construct、农夫乐事 Farmer's Delight、veinminer、nightvision、dynlights 及演示数据，与原玩家整合包一致。

## 操作

与网页版 MC 一致：WASD 移动、空格跳跃、鼠标左键破坏 / 右键放置、E 背包、Esc 菜单。手机端用屏幕触控（游戏内自带虚拟按键）。

## 致谢

- 原作者：土豆味小哲（B 站），基于 Claude Opus 开发。
- 游戏本体镜像：[cswfwm/opusmc-web](https://github.com/cswfwm/opusmc-web)、[OpusMCLLL/OpusMC-OpenSource](https://github.com/OpusMCLLL/OpusMC-OpenSource)、[X1aoZhe/OpusMC](https://github.com/X1aoZhe/OpusMC)。
- 本项目为个人学习 / 备份用途，未用于任何商业行为。

## 隐私提示

本仓库为公开仓库（GitHub Pages 免费版要求），`saves/main.json` 的内容理论上公开可见。存档仅含游戏进度，不含 token 或个人敏感信息。若需私密，可把游戏站点与存档拆成两个仓库（存档仓库设 private，token 只授权私仓）。
