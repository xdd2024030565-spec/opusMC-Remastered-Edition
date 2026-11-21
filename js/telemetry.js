
'use strict';

// ---------------------------------------------------------------------------
// Statistics and feedback (multiplayer/TELEMETRY_PLAN.md). Anonymous play and performance data goes to the room
// service (POST /api/telemetry) every few minutes and when the page closes; nothing about who the player is (an
// install id that is a random number, no names, no chat, no IP - the service keeps only a salted hash of it).
// On by default; Options -> 遥测数据 turns it off. Kept cheap: one fixed histogram of frame times a minute, a
// handful of counters, no work in a frame beyond a few additions.
// What is sent: the device (GPU, cores, memory, screen, refresh, browser, touch, inside the bilibili app), load
// times, a point a minute (frame time median / 95th / 99th, 1% low, main thread / chunk / render / GPU time,
// memory, entities, chunks, view distance, dynamic resolution, preset, single player or a room, dimension),
// stalls over 100 ms and what was going on, errors (message and file:line, no addresses), the screens opened
// and commands used (by name), deaths, worlds loaded; on a server the round trip times, disconnects and how long
// the room took to start.
// Feedback (FeedbackScreen): a kind, a description, optionally a screenshot, with the same device and recent
// performance data, to POST /api/feedback (the service limits it per IP).
// A page served from this machine (localhost) sends nothing unless ?rooms= points at a test service - testing
// here must not mix into the real data.
// ---------------------------------------------------------------------------
const TELEMETRY_V = 1;
const GAME_BUILD = '2026.11.13s';
const Telemetry = {
  g: null,
  sid: Math.random().toString(36).slice(2, 10),
  seq: 0,
  t0: performance.now(),
  hist: new Uint16Array(201),
  frames: 0,
  sum: {
    cpu: 0,
    chunk: 0,
    render: 0,
    gpu: 0,
    gpuN: 0
  },
  minuteAt: 0,
  playMs: 0,
  afkMs: 0,
  points: [],
  stalls: [],
  errors: new Map(),
  counts: {},
  events: [],
  rtt: [],
  lastFlush: performance.now(),
  pings: new Map(),
  pingSeq: 0,
  lastPing: 0,
  prevState: null,
  loadStart: 0,
  // where the data goes, and whether it may go there
  base() {
    return typeof RoomService !== 'undefined' ? RoomService.base() : '';
  },
  on() {
    const g = this.g;
    if (!g || g.settings.telemetry === false || typeof Live !== 'undefined' && Live.get('client.telemetry', true) === false || !/^https?:$/.test(location.protocol) || !this.base()) return false;
    // (*.localhost / *.test too: test pages on per-test origins sent their numbers to the live service, and its origin
    // check banned the developer's own address, 2026-11-03)
    const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname) || /\.(localhost|test)$/.test(location.hostname);
    return !local || new URLSearchParams(location.search).has('rooms');
  },
  // this browser's anonymous id (a random number kept in the page's storage), and whether it is new here
  install() {
    if (this._id) return this._id;
    let id = null,
      fresh = false;
    try {
      id = localStorage.getItem('mcjs-tid');
      if (!id) {
        id = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('mcjs-tid', id);
        fresh = true;
      }
    } catch (e) {
      id = 'nostore-' + this.sid;
    }
    this._fresh = fresh;
    return this._id = id;
  },
  device() {
    const g = this.g,
      ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'edge' : /OPR\//.test(ua) ? 'opera' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
    const os = /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'windows' : /Mac OS/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'other';
    let gpu = '';
    try {
      gpu = PerfMon.gpuName(g.renderer.gl);
    } catch (e) {}
    return {
      gpu: String(gpu).slice(0, 120),
      cores: navigator.hardwareConcurrency || 0,
      mem: navigator.deviceMemory || 0,
      sw: screen.width,
      sh: screen.height,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      hz: g.pacer ? Math.round(1000 / g.pacer.refresh) : 0,
      browser,
      bver: (ua.match(/(?:Chrome|Firefox|Version)\/(\d+)/) || [])[1] || '',
      os,
      touch: typeof TouchDevice !== 'undefined' ? TouchDevice.kind : '',
      bili: /BiliApp|bili-/i.test(ua),
      lang: navigator.language || ''
    };
  },
  count(k, n = 1) {
    if (Object.keys(this.counts).length < 300 || this.counts[k] !== undefined) this.counts[k] = (this.counts[k] || 0) + n;
  },
  event(type, data) {
    if (this.events.length < 200) this.events.push({
      t: Math.round((performance.now() - this.t0) / 1000),
      type,
      ...data
    });
  },
  error(where, msg, stack) {
    // (just the message and the first file:line - no page address, nothing typed by the player)
    const at = String(stack || '').split('\n').map(s => s.trim()).find(s => /\.js:\d+/.test(s)) || '';
    const loc = (at.match(/([\w.-]+\.js):(\d+)/) || []).slice(1, 3).join(':');
    const k = (where ? where + ': ' : '') + String(msg || '').replace(/https?:\/\/\S+/g, '<url>').slice(0, 200) + (loc ? ' @' + loc : '');
    const e = this.errors.get(k);
    if (e) e.n++;else if (this.errors.size < 50) this.errors.set(k, {
      n: 1,
      first: Math.round((performance.now() - this.t0) / 1000)
    });
  },
  // every frame (perf.js PerfMon.frame): a few additions while playing
  frame(dt, cpu, chunk, render) {
    const g = this.g;
    if (!g) return;
    if (g.state !== this.prevState) this.stateChanged(this.prevState, g.state);
    if (document.hidden) {
      this.away = true;
      return;
    }
    // the first frame back from a hidden tab carries the whole time away (a 36 s "stall" in the first real data);
    // a frame of more than 10 s is a suspended page, not a stall either
    if (this.away || dt > 10000) {
      this.away = false;
      return;
    }
    if (g.state !== 'play' || g.ui.screen && g.ui.screen.pauses) return;
    // (nor a frame held to 30 / 10 by the inactivity limit, or the one after: perf.js FramePacer.cappedFrame. Its time
    // still counts as played - the session's play time meant that before the limit came)
    if (g.pacer && g.pacer.cappedFrame) {
      this.afkMs += dt;
      return;
    }
    this.hist[Math.min(200, dt | 0)]++;
    this.frames++;
    this.playMs += dt;
    this.sum.cpu += cpu;
    this.sum.chunk += chunk;
    this.sum.render += render;
    if (PerfMon.gpuOn && PerfMon.lastGpu != null) {
      this.sum.gpu += PerfMon.lastGpu;
      this.sum.gpuN++;
    }
    if (dt > 100 && this.stalls.length < 100) this.stalls.push({
      t: Math.round((performance.now() - this.t0) / 1000),
      ms: Math.round(dt),
      cpu: Math.round(cpu),
      chunk: Math.round(chunk),
      ents: g.entities ? g.entities.length : 0,
      dim: g.dim,
      net: !!g.net,
      screen: g.ui.screen ? g.ui.screen.constructor.name : ''
    });
    if (this.playMs - this.minuteAt >= 60000) {
      this.minuteAt = this.playMs;
      this.point();
    }
  },
  stateChanged(from, to) {
    const now = performance.now();
    this.prevState = to;
    Crumbs.mark('s:' + to);
    if (to === 'title' && !this.titleAt) {
      this.titleAt = now;
      this.event('title', {
        ms: Math.round(now)
      });
    }
    if (to === 'loading' || to === 'switching') this.loadStart = now;
    if (to === 'play' && this.loadStart) {
      this.event('enter', {
        ms: Math.round(now - this.loadStart),
        net: !!this.g.net,
        dim: this.g.dim
      });
      this.loadStart = 0;
    }
  },
  // one minute of play: the frame time distribution and what the game was doing
  point() {
    const g = this.g,
      h = this.hist,
      n = this.frames;
    if (!n) return;
    const pct = q => {
      let k = Math.ceil(n * q),
        i = 0;
      for (; i < 201; i++) {
        k -= h[i];
        if (k <= 0) break;
      }
      return i;
    };
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    const s = g.settings;
    this.points.push({
      m: Math.round(this.playMs / 60000),
      fps: Math.round(n / (this.playMs - (this.lastPointMs || 0)) * 1000 * 10) / 10,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      cpu: +(this.sum.cpu / n).toFixed(2),
      chunk: +(this.sum.chunk / n).toFixed(2),
      render: +(this.sum.render / n).toFixed(2),
      gpu: this.sum.gpuN ? +(this.sum.gpu / this.sum.gpuN).toFixed(2) : null,
      mem,
      ents: g.entities ? g.entities.length : 0,
      chunks: g.world && g.world.chunks ? g.world.chunks.size : 0,
      rd: s.renderDist,
      dyn: typeof DynRes !== 'undefined' ? DynRes.scale : 1,
      res: s.resScale,
      preset: s.preset || '',
      shaders: s.shaders || 0,
      maxFps: s.maxFps || 0,
      vsync: s.vsync !== false,
      lim: g.pacer ? g.pacer.playLimit : 0,
      // (the limit in effect: maxFps 0 is 60 on a 90/120 Hz phone, -1 跟随屏幕; 0 = the screen's rate)
      mode: g.net ? 'room' : 'single',
      dim: g.dim,
      gm: g.mode
    });
    this.lastPointMs = this.playMs;
    h.fill(0);
    this.frames = 0;
    this.sum = {
      cpu: 0,
      chunk: 0,
      render: 0,
      gpu: 0,
      gpuN: 0
    };
    if (this.points.length > 60) this.points.shift();
  },
  packet(final) {
    const net = this.rtt.length ? {
      rtt: this.rttSummary()
    } : null;
    const p = {
      v: TELEMETRY_V,
      kind: 'session',
      id: this.install(),
      sid: this.sid,
      seq: this.seq++,
      build: GAME_BUILD,
      final: !!final,
      fresh: !!this._fresh,
      dur: Math.round((performance.now() - this.t0) / 1000),
      play: Math.round((this.playMs + this.afkMs) / 1000),
      dev: this.seq === 1 ? this.device() : undefined,
      points: this.points,
      stalls: this.stalls,
      errors: [...this.errors].map(([k, e]) => ({
        k,
        ...e
      })),
      counts: this.counts,
      events: this.events,
      net
    };
    this.points = [];
    this.stalls = [];
    this.errors = new Map();
    this.counts = {};
    this.events = [];
    this.rtt = [];
    return p;
  },
  rttSummary() {
    const s = [...this.rtt].sort((a, b) => a - b);
    return {
      n: s.length,
      p50: s[s.length >> 1],
      p95: s[Math.floor(s.length * 0.95)],
      max: s[s.length - 1]
    };
  },
  hasData() {
    return this.points.length || this.stalls.length || this.errors.size || this.events.length || Object.keys(this.counts).length || this.rtt.length;
  },
  // a packet every 5 minutes (a minute's point is made first if one is half done); the last one as the page goes
  flush(final) {
    if (!this.on()) return;
    if (final && this.frames > 600) this.point();
    if (!this.hasData() && this.seq > 0 && !final) return;
    const body = JSON.stringify(this.packet(final)),
      url = this.base() + '/api/telemetry';
    if (body.length > 120000) return;
    try {
      if (final && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], {
        type: 'text/plain'
      }));else fetch(url, {
        method: 'POST',
        body,
        keepalive: body.length < 60000,
        mode: 'cors'
      }).catch(() => {});
    } catch (e) {}
    this.lastFlush = performance.now();
  },
  // a second's upkeep: pings on a server, the five-minute packet
  tick() {
    const g = this.g,
      now = performance.now();
    if (g && g.net && now - this.lastPing > 10000 && g.net.ws && g.net.ws.readyState === 1) {
      this.lastPing = now;
      const i = ++this.pingSeq;
      this.pings.set(i, now);
      g.net.send({
        t: 'ping',
        i
      });
      if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value);
    }
    if (now - this.lastFlush > 300000) this.flush(false);
  },
  init(g) {
    this.g = g;
    this.prevState = g.state;
    setInterval(() => {
      try {
        this.tick();
      } catch (e) {}
    }, 1000);
    addEventListener('pagehide', () => this.flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush(false);
    });
    addEventListener('error', e => this.error('page', e.message, e.error && e.error.stack || (e.filename ? `${e.filename}:${e.lineno}` : '')));
    addEventListener('unhandledrejection', e => this.error('promise', e.reason && e.reason.message || String(e.reason), e.reason && e.reason.stack));
    try {
      g.renderer.canvas.addEventListener('webglcontextlost', () => {
        this.event('contextlost', {});
        Crumbs.mark('ctx');
      });
    } catch (e) {}
    this.install();
    if (this._fresh) this.event('firstrun', {});
    try {
      Crumbs.init(g);
    } catch (e) {}
    try {
      Instances.init(g);
    } catch (e) {}
    try {
      SensorProbe.init();
    } catch (e) {}
    // (the title screen was already up when this started: the time it took from opening the page)
    if (g.state === 'title' && !this.titleAt) {
      this.titleAt = performance.now();
      this.event('title', {
        ms: Math.round(this.titleAt)
      });
    }
  }
};

