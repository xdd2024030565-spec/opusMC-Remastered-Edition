# opusMC 联机桥（bridge）

> 实验性功能。浏览器开不了 TCP，而真正的 Minecraft 服务器是 TCP + MC 协议。这个桥（`bridge/server.js`）就是中间的翻译层：**网页 ↔ WebSocket ↔ 桥 ↔ 真实 MC 服务器**。它的存在让网页版「多人游戏」从原来的假房间列表变成能连真服务器的服务器列表。

## 桥是什么 / 架构

```
浏览器（opusMC 网页）
   │ WebSocket（JSON 消息 + 两种二进制帧）
   │ ws://<桥主机>:8780/ws?host=<mc地址>&port=25565
   ▼
bridge/server.js（Node，跑在电脑 / 手机 proot / 服务器上）
   │ minecraft-protocol（作为「客户端」登录目标服务器）
   │ TCP + Minecraft 协议
   ▼
真实 MC 服务器（Java 版，离线登录 offline）
```

- 网页侧只发 `{t:'hello'|'settings'|'tick'|'dig'|'place'|'chat'|…}`，只收 JSON + 两种二进制帧；协议细节见 `js/net.js` 的 `NetClient` 与 `js/mp.js`。
- 桥做两件事：① 接受网页的 WebSocket；② 把真实服务器的世界翻译成网页客户端能画的协议（states / login / 区块二进制 / block / pos / chat …）。
- 服务器列表的「ping」也是浏览器发 `{t:'ping',host,port}` 给桥，由桥代 ping 真实服务器拿人数 / MOTD / 延迟。
- 本桥**不需要**任何 HTTP API、房间或鉴权。

## 依赖与安装

需要 Node.js 18+（建议 20+）。依赖在 `bridge/package.json`：

```bash
cd bridge
npm install
```

主要依赖：`ws`、`minecraft-protocol`、`minecraft-data`、`prismarine-chunk`。`node_modules/` 已在 `bridge/.gitignore` 中忽略，换机后需重装。

## 启动

```bash
cd bridge
node server.js              # 监听 8780 端口
```

看到 `bridge listening on ws://0.0.0.0:8780/ws` 即启动成功。保持这个终端运行；关掉 / 休眠进程，网页就连不上。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8780` | WebSocket 监听端口。改了要同步改网页的 `?proxy=` 或默认 8780 约定 |
| `HOST` | `0.0.0.0` | 监听地址。本机自测可用 `127.0.0.1`，公网穿透保持 `0.0.0.0` |
| `ALLOW_HOSTS` | 空（不限） | 允许连的目标服务器地址，逗号分隔，如 `mc.example.com,play.example.com`。**放到公网务必填**，否则任何人都能借你的桥访问任意主机（SSRF） |
| `MC_VERSION` | 空（自动） | 强制用某个 MC 版本登录（如 `1.21.4`）；留空则由桥 ping 服务器的协议号自动判断 |
| `MAX_CLIENTS` | `32` | 最大同时在线网页客户端数 |
| `QUIET` | 空 | 设为任意值关闭日志输出 |

例：

```bash
PORT=9000 ALLOW_HOSTS=mc.example.com,play.example.com MAX_CLIENTS=10 node server.js
```

## 网页端配置（`?proxy=`）

桥默认在「网页同源主机 + 8780 端口」，例如你用 `http://192.168.1.5:8080` 打开网页，桥就在 `ws://192.168.1.5:8780/ws`。如果桥不在同源默认位置，用 URL 参数临时指定：

```
https://你的网页/?proxy=wss://xxxx.cpolar.cn/ws
```

- 参数值就是桥的 WebSocket 基地址（可带 `/ws`，桥侧会自动补）。
- **HTTPS 网页必须用 `wss://`**，`ws://` 会被浏览器 mixed content 拦截；HTTP 页面用 `ws://` 即可。
- 固定部署可改 `js/mp-config.js` 里的 `window.MP_PROXY`，就不用每次带参数。
- 服务器列表里每条记录也能单独设「中转地址」（高级配置），留空即用默认。

## 方案 A：cpolar 国内穿透（推荐）

适合手机 proot 里跑桥、公网网页要连的场景。cpolar 免费版 4 条隧道 / 1Mbps / 国内节点 / 原生 WebSocket；免费域名每次启动可能变，固定域名需要手机号认证。

