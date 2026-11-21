
'use strict';

// ---------------------------------------------------------------------------
// 模组 (mods): content added on top of the game - their blocks, items, recipes and tiles join the vanilla ones while
// the page loads, so the whole game (the terrain and mesh workers too) sees them as its own.
//   - game/mods/index.json: the mods there are (name, author, licence, version, files, size)
//   - a mod's files, game/mods/<id>/: data.js (its blocks / items / recipes / tiles, run after the vanilla data files and
//     before blocks.js, in the page and in the workers), code.js (how it plays, run before main.js), tiles.png (its
//     tiles, appended to the texture array) and whatever else it loads itself
//   - the 模组 screen (title, light blue): download (the files fetched once, kept by the browser) or delete
//   - each world has its own mods (the user 11-08): picked when it is made (创建新的世界) or edited (编辑); the page
//     loads the mods of the world being opened - when they differ from what it loaded, it loads again with them
//     (Mods.reloadWith: the world to open / make waits in sessionStorage) and goes on into it
//   - single player only; multiplayer rooms are vanilla
// Ids: a mod's blocks and items have fixed ranges of their own (saves keep them); vanilla's never move.
// ---------------------------------------------------------------------------
const Mods = {
  KEY: 'mcjs-mods',
  active: [],
  // the mods this page loaded with (the world it was loaded for)
  always: [],
  // built in (self.MODS_ALWAYS, set by the page before this file - a package made with them):
  // downloaded already, nothing to fetch
  BOOT: 'mcjs-mods-boot',
  boot: null,
  // what the page was loaded again for: { mods, open: world id } or { mods, create: [args] }
  index: null,
  // mods/index.json, once read
  defs: {},
  // id -> what its data.js registered (Mods.register)
  state() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  },
  save(s) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(s));
    } catch (e) {}
  },
  init() {
    const s = this.state(),
      ok = id => /^[a-z0-9_]{1,32}$/.test(id);
    // (?nomods in the address: start without any, to get out of a broken one)
    const off = typeof location !== 'undefined' && /[?&]nomods\b/.test(location.search);
    this.always = (typeof self !== 'undefined' && self.MODS_ALWAYS || []).filter(ok);
    // (the request a reload left: its mods, those downloaded; kept for one load - a refresh after is vanilla again)
    // (also left in localStorage, for a minute: an app's web view that kept no sessionStorage over the reload came back
    // to the title without the world, and the click seemed to do nothing - 11-10, the B站 app, not seen here)
    let b = null;
    try {
      b = JSON.parse(sessionStorage.getItem(this.BOOT) || 'null');
      sessionStorage.removeItem(this.BOOT);
    } catch (e) {
      b = null;
    }
    try {
      const l = JSON.parse(localStorage.getItem(this.BOOT) || 'null');
      localStorage.removeItem(this.BOOT);
      if (!b && l && l.req && Math.abs(Date.now() - l.t) < 60000) b = l.req;
    } catch (e) {}
    // (?modtest=a,b in the address - the SDK's test: a new creative world with these mods, nothing to download first;
    // tools/modsdk)
    const mt = !off && typeof location !== 'undefined' && /[?&]modtest=([a-z0-9_,]+)/.exec(location.search);
    this.testing = mt ? mt[1].split(',').filter(ok) : [];
    if (!b && this.testing.length) b = {
      mods: this.testing,
      create: ['模组测试', 'opusmc', 'creative', false, {
        cheats: true,
        difficulty: 2
      }]
    };
    if (b && Array.isArray(b.mods)) {
      this.boot = b;
      this.active = off ? [] : [...new Set(b.mods.filter(id => ok(id) && (this.always.includes(id) || this.testing.includes(id) || s.downloaded && s.downloaded[id])))];
    } else this.active = window.__OFFLINE_MODS ? window.__OFFLINE_MODS.slice() : [];
  },
  // the same set of mods (order aside)
  same(a, b) {
    return [...new Set(a || [])].sort().join(',') === [...new Set(b || [])].sort().join(',');
  },
  // load the page again with these mods, then open / make the world (mods_ui.js does it once the title is up)
  reloadWith(mods, then) {
    const req = {
      mods: [...new Set(mods || [])],
      ...(then || {})
    };
    try {
      sessionStorage.setItem(this.BOOT, JSON.stringify(req));
    } catch (e) {}
    try {
      localStorage.setItem(this.BOOT, JSON.stringify({
        t: Date.now(),
        req
      }));
    } catch (e) {}
    location.reload();
  },
  // the mods downloaded (index order), for the pickers
  downloaded() {
    return (this.index && this.index.mods || []).filter(m => this.isDownloaded(m.id));
  },
  nameOf(id) {
    const m = this.index && (this.index.mods || []).find(x => x.id === id);
    return m && m.name || id;
  },
  dir(id) {
    return 'mods/' + id + '/';
  },
  // while the page is read: a stage's script of every active mod, right where the asking tag is (document.write keeps
  // the order: they run before the next tag)
  // (each one counted for the loading bar, index.html: self.BOOT_EXTRA)
  stage(name) {
    if (window.__OFFLINE_MODS) return; // 离线包：模组脚本已随页面静态加载
    for (const id of this.active) {
      const k = this.dir(id) + name + '.js';
      const c = (window.__SRCS && window.__SRCS[k]) || window.__MODFILES[k];
      if (typeof c !== 'string') continue;
      self.BOOT_EXTRA = (self.BOOT_EXTRA || 0) + 1;
      document.write('<scr' + 'ipt>' + c.replace(/<\/script/gi, '<\\/script') + ';try{window.__SRCS=window.__SRCS||{};window.__SRCS[' + JSON.stringify(k) + ']=document.currentScript.textContent;}catch(e){}' + '</scr' + 'ipt>');
    }
  },
  // for a worker: which mods it loads (it imports their data.js after blockdata.js)
  workerQuery() {
    return this.active.length ? '?mods=' + this.active.join(',') : '';
  },
  has(id) {
    return this.active.includes(id);
  },
  // a data.js says what it is and what it added (for the screen, the world check and the credits)
  register(id, info) {
    this.defs[id] = Object.assign({
      id
    }, info);
  },
  async loadIndex() {
    return (this.index = window.__MODINDEX);
  },
  isDownloaded(id) {
    const s = this.state();
    return this.always.includes(id) || (this.testing || []).includes(id) || !!(s.downloaded && s.downloaded[id]);
  },
  // the download going on (one at a time): { id, done, total, background, promise } - kept here, not on the screen,
  // so leaving the 模组 screen and coming back shows it still going
  dl: null,
  // a mod's files fetched at the very addresses the game loads them from (so the browser's copy is the one used when
  // the game starts); each file done is remembered (state.partial), so a download stopped half way - the page closed -
  // goes on from there next time. In the background (prefetch): 2 at a time, and the mod is not marked downloaded -
  // that is the player's click; a click while it runs turns it into the player's download, 6 at a time
  download(mod, onProgress, background = false) {
    const cur = this.dl;
    if (cur && cur.id === mod.id) {
      if (onProgress) cur.listeners.push(onProgress);
      if (!background && cur.background) {
        cur.background = false;
        cur.more(4);
      }
      return cur.promise;
    }
    if (cur) return Promise.reject(new Error('正在下载另一个模组'));
    const s0 = this.state(),
      part = s0.partial && s0.partial[mod.id] || {};
    const same = part.version === mod.version,
      have = same ? new Set(part.files || []) : new Set();
    const dl = this.dl = {
      id: mod.id,
      total: mod.size || 0,
      done: same ? Math.min(part.bytes || 0, mod.size || 0) : 0,
      background,
      listeners: onProgress ? [onProgress] : []
    };
    const tell = () => {
      for (const f of dl.listeners) f(dl.done, dl.total);
    };
    const remember = (f, bytes) => {
      const s = this.state(),
        p = (s.partial || (s.partial = {}))[mod.id] || {
          version: mod.version,
          files: [],
          bytes: 0
        };
      if (p.version !== mod.version) {
        p.version = mod.version;
        p.files = [];
        p.bytes = 0;
      }
      p.files.push(f);
      p.bytes += bytes;
      s.partial[mod.id] = p;
      this.save(s);
    };
    const todo = mod.files.filter(f => !have.has(f));
    const one = async f => {
      // (no-cache: the browser asks whether its copy is still good - nothing comes again when it is)
      const r = await fetch(this.dir(mod.id) + f, {
        cache: 'no-cache'
      });
      if (!r.ok) throw new Error(f + '：' + r.status);
      let n = 0;
      const rd = r.body && r.body.getReader ? r.body.getReader() : null;
      if (rd) {
        for (;;) {
          const {
            done: end,
            value
          } = await rd.read();
          if (end) break;
          n += value.length;
          dl.done += value.length;
          tell();
        }
      } else {
        n = (await r.arrayBuffer()).byteLength;
        dl.done += n;
        tell();
      }
      remember(f, n);
    };
    let next = 0,
      failed = null;
    const running = [];
    const worker = async () => {
      while (next < todo.length && !failed) {
        try {
          await one(todo[next++]);
        } catch (e) {
          failed = failed || e;
        }
      }
    };
    dl.more = n => {
      for (let i = 0; i < n; i++) running.push(worker());
    };
    dl.more(Math.min(background ? 2 : 6, todo.length || 1));
    dl.promise = (async () => {
      try {
        // (workers added on the way - a click - are waited for too)
        for (let k = 0; k < running.length; k++) await running[k];
        if (failed) throw failed;
        const s = this.state();
        if (dl.background) {
          const p = (s.partial || (s.partial = {}))[mod.id] || {
            version: mod.version,
            files: [],
            bytes: 0
          };
          p.complete = true;
          s.partial[mod.id] = p;
        } else {
          (s.downloaded || (s.downloaded = {}))[mod.id] = mod.version;
          if (s.partial) delete s.partial[mod.id];
          if (s.removed) s.removed = s.removed.filter(x => x !== mod.id);
          // (its tutorial map - a hidden mod of a few scripts - comes with it: index.json "tutorial")
          if (mod.tutorial && mod.tutorial.mod) s.downloaded[mod.tutorial.mod] = 'with ' + mod.id;
        }
        this.save(s);
        dl.done = dl.total;
        tell();
      } finally {
        if (this.dl === dl) this.dl = null;
      }
    })();
    return dl.promise;
  },
  // fetched ahead (the game idle on its title screen): what isn't downloaded yet - not on a slow or data-saving
  // connection, not one the player removed - so the player's click later finds it all there
  async prefetch() {
    try {
      const c = navigator.connection;
      if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
      const ix = await this.loadIndex(),
        s = this.state();
      for (const m of ix.mods || []) {
        if (m.hidden || this.dl || this.isDownloaded(m.id) || (s.removed || []).includes(m.id)) continue;
        const p = s.partial && s.partial[m.id];
        if (p && p.version === m.version && p.complete) continue;
        await this.download(m, null, true).catch(() => {});
      }
    } catch (e) {}
  },
  // (removed: not fetched ahead again; downloading it again undoes that)
  // (a mod's tutorial map, downloaded with it: marked so without fetching - one downloaded before tutorials came)
  markDownloaded(id) {
    const s = this.state();
    (s.downloaded || (s.downloaded = {}))[id] = s.downloaded[id] || 'marked';
    this.save(s);
  },
  // the mods the player chooses from (not the hidden ones: a mod's tutorial map)
  listed(ix) {
    const off = typeof Live !== 'undefined' ? Live.get('mods.hidden', []) : [];
    return ((ix || this.index || {}).mods || []).filter(m => !m.hidden && !off.includes(m.id));
  },
  // (off: hidden from the admin panel - js/live.js)
  remove(id) {
    const m = this.index && (this.index.mods || []).find(x => x.id === id);
    if (m && m.tutorial && m.tutorial.mod) {
      const s = this.state();
      if (s.downloaded) delete s.downloaded[m.tutorial.mod];
      this.save(s);
    }
    const s = this.state();
    if (s.downloaded) delete s.downloaded[id];
    if (s.partial) delete s.partial[id];
    s.enabled = (s.enabled || []).filter(x => x !== id);
    s.removed = [...new Set([...(s.removed || []), id])];
    this.save(s);
  }
};
Mods.init();
// fetched ahead a while after the page loads, when the browser is idle (after the game's own loading)
if (typeof window !== 'undefined' && typeof document !== 'undefined') window.addEventListener('load', () => {
  const go = () => Mods.prefetch();
  setTimeout(() => window.requestIdleCallback ? requestIdleCallback(go, {
    timeout: 10000
  }) : go(), 8000);
});