// ---- the hooks ----
(() => {
  const _init = Game.prototype.init;
  Game.prototype.init = async function (...a) {
    const r = await _init.apply(this, a);
    try {
      Telemetry.init(this);
    } catch (e) {}
    return r;
  };
  const _frame = PerfMon.frame;
  PerfMon.frame = function (dt, cpu, chunk, g) {
    const r = _frame.call(this, dt, cpu, chunk, g);
    try {
      Telemetry.frame(dt, cpu, chunk, this.renderMs || 0);
    } catch (e) {}
    return r;
  };
  // the renderer's side of a frame (render.js): nothing is drawn while the WebGL context is lost (its notice is up and a
  // tap reloads); inFrame - a canvas resize asked for between frames waits for the next one (it showed a black frame)
  const _render = Game.prototype.render;
  Game.prototype.render = function (a, now) {
    const r = this.renderer;
    if (r && r.lost) {
      if (r.lostFrame) r.lostFrame(this);
      return;
    }
    if (r) r.inFrame = true;
    try {
      return _render.call(this, a, now);
    } finally {
      if (r) r.inFrame = false;
    }
  };
  const _err = Game.prototype.reportError;
  Game.prototype.reportError = function (where, e, quiet) {
    Telemetry.error(where, e && e.message || e, e && e.stack);
    return _err.call(this, where, e, quiet);
  };
  const _open = UI.prototype.open;
  UI.prototype.open = function (screen) {
    if (screen && screen.constructor) {
      Telemetry.count('screen:' + screen.constructor.name);
      Crumbs.mark('o:' + screen.constructor.name.replace(/Screen$/, ''));
    }
    return _open.call(this, screen);
  };
  const _death = Game.prototype.onPlayerDeath;
  Game.prototype.onPlayerDeath = function (src) {
    Telemetry.count('death:' + (src && src.type || 'other'));
    return _death.call(this, src);
  };
  const _load = Game.prototype.loadWorld;
  Game.prototype.loadWorld = function (...a) {
    Telemetry.count('world:load');
    return _load.apply(this, a);
  };
  const _create = Game.prototype.createWorld;
  Game.prototype.createWorld = function (...a) {
    Telemetry.count('world:create:' + (a[2] || ''));
    return _create.apply(this, a);
  };
  if (typeof cmdExec === 'function') {
    const _cmd = cmdExec;
    // (a command block's commands aren't counted: a repeating one would run 20 a second)
    cmdExec = function (g, text, src) {
      if (!src) Telemetry.count('cmd:' + String(text).slice(1).split(/\s+/)[0].replace(/^minecraft:/, '').slice(0, 20));
      return _cmd(g, text, src);
    };
  }
  if (typeof NetClient !== 'undefined') {
    const _om = NetClient.prototype.onMessage;
    NetClient.prototype.onMessage = function (m) {
      if (m && m.t === 'pong') {
        const t = Telemetry.pings.get(m.i);
        if (t) {
          Telemetry.pings.delete(m.i);
          if (Telemetry.rtt.length < 500) Telemetry.rtt.push(Math.round(performance.now() - t));
        }
        return;
      }
      if (m && m.t === 'notice' && !this.roomWaitAt) this.roomWaitAt = performance.now();
      if (m && m.t === 'room') {
        Telemetry.event('room', {
          wait: this.roomWaitAt ? Math.round(performance.now() - this.roomWaitAt) : 0
        });
        Telemetry.count('net:room');
      }
      return _om.call(this, m);
    };
    const _fail = NetClient.prototype.fail;
    NetClient.prototype.fail = function (reason) {
      Telemetry.count('net:fail');
      Telemetry.event('netfail', {
        why: String(reason || '').slice(0, 80)
      });
      return _fail.call(this, reason);
    };
  }
  // (the last things done, for Crumbs: the window's size, the on-screen keyboard's field, errors)
  const _rs = Game.prototype.resize;
  Game.prototype.resize = function (...a) {
    try {
      Crumbs.mark('rs:' + innerWidth + 'x' + innerHeight);
    } catch (e) {}
    return _rs.apply(this, a);
  };
  const _si = UI.prototype.showInput,
    _hi = UI.prototype.hideInput;
  UI.prototype.showInput = function (...a) {
    try {
      if (this.input.style.display !== 'block') Crumbs.mark('kb+');
    } catch (e) {}
    return _si.apply(this, a);
  };
  UI.prototype.hideInput = function (...a) {
    try {
      if (this.input.style.display === 'block') Crumbs.mark('kb-');
    } catch (e) {}
    return _hi.apply(this, a);
  };
  const _err2 = Game.prototype.reportError;
  Game.prototype.reportError = function (where, e, quiet) {
    try {
      Crumbs.mark('e:' + String(where || '').slice(0, 14));
    } catch (x) {}
    return _err2.call(this, where, e, quiet);
  };
})();