1. 注册 cpolar 并下载安装到跑桥的那台机器（手机 proot 或电脑）。
2. 先进桥目录启动桥：`cd bridge && node server.js`，确认 `8780` 在监听。
3. 另开一个终端，建 HTTP 隧道把 `8780` 暴露出去：
   ```bash
   cpolar http 8780
   # 若已认证并想用固定二级域名：
   cpolar http 8780 -subdomain=opusmc
   ```
4. cpolar 会打印一个 `https://xxxx.cpolar.cn`（或 `wss://…`）的公网地址，把它记下来。
5. 在网页地址后加参数（注意 HTTPS 页面用 `wss://`）：
   ```
   https://opusmc-xxx.maozi.io/?proxy=wss://xxxx.cpolar.cn/ws
   ```
6. 打开多人游戏 → 添加服务器，填入真实 MC 服务器地址与端口，刷新看是否在线，然后加入。

注意：免费域名重启 cpolar 后会变，变了就要改 `?proxy=`（或重新登录 cpolar 拿固定子域）。桥端口、cpolar 隧道端口要一致（都是 8780）。

## 方案 B：局域网直连

网页和桥在同一个 WiFi / 局域网时，不需要任何穿透：

1. 在跑桥的机器上启动 `node server.js`。
2. 查出这台机器的局域网 IP（如 `192.168.31.140`）。
3. 浏览器打开网页时用 `http://` 而不是 `https://`（否则 mixed content 拦截 `ws://`）：
   ```
   http://<电脑IP>:<网页端口>/?proxy=ws://<电脑IP>:8780/ws
   ```
   若网页本身就开在这台机器的 8780 之外的端口，默认代理会指向同源的 8780，通常无需写 `?proxy=`；跨机器时显式写上更稳。
4. 手机连同一 WiFi，用上面的 `http://` 地址打开即可。

若网页必须是 HTTPS（如线上域名），局域网直连走不通 `ws://`，请用方案 A 的 `wss://` 或方案 C。

## 方案 C：其他兜底

- **Cloudflare 命名隧道**：免费，但需要自有域名 + 把域名 NS 托管到 Cloudflare；国内访问较慢，且有约 100 秒空闲超时，长连接会被断。适合有域名且能接受延迟的场景。
- **国内 VPS + frp**：在 VPS 上跑 frp 服务端，桥所在机器跑 frp 客户端，把 8780 映射到 VPS，网页用 `ws(s)://VPS域名:端口`。可控但要自己有 VPS。
- 结论（调研）：**没有**「国内直连 + 免费 + 长连 WS + 任意出站 TCP」四全的方案，上面三选一。

## 安全提示

- **SSRF**：桥会代替网页去连任意 `host:port`。放公网时务必设 `ALLOW_HOSTS` 白名单，把可连的 MC 服务器列进去；留空等于允许任何人借你的桥扫内网。
- **凭据不入库**：桥使用 MC 的 `offline` 离线登录，**不需要也不接受** MC 账号密码；请勿把任何账号凭据、token 写进 `bridge/` 下的文件或提交到仓库。`node_modules/`、`.env`、`*.log` 已被 `.gitignore` 忽略。
- 桥没有用户鉴权，谁拿到 WebSocket 地址都能用；只把地址发给信任的人，不要公开贴到网上。
- 免费隧道的公网地址是公开的，建议配合 `ALLOW_HOSTS` 使用，并留意 `MAX_CLIENTS` 防止被刷。

## 已知限制

- **方块状态塌缩约 18.9%**：桥把真实服务器的方块 stateId 映射到网页客户端认识的方块状态时，部分状态会塌缩到近似方块（例如不同朝向 / 变体合并）。视觉上绝大多数正常，少数方块会显示成相近的方块。
- **online-mode 正版服不支持**：桥目前用离线（`auth: 'offline'`）登录，连开启正版验证的服务器会被拒绝。要支持需做服务端 MITM / 代理正版登录，暂未实现。
- **版本兼容不做 ViaVersion**：桥按服务器协议号自动选择对应 MC 版本登录，不会把客户端「翻译」成其他版本。跨版本服（如只允许 1.8 或 1.21）请用服务器实际支持的版本对接；ViaVersion 类跨版本转换不在本项目范围。
- **免费隧道域名变动**：cpolar 免费域名每次启动可能变，需更新 `?proxy=`；固定域名要手机号认证。
- **移动端 / 公网体验依赖网络质量**：1Mbps 免费隧道下会有延迟；手机休眠或切后台可能断连，需要重进。
