# 登录和联机

双击 `start_game.bat` 启动，在浏览器访问 `http://127.0.0.1:9178/`。也可以运行 `node server.js`；原有的 `python start_game.py` 会启动同一个 Node.js 服务。

如果旧的启动窗口仍在运行，先关闭它，再启动新版。

在游戏的登录界面选择“用识别码登录”，输入已有的 16 位识别码。登录成功后，多人游戏可以读取公开房间、通过邀请码进入房间；P2P 联机沿用游戏内原有入口。账号、房间和 P2P 请求统一经本地服务转发，账号和联机资格以官方服务返回结果为准。

本地 `/official/api/` 对应官方 `/api/`，`/official/ws` 对应房间 WebSocket，`/official/p2p` 对应 P2P 信令。中转保留请求体、查询参数、状态码和二进制数据，并按参考项目设置官方服务要求的 Origin。前端保留已有的游戏协议解析与 WebRTC 数据通道。

默认上游为 `https://xz.honghemc.cn:8443`。需要换到兼容服务时，在 PowerShell 中运行：

```powershell
$env:OPUSMC_UPSTREAM = 'https://你的兼容服务域名'
node server.js
```

验证命令：

```powershell
node --test tests/network.test.cjs
```

已实测官方规则和公开房间接口返回 HTTP 200，房间和 P2P WebSocket 握手返回 101。自动化测试覆盖识别码规范化、账号令牌保存与过期、世界上传、二进制中转、排队超时和旧连接事件处理。测试使用模拟账号；实际账号登录和进入房间尚未验证。