// ---- the last moments of a page that died (11-07: a page killed on Apple devices sends nothing, and the reopened one
// can't say what it was doing - one in five iPhone sessions in the Bilibili app since the 11-06 version). Every 2 s and
// at each mark, a few words about this page go into the page's storage (what state and screen, the canvases' sizes,
// the last 10 things done); leaving the page properly marks it ended. The next page to start sends any that never
// ended, as a 'died' event: how long it lived, whether it was hidden (killed in the background) or on screen. Nothing
// about the player - the same kind of facts as the rest of the statistics ----
const Crumbs = {
  KEY: 'mcjs-crumbs',
  marks: [],
  g: null,
  lastW: 0,
  mark(k) {
    this.marks.push(Math.round((performance.now() - Telemetry.t0) / 1000) + ':' + k);
    if (this.marks.length > 10) this.marks.shift();
    if (this.g && performance.now() - this.lastW > 200) this.save();
  },
  read() {
    try {
      const o = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch (e) {
      return {};
    }
  },
  save(end) {
    const g = this.g;
    if (!g) return;
    this.lastW = performance.now();
    try {
      const r = g.renderer,
        u = g.ui,
        sc = u && u.screen,
        inp = u && u.input;
      const rec = {
        at: Date.now(),
        up: Math.round((performance.now() - Telemetry.t0) / 1000),
        v: GAME_BUILD,
        st: g.state,
        sc: sc ? sc.constructor.name : '',
        hid: !!document.hidden,
        gl: r ? r.canvas.width + 'x' + r.canvas.height : '',
        ui: u && u.canvas ? u.canvas.width + 'x' + u.canvas.height : '',
        rs: r ? r.resScale : 0,
        sec: r && r.sections ? r.sections.size : 0,
        mb: r && r.arena ? Math.round(r.arena.total / 1048576) : 0,
        ent: g.entities ? g.entities.length : 0,
        net: !!g.net,
        kb: !!(inp && document.activeElement === inp),
        lost: !!(r && r.lost),
        old: !!Instances.stale,
        mk: this.marks.join(' '),
        end: end ? 1 : 0
      };
      const all = this.read();
      all[Telemetry.sid] = rec;
      const ids = Object.keys(all);
      if (ids.length > 4) for (const k of ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - 4)) delete all[k];
      localStorage.setItem(this.KEY, JSON.stringify(all));
    } catch (e) {}
  },
  init(g) {
    this.g = g;
    // (the pages before this one that never ended: each sent once, then forgotten. One written in the last 5 s may be
    // a page still open - a second one: Instances - and is left)
    const all = this.read(),
      now = Date.now();
    for (const [sid, r] of Object.entries(all)) {
      if (sid === Telemetry.sid || !r || typeof r !== 'object') continue;
      if (!r.end && now - r.at < 5000) continue;
      if (!r.end && now - r.at < 6 * 3600e3) Telemetry.event('died', {
        ago: Math.round((now - r.at) / 1000),
        up: r.up,
        v: r.v,
        st: r.st,
        sc: r.sc,
        hid: r.hid,
        gl: r.gl,
        ui: r.ui,
        rs: r.rs,
        sec: r.sec,
        mb: r.mb,
        ent: r.ent,
        net: r.net,
        kb: r.kb,
        lost: r.lost,
        old: r.old,
        mk: String(r.mk || '').slice(0, 260)
      });
      delete all[sid];
    }
    try {
      localStorage.setItem(this.KEY, JSON.stringify(all));
    } catch (e) {}
    if (Telemetry.events.some(e => e.type === 'died')) setTimeout(() => Telemetry.flush(false), 4000);
    setInterval(() => this.save(), 2000);
    addEventListener('pagehide', () => this.save(true));
    // (back from the background: not ended after all - a page hidden and shown again fires no pagehide on some phones)
    document.addEventListener('visibilitychange', () => {
      this.mark(document.hidden ? 'hid' : 'vis');
    });
    document.addEventListener('fullscreenchange', () => this.mark('fs'));
    document.addEventListener('webkitfullscreenchange', () => this.mark('fs'));
    this.save();
  }
};

