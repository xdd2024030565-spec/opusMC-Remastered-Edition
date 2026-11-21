'use strict';
// opusMC Remastered Edition — 纯云端存档（GitHub Contents API）
// 存档只存 GitHub 仓库，本地内存运行，不写 IndexedDB / localStorage 存档。
// 进入自动加载 → 游玩自动保存 → 页面关闭兜底保存。无上传/下载按钮。
(function () {
  const OWNER = 'xdd2024030565-spec';
  const REPO  = 'opusMC-Remastered-Edition';
  const BRANCH = 'main';
  const SAVE_PATH = 'saves/main.json';
  const API = 'https://api.github.com/repos/' + encodeURIComponent(OWNER) + '/' +
              encodeURIComponent(REPO) + '/contents/' + SAVE_PATH;
  const TOKEN_KEY = 'opusmc_remastered_token';
  const CID_KEY = 'opusmc_remastered_client';

  let token = '', sha = null, clientId = '';
  let dirty = false, debounceTimer = null, periodicTimer = null;
  let queue = Promise.resolve(), loaded = false, lastError = null;

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
  function headers(accept) {
    return {
      'Authorization': 'Bearer ' + token,
      'Accept': accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  // 递归转成纯 JSON 安全结构：Map→普通对象、Set→数组、TypedArray→数组，剥掉函数/循环引用/live 对象。
  // 不能用 DB.plain —— 它保留 Map/Set 实例，JSON.stringify(new Map()) 会得到 {} 丢数据。
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

  // DB.mem → 可序列化存档包
  function serialize() {
    const worlds = [];
    for (const [id, w] of DB.mem.worlds) worlds.push({ id, w: jsonSafe(w) });
    const chunks = [];
    for (const [k, v] of DB.mem.chunks) {
      const rec = { k, b: Array.from(v.b), m: Array.from(v.m) };
      if (v.w && v.w.length) rec.w = Array.from(v.w);
      chunks.push(rec);
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      clientId,
      worlds,
      chunks
    };
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
    const r = await fetch(API + '?t=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (r.status === 404) { sha = null; return null; }
    if (r.status === 401 || r.status === 403) throw new Error('TOKEN_INVALID');
    if (!r.ok) throw new Error('拉取存档失败 HTTP ' + r.status);
    const j = await r.json();
    sha = j.sha;
    // GitHub Contents API 对 >1MB 文件返回的 content 为空，需用 raw media type 单独取。
    let b64str = j.content;
    if (!b64str) {
      const rr = await fetch(API + '?raw=' + Date.now(), { headers: headers('application/vnd.github.raw+json'), cache: 'no-store' });
      if (!rr.ok) throw new Error('读取大存档失败 HTTP ' + rr.status);
      b64str = b64(new Uint8Array(await rr.arrayBuffer()));
    }
    const raw = await inflate(unb64(b64str));
    return JSON.parse(raw);
  }

  async function pushOnce(env) {
    const content = b64(await deflate(JSON.stringify(env)));
    const body = { message: 'autosave ' + env.updatedAt, content, branch: BRANCH };
    if (sha) body.sha = sha;
    for (let i = 0; i < 4; i++) {
      const r = await fetch(API, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (r.ok) {
        const j = await r.json();
        if (j.content && j.content.sha) sha = j.content.sha;
        return;
      }
      if (r.status === 409 || r.status === 422) {
        const g = await fetch(API + '?t=' + Date.now(), { headers: headers(), cache: 'no-store' });
        if (g.ok) { sha = (await g.json()).sha; body.sha = sha; continue; }
      }
      if (r.status === 401 || r.status === 403) throw new Error('TOKEN_INVALID');
      throw new Error('上传存档失败 HTTP ' + r.status);
    }
    throw new Error('上传存档冲突重试失败');
  }

  function enqueue(fn) { queue = queue.then(fn, fn); return queue; }

  async function flushNow() {
    if (!token || !loaded || !dirty) return;
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
        lastError = e.message === 'TOKEN_INVALID' ? 'token 无效或权限不足' : e.message;
        warn('保存失败：', lastError);
      }
    });
  }

  function markDirty() {
    dirty = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; flushNow(); }, 1200);
  }

  // Hook DB 写操作：任何存档变更（世界元数据 / 区块 / 删除）都标记待保存。
  // 只在 load() 里安装一次，避免重复包装。
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

  // 首次配置 token 的遮罩（不是游戏内上传/下载按钮，只是一次性授权）
  function askToken() {
    return new Promise(resolve => {
      let box = document.getElementById('cg-token-box');
      if (box) box.remove();
      box = document.createElement('div');
      box.id = 'cg-token-box';
      box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.86);color:#fff;font:14px/1.6 sans-serif;display:flex;align-items:center;justify-content:center;padding:20px';
      box.innerHTML =
        '<div style="max-width:540px;width:100%;background:#1b1b1b;padding:24px;border-radius:12px;border:1px solid #444">' +
        '<h2 style="margin:0 0 12px;font-size:18px">首次配置 · 云端存档</h2>' +
        '<p style="color:#ccc;margin:0 0 12px">本游戏存档只保存在你的 GitHub 仓库：进入自动加载、游玩自动保存、本地不留存档。需要一次性填写 Personal Access Token（仅存本机浏览器，不是存档）。</p>' +
        '<p style="color:#999;font-size:12px;margin:0 0 12px">到 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:#6cf">github.com/settings/personal-access-tokens/new</a> 生成 Fine-grained token，只勾选本仓库 Contents: Read and write。</p>' +
        '<input id="cg-token-input" type="password" autocomplete="off" placeholder="粘贴 github_pat_..." style="width:100%;box-sizing:border-box;padding:10px;font:14px monospace;background:#000;color:#fff;border:1px solid #666;border-radius:6px">' +
        '<div style="margin-top:16px;text-align:right"><button id="cg-token-ok" style="padding:9px 22px;background:#2a7;color:#000;border:0;border-radius:6px;font-weight:bold;cursor:pointer">保存并开始</button></div>' +
        '<div id="cg-token-msg" style="color:#f88;font-size:12px;margin-top:8px;min-height:16px"></div></div>';
      document.body.appendChild(box);
      const input = document.getElementById('cg-token-input');
      const ok = () => {
        const v = input.value.trim();
        if (!v) { document.getElementById('cg-token-msg').textContent = '请先粘贴 token'; return; }
        try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {}
        box.remove();
        resolve(v);
      };
      document.getElementById('cg-token-ok').onclick = ok;
      input.onkeydown = e => { if (e.key === 'Enter') ok(); };
      setTimeout(() => input.focus(), 0);
    });
  }

  function cleanupLocal() {
    try {
      // 用户要求：本地不存存档 —— 清掉旧版遗留的本地存档
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
    clientId = (() => { try { return localStorage.getItem(CID_KEY) || ''; } catch (e) { return ''; } })();
    if (!clientId) {
      clientId = uuid();
      try { localStorage.setItem(CID_KEY, clientId); } catch (e) {}
    }
    token = (() => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } })();
    if (!token) token = await askToken();
    if (token) {
      try {
        const env = await pull();
        if (env) restore(env); else log('云端暂无存档，从空世界开始');
      } catch (e) {
        if (e.message === 'TOKEN_INVALID') warn('token 无效或权限不足，请在控制台执行 CloudGitHub.setToken(...)');
        else warn('读取云端存档失败，本次从空世界开始：', e.message);
      }
    } else {
      warn('未配置 token，本次不保存');
    }
    loaded = true;
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

  function setToken(t) {
    token = t;
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
    sha = null;
    log('token 已更新');
  }
  function statusText() {
    if (!token) return '未配置 token';
    if (lastError) return '同步异常：' + lastError;
    return dirty ? '待保存…' : '云端存档已同步';
  }

  window.CloudGitHub = {
    load, markDirty, flushNow, setToken, statusText,
    get loaded() { return loaded; },
    get dirty() { return dirty; }
  };
})();
