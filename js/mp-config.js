/* opusMC 联机桥固定地址（可选）
 *
 * 联机需要运行 bridge/server.js 中转。若桥不在默认的「网页同源:8780」位置，
 * 在这里填它的 WebSocket 地址，就不用每次在网址后加 ?proxy= 参数。
 *
 * 例（cpolar 国内穿透，HTTPS 页面必须 wss://）：
 *   window.MP_PROXY = 'wss://xxxx.cpolar.cn/ws';
 * 例（局域网直连，HTTP 页面用 ws://）：
 *   window.MP_PROXY = 'ws://192.168.1.5:8780/ws';
 *
 * 留空 = 使用默认（同源 8780），也可临时用网址参数 ?proxy=wss://... 覆盖。
 * 详见 bridge/README.md。
 */
window.MP_PROXY = '';