// ---- one game page at a time (11-07). In the Bilibili app 去三连 opens the video's own page, and that page has the
// game's entry on it: players came back by it and had a second game page open, the first behind it (telemetry: new
// sessions started while the old one was still sending - and the old one, gone back to, would save its older world over
// the new page's). A page on screen says so (at start, and each time it comes back on screen); a page that hears of a
// newer one saves once if it is on screen (two tabs on a computer), then writes nothing more - the saves are refused -
// pauses, and shows a notice whose button reloads it (and so makes it the newest). A page opened out of sight (a preload)
// says nothing until it is shown ----
const Instances = {
  stale: false,
  leaving: false,
  at: 0,
  ch: null,
  g: null,
  key() {
    return 'mcjs-inst:' + location.pathname;
  },
  init(g) {
    this.g = g;
    try {
      this.ch = new BroadcastChannel(this.key());
      this.ch.onmessage = e => this.heard(e.data);
    } catch (e) {}
    addEventListener('storage', e => {
      if (e.key === this.key() && e.newValue) {
        try {
          this.heard(JSON.parse(e.newValue));
        } catch (x) {}
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.shown();
    });
    // (the saves: refused once stale - wrapped here, after every file has wrapped them its own way: cloudsave.js, p2p.js)
    if (typeof DB !== 'undefined') for (const k of ['putChunks', 'putWorld']) {
      const f = DB[k];
      if (typeof f !== 'function') continue;
      DB[k] = function (...a) {
        return Instances.stale ? Promise.resolve() : f.apply(this, a);
      };
    }
    if (!document.hidden) this.announce();
  },
  announce() {
    this.at = Date.now();
    const m = {
      t: 'hello',
      id: Telemetry.sid,
      at: this.at
    };
    try {
      localStorage.setItem(this.key(), JSON.stringify(m));
    } catch (e) {}
    try {
      if (this.ch) this.ch.postMessage(m);
    } catch (e) {}
  },
  // on screen again: a newer page said hello meanwhile (its message may not have reached this one, asleep behind it)
  shown() {
    if (this.stale || this.leaving) return;
    let m = null;
    try {
      m = JSON.parse(localStorage.getItem(this.key()) || 'null');
    } catch (e) {}
    if (m && m.id !== Telemetry.sid && m.at > this.at && this.at) {
      this.goStale();
      return;
    }
    this.announce();
  },
  heard(m) {
    if (!m || m.t !== 'hello' || m.id === Telemetry.sid || this.stale || this.leaving) return;
    if (this.at && (m.at > this.at || m.at === this.at && m.id > Telemetry.sid)) this.goStale();
  },
  async goStale() {
    if (this.stale || this.leaving) return;
    this.leaving = true;
    const g = this.g;
    try {
      Crumbs.mark('old');
      Telemetry.count('inst_old');
      Telemetry.event('inst_old', {
        st: g.state,
        hid: !!document.hidden
      });
    } catch (e) {}
    // (on screen - two tabs: what it has is the newest, saved; out of sight it was saved when it was hidden: main.js)
    try {
      if (g.state === 'play' && !g.net && !document.hidden && g.saveWorld) await Promise.race([g.saveWorld(true), new Promise(r => setTimeout(r, 3000))]);
    } catch (e) {}
    this.stale = true;
    try {
      if (g.state === 'play' && !g.net && g.ui && !(g.ui.screen && g.ui.screen.pauses) && typeof PauseScreen !== 'undefined') g.ui.open(new PauseScreen(g));
    } catch (e) {}
    try {
      if (g.net && g.net.close) g.net.close();
    } catch (e) {}
    try {
      if (g.releasePointer) g.releasePointer();
    } catch (e) {}
    try {
      if (Sound.sleep) Sound.sleep('old');
    } catch (e) {}
    try {
      this.notice();
    } catch (e) {}
  },
  notice() {
    if (this.el || typeof document === 'undefined') return;
    const d = this.el = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:60;box-sizing:border-box;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.9);color:#fff;font:15px "Microsoft YaHei",sans-serif;text-align:center';
    const line = (text, css) => {
      const e = document.createElement('div');
      e.textContent = text;
      if (css) e.style.cssText = css;
      d.appendChild(e);
      return e;
    };
    line('游戏在另一个页面里打开了', 'font-size:22px;font-weight:bold;margin-bottom:6px');
    line('这个页面已经停下，不会再存档，免得覆盖另一个页面的进度');
    const btn = line('点这里在这个页面继续（会重新载入）', 'margin-top:14px;padding:10px 28px;border:2px solid #fff;background:rgba(255,255,255,0.12)');
    let going = false;
    d.addEventListener('pointerup', e => {
      e.preventDefault();
      e.stopPropagation();
      if (going) return;
      going = true;
      btn.textContent = '正在重新载入…';
      try {
        Telemetry.count('inst_reload');
        Telemetry.flush(false);
      } catch (x) {}
      // (not 'play': the page's "leave?" prompt asks only then - nothing here is left to save)
      try {
        this.g.state = 'boot';
      } catch (x) {}
      location.reload();
    });
    for (const k of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown', 'wheel', 'keydown']) d.addEventListener(k, e => e.stopPropagation(), {
      passive: true
    });
    (document.getElementById('stage') || document.body).appendChild(d);
  }
};

