'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const DEFAULT_UPSTREAM = 'https://xz.honghemc.cn:8443';
const CLIENT_ORIGIN = 'https://www.bilibili.com';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};

function createApp(options = {}) {
  const root = fs.realpathSync(options.root || ROOT);
  const upstream = new URL(options.upstream || process.env.OPUSMC_UPSTREAM || DEFAULT_UPSTREAM);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password ||
      upstream.search || upstream.hash || upstream.pathname !== '/') throw new Error('游戏服务地址必须是 HTTP 或 HTTPS 根地址');
  const transport = upstream.protocol === 'https:' ? https : http;

  function json(res, status, data) {
    const bytes = Buffer.from(JSON.stringify(data));
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': bytes.length });
    res.end(bytes);
  }

  function checkOrigin(req) {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return false;
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      return origin.protocol === 'http:' && origin.host.toLowerCase() === host.toLowerCase() && !origin.username && !origin.password;
    } catch { return false; }
  }

  function requestOptions(req, url, websocket) {
    const headers = { Origin: CLIENT_ORIGIN, Referer: CLIENT_ORIGIN + '/toy/OpusMC/index.html' };
    const names = ['content-type', 'content-length', 'accept', 'accept-encoding'];
    if (websocket) names.push('connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions');
    for (const name of names) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    return { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || undefined,
      method: req.method, path: url.pathname.slice('/official'.length) + url.search, headers };
  }

  function proxyHttp(req, res, url) {
    const outgoing = transport.request(requestOptions(req, url, false), response => {
      const headers = {};
      for (const name of ['content-type', 'content-length', 'content-encoding', 'cache-control', 'retry-after']) {
        if (response.headers[name] !== undefined) headers[name] = response.headers[name];
      }
      res.writeHead(response.statusCode, headers);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    outgoing.setTimeout(120000, () => outgoing.destroy(new Error('upstream timeout')));
    outgoing.on('error', () => {
      if (!res.headersSent && !res.destroyed) json(res, 502, { error: '无法连接游戏服务，请检查网络后重试', errorType: 'network_error' });
      else res.destroy();
    });
    req.on('aborted', () => outgoing.destroy());
    req.on('error', () => outgoing.destroy());
    res.on('close', () => { if (!res.writableFinished) outgoing.destroy(); });
    req.pipe(outgoing);
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!checkOrigin(req)) return json(res, 403, { error: '请从当前本地游戏页面访问' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/official/api/')) {
        if (!['GET', 'POST', 'HEAD'].includes(req.method)) return json(res, 405, { error: '请求方法不支持' });
        return proxyHttp(req, res, url);
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, mode: 'proxy', upstream: upstream.origin });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '请求方法不支持' });
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      if (relative.startsWith('js/')) relative = relative.slice(3);
      if (relative.split('/').some(part => part.startsWith('.') || part.includes('\\')) ||
          !/^(index\.html|[a-zA-Z0-9_]+\.(?:js|webp|png)|sounds\/sfx\/[a-zA-Z0-9_./-]+\.(?:m4a|ogg))$/.test(relative) ||
          relative === 'server.js') return json(res, 404, { error: '文件不存在' });
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() ||
          !fs.realpathSync(file).startsWith(root + path.sep)) return json(res, 404, { error: '文件不存在' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof URIError ? 400 : 500, { error: '本地请求处理失败' });
      else res.destroy();
    }
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (!checkOrigin(req)) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    const url = new URL(req.url, 'http://localhost');
    if (!['/official/ws', '/official/p2p'].includes(url.pathname)) {
      return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    }
    let upgraded = false;
    const outgoing = transport.request(requestOptions(req, url, true));
    outgoing.setTimeout(15000, () => outgoing.destroy(new Error('websocket handshake timeout')));
    outgoing.on('upgrade', (response, remote, remoteHead) => {
      upgraded = true;
      outgoing.setTimeout(0);
      remote.setTimeout(0);
      socket.setTimeout(0);
      if (socket.destroyed) return remote.destroy();
      let handshake = `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`;
      for (const name of ['connection', 'upgrade', 'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
        if (response.headers[name] !== undefined) handshake += `${name}: ${response.headers[name]}\r\n`;
      }
      socket.write(handshake + '\r\n');
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      remote.on('error', () => socket.destroy());
      remote.on('close', () => socket.destroy());
      socket.on('close', () => remote.destroy());
      socket.pipe(remote).pipe(socket);
    });
    outgoing.on('response', response => {
      let headers = `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n`;
      for (const name of ['content-type', 'content-length']) {
        if (response.headers[name] !== undefined) headers += `${name}: ${response.headers[name]}\r\n`;
      }
      socket.write(headers + '\r\n');
      response.on('error', () => socket.destroy());
      response.pipe(socket);
    });
    outgoing.on('error', () => {
      if (socket.destroyed) return;
      if (upgraded) socket.destroy();
      else socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    socket.on('close', () => outgoing.destroy());
    outgoing.end();
  });

  return server;
}

function main() {
  const port = Number(process.env.PORT || 9178);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须在 1 到 65535 之间');
  const server = createApp();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请先关闭之前的启动窗口` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`OpusMC: ${url}\n账号、房间与联机中转已启用，Ctrl+C 停止。`);
    if (!process.argv.includes('--no-browser')) {
      const [command, args] = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] :
        process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => console.log('请手动打开上述地址'));
      child.unref();
    }
  });
}

if (require.main === module) main();
module.exports = { createApp };
