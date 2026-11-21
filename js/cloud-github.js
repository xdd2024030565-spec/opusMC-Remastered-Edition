'use strict';
// 改造版：浏览器不再接触 GitHub token，只向 Cloudflare Worker 传「自定义密码」。
// 与旧版差异（逐条见 PLAN.md 第 4 节）：
//   1) OWNER/REPO/BRANCH/SAVE_PATH/TOKEN_KEY 常量 → 换成 WORKER_URL / PASS_KEY
//   2) headers() → 只带 Content-Type + X-Save-Password（无 Authorization）
//   3) pull()/pushOnce() 的 fetch URL → WORKER_URL；base64/hex 处理一行不改
//   4) askToken() → askPassword()（文案与输入框改密码）
//   5) setToken → setPassword，TOKEN_INVALID → BAD_PASSWORD
//   6) statusText() 文案 token → 密码

(function () {
  const WORKER_URL = 'https://yongjiu.ccwu.cc/opusmc-save/api/save';
  const PASS_KEY = 'opusmc_remastered_password';
  const CID_KEY = 'opusmc_remastered_client';

  let password = '', sha = null, clientId = '';
  let dirty = false, debounceTimer = null, periodicTimer = null;
  let queue = Promise.resolve(), loaded = false, lastError = null;
  let readOnly = false;  // 云端不可达时为 true：允许进游戏，但禁止写云端，避免空存档覆盖真实进度

  const log = (...a) => console.log('[cloud-github]', ...a);
  const warn = (...a) => console.warn('[cloud-github]', ...a);

  function uuid() {
    try { return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  const enc = s => new TextEncoder().encode(s);
  const dec = u => new TextDecoder().decode(u);

  function b64(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(String(str || '').replace(/\s/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const HEX = '0123456789abcdef';
  function toHex(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) { const b = u8[i]; s += HEX[b >> 4] + HEX[b & 15]; }
    return s;
  }
  function fromHex(s) {
    s = String(s || '').replace(/\s/g, '');
    const out = new Uint8Array(s.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  async function deflate(str) {
    if (typeof CompressionStream === 'undefined') return enc(str);
    const cs = new CompressionStream('deflate');
    const w = cs.writable.getWriter();
    w.write(enc(str)); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') return dec(u8);
    const ds = new DecompressionStream('deflate');
    const w = ds.writable.getWriter();
    w.write(u8); w.close();
    return dec(new Uint8Array(await new Response(ds.readable).arrayBuffer()));
  }
  function headers() {
    return {
      'Content-Type': 'application/json',
      'X-Save-Password': password,
    };
  }

  // fetch 超时保护：国内访问 Cloudflare 偶尔会挂起，绝不能让它永久卡住游戏启动。
  // 超时后抛错，由上层"网络异常放行"分支处理，游戏照常进入。
  const FETCH_TIMEOUT = 10000;
  function fetchWithTimeout(url, opts) {
    opts = opts || {};
    if (typeof AbortController === 'undefined') return fetch(url, opts);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    opts.signal = ctl.signal;
    return fetch(url, opts).finally(() => clearTimeout(timer));
  }

  function jsonSafe(v, path) {
    path = path || new Set();
    if (v === null || typeof v !== 'object') return typeof v === 'function' || typeof v === 'symbol' ? undefined : v;
    if (ArrayBuffer.isView(v)) return Array.from(v);
    if (v instanceof ArrayBuffer) return Array.from(new Uint8Array(v));
    if (v instanceof Date) return v.toISOString();
    if (path.has(v)) return undefined;
    path.add(v);
    let out;
    if (Array.isArray(v)) out = v.map(x => jsonSafe(x, path));
    else if (v instanceof Map) {
      out = {};
      for (const [k, x] of v) { const c = jsonSafe(x, path); if (c !== undefined) out[String(k)] = c; }
    } else if (v instanceof Set) out = Array.from(v, x => jsonSafe(x, path)).filter(x => x !== undefined);
    else {
      out = {};
      for (const k of Object.keys(v)) { const c = jsonSafe(v[k], path); if (c !== undefined) out[k] = c; }
    }
    path.delete(v);
    return out;
  }

  function serialize() {
    const worlds = [];
    for (const [id, w] of DB.mem.worlds) worlds.push({ id, w: jsonSafe(w) });
    const chunks = [];
    for (const [k, v] of DB.mem.chunks) {
      const rec = { k, b: Array.from(v.b), m: Array.from(v.m) };
      if (v.w && v.w.length) rec.w = Array.from(v.w);
      chunks.push(rec);
    }
    return { version: 1, updatedAt: new Date().toISOString(), clientId, worlds, chunks };
  }

  function restore(env) {
    if (!env || env.version !== 1) throw new Error('存档格式不兼容');
    DB.mem.worlds.clear();
    DB.mem.chunks.clear();
    for (const { id, w } of env.worlds || []) DB.mem.worlds.set(id, w);
    for (const c of env.chunks || []) {
      const v = { b: new Uint16Array(c.b), m: new Uint16Array(c.m) };
      if (c.w) v.w = new Uint32Array(c.w);
      DB.mem.chunks.set(c.k, v);
    }
    log('云端存档已载入：', (env.worlds || []).length, '世界 /',
        (env.chunks || []).length, '区块', env.updatedAt || '');
  }

  async function pull() {
    const r = await fetchWithTimeout(WORKER_URL + '?t=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (r.status === 404) { sha = null; return null; }
    if (r.status === 401) throw new Error('BAD_PASSWORD');
    if (!r.ok) throw new Error('拉取存档失败 HTTP ' + r.status);
    const j = await r.json();
    sha = j.sha;
    // 大文件的 raw 兜底已由 Worker 完成，返回的 content 一定是 base64 字符串。
    let b64str = j.content;
    if (!b64str) throw new Error('存档 content 为空（Worker 未正确回填）');
    const ascii = dec(unb64(b64str));
    const raw = await inflate(fromHex(ascii));
    return JSON.parse(raw);
  }

  async function pushOnce(env) {
    const content = b64(enc(toHex(await deflate(JSON.stringify(env)))));
    const body = { message: 'autosave ' + env.updatedAt, content, branch: 'main' };
    if (sha) body.sha = sha;
    for (let i = 0; i < 4; i++) {
      const r = await fetchWithTimeout(WORKER_URL, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (r.ok) {
        const j = await r.json();
        if (j.content && j.content.sha) sha = j.content.sha;
        return;
      }
      if (r.status === 409 || r.status === 422) {
        const g = await fetchWithTimeout(WORKER_URL + '?t=' + Date.now(), { headers: headers(), cache: 'no-store' });
        if (g.ok) { sha = (await g.json()).sha; body.sha = sha; continue; }
      }
      if (r.status === 401) throw new Error('BAD_PASSWORD');
      throw new Error('上传存档失败 HTTP ' + r.status);
    }
    throw new Error('上传存档冲突重试失败');
  }

  function enqueue(fn) { queue = queue.then(fn, fn); return queue; }

  async function flushNow() {
    if (!password || !loaded || !dirty || readOnly) return;
    return enqueue(async () => {
      if (!dirty) return;
      dirty = false;
      const env = serialize();
      try {
        await pushOnce(env);
        lastError = null;
        log('已保存到云端', env.updatedAt);
      } catch (e) {
        dirty = true;
        lastError = e.message === 'BAD_PASSWORD' ? '密码错误' : e.message;
        warn('保存失败：', lastError);
      }
    });
  }

  function markDirty() {
    dirty = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; flushNow(); }, 1200);
  }

  let hooked = false;
  function installHook() {
    if (hooked || typeof DB === 'undefined') return;
    hooked = true;
    for (const m of ['putWorld', 'putChunks', 'deleteWorld']) {
      const orig = DB[m].bind(DB);
      DB[m] = function (...a) {
        const r = orig(...a);
        markDirty();
        return r;
      };
    }
    log('已挂钩 DB 写操作');
  }

  // 登录/密码框：DOM 覆盖层（密码遮罩），验证通过才放行；错误留在框内重试。
  // title/intro 可定制：启动时的「首次配置」与游戏内「登录」共用这一套。
  function askPassword(title, intro, okLabel) {
    return new Promise(resolve => {
      let box = document.getElementById('cg-password-box');
      if (box) box.remove();
      box = document.createElement('div');
      box.id = 'cg-password-box';
      box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.86);color:#fff;font:14px/1.6 sans-serif;display:flex;align-items:center;justify-content:center;padding:20px';
      box.innerHTML =
        '<div style="max-width:540px;width:100%;background:#1b1b1b;padding:24px;border-radius:12px;border:1px solid #444">' +
        '<h2 style="margin:0 0 12px;font-size:18px">' + (title || '登录 · 云端存档') + '</h2>' +
        '<p style="color:#ccc;margin:0 0 12px">' + (intro || '本游戏存档只保存在云端：进入自动加载、游玩自动保存、本地不留存档。请输入存档密码（由站点管理员告知），它只保存在本机浏览器，用于向云端代理证明身份；真实 GitHub token 不会接触浏览器。') + '</p>' +
        '<input id="cg-password-input" type="password" autocomplete="off" placeholder="输入存档密码" style="width:100%;box-sizing:border-box;padding:10px;font:14px monospace;background:#000;color:#fff;border:1px solid #666;border-radius:6px">' +
        '<div style="margin-top:16px;text-align:right"><button id="cg-password-ok" style="padding:9px 22px;background:#2a7;color:#000;border:0;border-radius:6px;font-weight:bold;cursor:pointer">' + (okLabel || '登录') + '</button></div>' +
        '<div id="cg-password-msg" style="color:#f88;font-size:12px;margin-top:8px;min-height:16px"></div></div>';
      document.body.appendChild(box);
      const input = document.getElementById('cg-password-input');
      const msg = document.getElementById('cg-password-msg');
      const btn = document.getElementById('cg-password-ok');
      const ok = async () => {
        const v = input.value.trim();
        if (!v) { msg.textContent = '请输入密码'; return; }
        msg.textContent = '正在验证…'; btn.disabled = true; input.disabled = true;
        let bad = false;
        try { await verifyAndRestore(v); }
        catch (e) {
          bad = e.message === 'BAD_PASSWORD';
          if (!bad) readOnly = true;  // 网络异常放行，但禁止上传，避免空存档覆盖云端真实进度
          msg.textContent = bad ? '密码错误，请重试' : '网络异常，已允许离线进入（只读，不会覆盖云端）：' + e.message;
        }
        btn.disabled = false; input.disabled = false;
        if (bad) { input.value = ''; input.focus(); return; }
        box.remove();
        resolve(v);
      };
      btn.onclick = ok;
      input.onkeydown = e => { if (e.key === 'Enter') ok(); };
      setTimeout(() => input.focus(), 0);
    });
  }

  // 验证密码并顺带把云端存档载入内存（登录即完成云端同步）。
  // 只有验证成功（密码正确或网络暂时不可达但留有旧存档）才把密码落盘，避免输错密码被记住。
  async function verifyAndRestore(p) {
    password = p;   // 仅内存，先用于本次请求
    sha = null;
    const env = await pull();          // 401 会抛 BAD_PASSWORD
    if (env) restore(env); else log('云端暂无存档，从空世界开始');
    try { localStorage.setItem(PASS_KEY, p); } catch (e) {}  // 验证通过才记住
  }

  // 密码验证通过后，把账号设成内存登录态：仅供本次页面使用，不写 localStorage（刷新即失效，靠密码重新验证）。
  function markAccountLoggedIn() {
    if (typeof Account === 'undefined') return;
    Account.token = 'cloud';
    if (!Account.data) Account.data = { name: '云端玩家', nick: '云端玩家', id: 'cloud', created: Date.now(), unlocks: { follow: true, triple: true }, super: false };
    Account.offline = false;
  }

  async function askPasswordAndLogin() {
    await askPassword(
      '登录 · 云端存档',
      '本游戏存档只保存在云端：进入自动加载、游玩自动保存、本地不留存档。请输入存档密码（由站点管理员告知），它只保存在本机浏览器；真实 GitHub token 不会接触浏览器。密码错误将无法进入。',
      '登录并进入'
    );
    markAccountLoggedIn();
  }

  async function promptLogin() { await askPasswordAndLogin(); }

  function cleanupLocal() {
    try {
      if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) indexedDB.deleteDatabase('mc-js-clone');
      const del = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('mcjs:w:') || k.startsWith('mcjs:c:'))) del.push(k);
      }
      for (const k of del) localStorage.removeItem(k);
      if (del.length) log('已清理本地旧存档键', del.length);
    } catch (e) {}
  }

  async function load() {
    if (typeof window.__bootCreep === 'function') window.__bootCreep(45, '正在连接云端存档');
    clientId = (() => { try { return localStorage.getItem(CID_KEY) || ''; } catch (e) { return ''; } })();
    if (!clientId) {
      clientId = uuid();
      try { localStorage.setItem(CID_KEY, clientId); } catch (e) {}
    }
    password = (() => { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } })();
    if (password) {
      // 已记住密码：静默验证并载入云端存档。密码若已失效则弹框让用户重输。
      try {
        await verifyAndRestore(password);
        markAccountLoggedIn();
      } catch (e) {
        if (e.message === 'BAD_PASSWORD') {
          warn('已保存的密码已失效，请重新输入');
          await askPasswordAndLogin();
        } else {
          warn('读取云端存档失败，本次仅本地试玩（不会覆盖云端）：', e.message);
          readOnly = true;  // 云端不可达：放行进游戏，但禁止上传，避免空存档覆盖真实进度
          markAccountLoggedIn();
        }
      }
    } else {
      // 首次进入：弹密码框（这就是游戏的「登录界面」）。
      await askPasswordAndLogin();
    }
    loaded = true;
    if (typeof window.__bootStop === 'function') window.__bootStop();
    if (typeof window.__bootProgress === 'function') window.__bootProgress(65, '正在初始化游戏');
    installHook();
    periodicTimer = setInterval(() => flushNow(), 5000);
    try {
      addEventListener('pagehide', () => { if (dirty) flushNow(); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && dirty) flushNow();
      });
    } catch (e) {}
    cleanupLocal();
  }

  function setPassword(p) {
    password = p;
    try { localStorage.setItem(PASS_KEY, p); } catch (e) {}
    sha = null;
    log('密码已更新');
  }
  function statusText() {
    if (!password) return '未配置密码';
    if (readOnly) return '云端不可用 · 只读试玩（进度不会保存）';
    if (lastError) return '同步异常：' + lastError;
    return dirty ? '待保存…' : '云端存档已同步';
  }

  window.CloudGitHub = {
    load, markDirty, flushNow, setPassword, statusText, promptLogin,
    get loaded() { return loaded; },
    get dirty() { return dirty; }
  };
})();