// ---- #A1 陀螺仪, step one: can this device's page hear the gyroscope at all? Out of sight, once per install and build:
// listens 3 s for deviceorientation / devicemotion, reads the frame's permissions policy, and asks iOS's requestPermission
// with no tap behind it - WebKit then answers without a prompt: 'denied' when the frame may not have them, a
// NotAllowedError when only a tap is missing. (The game runs in a cross-origin iframe whose allow= names only pointer-lock:
// bilibili.com's Toy shell, 11-10; voxpool asks the same way, and gives up after 2 s without an event) ----
const SensorProbe = {
  key: 'mcjs-sensor',
  lastInput: 0,
  tries: 0,
  init() {
    try {
      if (localStorage.getItem(this.key) === GAME_BUILD) return;
    } catch (e) {}
    for (const k of ['pointerdown', 'touchstart', 'mousedown', 'keydown']) addEventListener(k, () => {
      this.lastInput = performance.now();
    }, {
      capture: true,
      passive: true
    });
    setTimeout(() => this.attempt(), 8000);
  },
  // never near a tap: a requestPermission with one behind it puts up iOS's prompt. (Each wait here is over a second, so
  // WebKit carries no tap into it, and 6 s is longer than a tap's activation lasts)
  attempt() {
    if (this.done) return;
    const quiet = performance.now() - this.lastInput > 6000 && !(navigator.userActivation && navigator.userActivation.isActive);
    if (!quiet || document.hidden || !Telemetry.on()) {
      if (++this.tries < 45) setTimeout(() => this.attempt(), 4000);
      return;
    }
    this.run().then(r => Telemetry.event('sensor', r), () => {});
  },
  async run(ms = 3000) {
    this.done = true;
    try {
      localStorage.setItem(this.key, GAME_BUILD);
    } catch (e) {}
    const W = window,
      DOE = W.DeviceOrientationEvent,
      DME = W.DeviceMotionEvent;
    const wait = t => new Promise(res => setTimeout(res, t));
    const r = {
      fr: W.top !== W.self ? 1 : 0,
      sec: W.isSecureContext ? 1 : 0,
      api: ''
    };
    [['o', !!DOE], ['m', !!DME], ['r', DOE && typeof DOE.requestPermission === 'function'], ['R', DME && typeof DME.requestPermission === 'function'], ['a', 'ondeviceorientationabsolute' in W], ['s', typeof W.Gyroscope === 'function']].forEach(([k, c]) => {
      if (c) r.api += k;
    });
    const pol = document.permissionsPolicy || document.featurePolicy;
    if (pol && typeof pol.allowsFeature === 'function') r.fp = ['gyroscope', 'accelerometer', 'magnetometer'].map(f => {
      try {
        return pol.allowsFeature(f) ? 1 : 0;
      } catch (e) {
        return 'x';
      }
    }).join('');
    // the events: when the first came (ms, -1 none), how many, and whether they carried numbers (null: no sensor)
    const t0 = performance.now();
    let hid = !!document.hidden;
    const o = {
        at: -1,
        n: 0,
        v: 0
      },
      m = {
        at: -1,
        n: 0,
        v: 0,
        iv: 0
      };
    const onO = e => {
      if (o.at < 0) o.at = Math.round(performance.now() - t0);
      o.n++;
      if (e.alpha != null || e.beta != null || e.gamma != null) o.v = 1;
    };
    const onM = e => {
      if (m.at < 0) {
        m.at = Math.round(performance.now() - t0);
        m.iv = Math.round(+e.interval || 0);
      }
      m.n++;
      const a = e.accelerationIncludingGravity,
        rr = e.rotationRate;
      if (a && a.x != null || rr && rr.alpha != null) m.v = 1;
    };
    const onV = () => {
      if (document.hidden) hid = true;
    };
    addEventListener('deviceorientation', onO, {
      passive: true
    });
    addEventListener('devicemotion', onM, {
      passive: true
    });
    document.addEventListener('visibilitychange', onV);
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const q = async name => {
          try {
            const s = await Promise.race([navigator.permissions.query({
              name
            }), wait(1500)]);
            return s ? s.state : 'slow';
          } catch (e) {
            return 'x';
          }
        };
        r.pq = (await q('gyroscope')) + '/' + (await q('accelerometer'));
      }
      const ask = async C => {
        if (!C || typeof C.requestPermission !== 'function') return undefined;
        try {
          return String(await Promise.race([C.requestPermission(), wait(3000).then(() => 'slow')]));
        } catch (e) {
          return 'err:' + (e && e.name || '') + ':' + String(e && e.message || '').slice(0, 100);
        }
      };
      r.rp = await ask(DOE);
      r.rpm = await ask(DME);
      await wait(Math.max(ms - (performance.now() - t0), r.rp === 'granted' || r.rpm === 'granted' ? 1500 : 0));
    } finally {
      removeEventListener('deviceorientation', onO);
      removeEventListener('devicemotion', onM);
      document.removeEventListener('visibilitychange', onV);
    }
    return Object.assign(r, {
      oe: o.at,
      on: o.n,
      ov: o.v,
      me: m.at,
      mn: m.n,
      mv: m.v,
      mi: m.iv,
      hid: hid ? 1 : 0
    });
  }
};

// ---- feedback (Options -> 遥测数据 -> 反馈问题, the pause menu, the title screen) ----
const FEEDBACK_KINDS = [['bug', '错误（bug）'], ['lag', '卡顿 / 性能'], ['idea', '建议'], ['other', '其他']];
// a feedback sent (FeedbackScreen, and the AI companion for the player - companion.js), with what the game is like now
// -> null, or what went wrong
async function postFeedback(g, kind, text, shot) {
  if (!Telemetry.base()) return '没有设置联机服务器，无法发送';
  // the recent performance: the points not yet sent and the minute going on
  if (Telemetry.frames > 120) Telemetry.point();
  const ctx = {
    build: GAME_BUILD,
    id: Telemetry.install(),
    dev: Telemetry.device(),
    perf: Telemetry.points.slice(-5),
    stalls: Telemetry.stalls.slice(-10),
    errors: [...Telemetry.errors].slice(-10).map(([k, e]) => ({
      k,
      ...e
    })),
    mode: g.net ? 'room' : g.state === 'play' ? 'single' : g.state,
    room: g.net && g.net.room ? g.net.room.code : null,
    dim: g.dim,
    settings: {
      rd: g.settings.renderDist,
      preset: g.settings.preset,
      shaders: g.settings.shaders,
      dyn: g.settings.dynRes
    }
  };
  try {
    const res = await fetch(Telemetry.base() + '/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        v: 1,
        kind,
        text,
        shot,
        ctx
      })
    });
    const r = await res.json().catch(() => ({
      error: '游戏正在更新中…请稍后'
    }));
    return !res.ok || r.error ? r.error || 'HTTP ' + res.status : null;
  } catch (e) {
    return '游戏正在更新中…请稍后';
  }
}
class FeedbackScreen extends FormScreen {
  constructor(game, parent, shot) {
    super(game, '反馈问题', parent);
    // the world stands still while the report is written, in single player (players' feedback 2026-10-31)
    this.pauses = game.state === 'play' && !game.net;
    this.kind = 0;
    this.text = '';
    this.withShot = !!shot;
    this.shot = shot || null;
    this.sending = false;
    this.done = false;
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      y = Math.max(40, Math.floor(u.h / 2) - 80);
    this.addField('text', cx - 150, y + 36, 300, '描述（最多 500 字）', 500);
    this.widgets = this.done ? [{
      text: this.note,
      x: cx,
      y: y + 60,
      color: this.noteColor
    }, {
      x: cx - 100,
      y: y + 90,
      w: 200,
      h: 20,
      label: '完成',
      onClick: () => this.back()
    }] : [{
      x: cx - 150,
      y: y,
      w: 300,
      h: 20,
      label: () => '类型：' + FEEDBACK_KINDS[this.kind][1],
      onClick: () => {
        this.kind = (this.kind + 1) % FEEDBACK_KINDS.length;
      }
    }, {
      x: cx - 150,
      y: y + 64,
      w: 300,
      h: 20,
      label: () => '附带截图：' + (this.withShot ? '是' : '否'),
      enabled: !!this.shot,
      tip: this.shot ? ['打开这个界面之前的游戏画面'] : ['没有可用的画面'],
      onClick: () => {
        this.withShot = !this.withShot;
      }
    }, {
      x: cx - 150,
      y: y + 126,
      w: 145,
      h: 20,
      label: () => this.sending ? '发送中…' : '发送',
      enabled: !this.sending,
      onClick: () => this.submit()
    }, {
      x: cx + 5,
      y: y + 126,
      w: 145,
      h: 20,
      label: '取消',
      onClick: () => this.back()
    }];
    if (!this.done) this.focus('text');
  }
  drawExtra(ui) {
    if (this.done) return;
    this.drawFields(ui);
    const y = Math.max(40, Math.floor(ui.h / 2) - 80);
    Font.center(ui.ctx, '会一起发送：游戏版本、设备和显卡、最近几分钟的帧率、', ui.w / 2, y + 90, '#A0A0A0');
    Font.center(ui.ctx, '单机还是房间、最近的报错', ui.w / 2, y + 100, '#A0A0A0');
    Font.center(ui.ctx, '不会发送你的名字、聊天记录或存档', ui.w / 2, y + 110, '#A0A0A0');
  }
  back() {
    this.game.ui.hideInput();
    this.game.ui.open(this.parent);
  }
  onEsc() {
    this.back();
  }
  async submit() {
    const g = this.game,
      text = String(this.text || '').trim();
    if (text.length < 2) {
      this.note = '请先写几句描述';
      this.noteColor = '#FF5555';
      return;
    }
    if (!Telemetry.base()) {
      this.note = '没有设置联机服务器，无法发送';
      this.noteColor = '#FF5555';
      return;
    }
    this.sending = true;
    this.note = '';
    g.ui.hideInput();
    const err = await postFeedback(g, FEEDBACK_KINDS[this.kind][0], text, this.withShot ? this.shot : null);
    this.sending = false;
    this.done = true;
    this.note = err ? '发送失败：' + err : '已发送，谢谢你的反馈！';
    this.noteColor = err ? '#FF5555' : '#55FF55';
    if (!err) this.text = '';
    this.layout();
  }
}
// the game's picture right now, made smaller (a JPEG of at most 960 pixels across), for a feedback
function feedbackShot(g) {
  try {
    // (drawn again now without the menu over it: the canvas keeps no picture between frames)
    if (g.state === 'play') {
      const sc = g.ui.screen;
      g.ui.screen = null;
      try {
        g.render(g.lastA || 0, performance.now());
      } finally {
        g.ui.screen = sc;
      }
    }
    const c = g.renderer.canvas,
      k = Math.min(1, 960 / c.width),
      o = document.createElement('canvas');
    o.width = Math.round(c.width * k);
    o.height = Math.round(c.height * k);
    o.getContext('2d').drawImage(c, 0, 0, o.width, o.height);
    const url = o.toDataURL('image/jpeg', 0.7);
    return url.length > 30 && url.length < 900000 ? url : null;
  } catch (e) {
    return null;
  }
}

// ---- Options -> 遥测数据: the switch, what is collected, the feedback button ----
class TelemetryScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '遥测数据');
    this.parent = parent;
    this.pauses = game.state === 'play';
    this.titleY = 12;
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      g = this.game,
      s = g.settings;
    this.widgets = [{
      x: cx - 155,
      y: u.h - 80,
      w: 310,
      h: 20,
      label: () => '上传匿名统计数据：' + (s.telemetry !== false ? '开' : '关'),
      onClick: () => {
        s.telemetry = s.telemetry === false;
        g.saveSettings();
      }
    }, {
      x: cx - 155,
      y: u.h - 55,
      w: 150,
      h: 20,
      label: '反馈问题…',
      onClick: () => g.ui.open(new FeedbackScreen(g, this, null))
    }, {
      x: cx + 5,
      y: u.h - 55,
      w: 150,
      h: 20,
      label: '完成',
      onClick: () => g.ui.open(this.parent)
    }];
  }
  drawExtra(ui) {
    const lines = ['为了让游戏更流畅、少出错，游戏会把匿名的统计数据发到我们的服务器：', '', '• 设备：显卡型号、处理器线程数、内存档位、屏幕和刷新率、浏览器和系统', '• 性能：每分钟的帧率和卡顿、内存、实体和区块数量、画质设置', '• 出错：报错信息（只有出错的代码位置）', '• 使用：打开过哪些界面、用过哪些命令（只有名字）、联机延迟和掉线', '', '不收集：你的名字、聊天内容、存档、IP 地址（服务器只保存打乱后的编号）。', '数据只用来改进游戏和写研究报告，原始数据保存 180 天。'];
    lines.forEach((t, i) => Font.draw(ui.ctx, t, Math.round(ui.w / 2 - 155), 34 + i * 11, t.startsWith('不收集') ? '#FFFF55' : '#E0E0E0'));
  }
  onEsc() {
    this.game.ui.open(this.parent);
  }
}
