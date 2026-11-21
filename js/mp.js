'use strict';

// ---- the room service is gone -------------------------------------------------------------
// This build has no account/room/news/live backend any more: the save password took its place, and
// multiplayer is a vanilla-style server list (below). A few older modules (p2p, news, checkin, live,
// mods_ui, onboard) still ask RoomService whether there is a service before they do anything; this
// inert stand-in answers "no" to every one of them, so they stay quiet instead of throwing.
// base() === '' is exactly the test those call sites already use for "not configured".
if (typeof window.RoomService === 'undefined') {
  window.RoomService = {
    base: () => '',
    fromUrl: () => null,
    key: () => '',
    api: async () => {
      throw new Error('本版已无账号服务（登录改为存档密码）');
    }
  };
}

// 多人游戏 —— 原版风格的服务器列表。
//
// 这里是「加入服务器」这一侧的全部界面与状态：服务器列表（名称 / 地址 / 延迟 / 人数）、添加与编辑、
// 删除（三次点头式确认，与原版一致）、直接连接、离线用户名。会话本身仍由 js/net.js 的 NetClient 负责：
// 它连的是 WebSocket 地址（中转服务，multiplayer/proxy）；一条服务器记录里的 host:port 由中转去连
// 真实的 Minecraft 服务器，浏览器这一侧不碰 TCP。
//
// 服务器列表存在 localStorage 的 'mcjs-servers' 里，格式是一串对象：
//   { name, ip, port, proxy, favicon?, lastPlayed?, ping?, online?, max?, motd?, version?, hidden? }
// proxy 为空时按 origin 推一个默认中转（见 defaultProxy()）。

const MP_KEY = 'mcjs-servers';

// ---- the list: load, save, default entries ------------------------------------------------

const Multiplayer = {
  // the proxy that turns a real server into a WebSocket: <scheme>://<host>:<port>/ws .
  // A page served from a static host has no proxy of its own, so the default is the same host on
  // the bridge's port; ?proxy=<url> overrides it for a session (testing, or a bridge elsewhere).
  defaultProxy() {
    const q = new URLSearchParams(location.search).get('proxy');
    if (q) return q.replace(/\/+$/, '');
    const saved = window.MP_PROXY; // set in js/mp-config.js when this deployment has a fixed bridge
    if (saved) return String(saved).replace(/\/+$/, '');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname || 'localhost';
    return scheme + '://' + host + ':8780';
  },
  // a server record's WebSocket address: the entry's own proxy, else the default
  ws(entry) {
    const base = (entry.proxy || this.defaultProxy()).replace(/\/+$/, '');
    if (/\/ws$/.test(base)) return base;
    return base + '/ws';
  },
  // the address the entry is for, written the way people write it: host[:port]
  addr(entry) {
    return entry.port && Number(entry.port) !== 25565 ? entry.ip + ':' + entry.port : entry.ip;
  },
  list() {
    let raw = null;
    try {
      raw = localStorage.getItem(MP_KEY);
    } catch (e) {}
    if (raw) {
      try {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) return a.filter(s => s && typeof s.ip === 'string' && s.ip);
      } catch (e) {}
    }
    return this.seedList();
  },
  save(list) {
    try {
      localStorage.setItem(MP_KEY, JSON.stringify(list));
    } catch (e) {}
  },
  // the servers a fresh install starts with: the tutorial maps that ship with this build, plus a
  // couple of well-known public ones that are worth trying. They are ordinary entries: editable,
  // deletable, and only pinged when the list is shown.
  seedList() {
    return [{
      name: 'Hypixel',
      ip: 'mc.hypixel.net',
      port: 25565
    }, {
      name: 'Minehut',
      ip: 'play.minehut.com',
      port: 25565
    }];
  },
  // ping one server through the bridge: {online, max, version, motd} or null.
  // The bridge answers {t:'ping', online, max, version, motd} for a {t:'ping', host, port} written
  // to its socket; a bridge that doesn't know the message sends nothing, which the timeout turns
  // into "unknown" (drawn as a crossed-out signal bar, like vanilla's can't-reach).
  async ping(entry, timeout = 6000) {
    const url = this.ws(entry);
    return new Promise(resolve => {
      let done = false,
        ws = null,
        timer = 0;
      const fin = v => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws && ws.close();
        } catch (e) {}
        resolve(v);
      };
      timer = setTimeout(() => fin(null), timeout);
      try {
        ws = new WebSocket(url);
      } catch (e) {
        fin(null);
        return;
      }
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({
            t: 'ping',
            host: entry.ip,
            port: Number(entry.port) || 25565
          }));
        } catch (e) {
          fin(null);
        }
      };
      ws.onmessage = e => {
        if (typeof e.data !== 'string') return;
        let m = null;
        try {
          m = JSON.parse(e.data);
        } catch (e) {
          return;
        }
        if (!m) return;
        if (m.t === 'ping' || m.t === 'pong') fin({
          online: m.online ?? null,
          max: m.max ?? null,
          version: m.version || '',
          motd: m.motd || '',
          ms: m.ms ?? null
        });else if (m.t === 'error') fin(null);
      };
      ws.onerror = () => fin(null);
      ws.onclose = () => fin(null);
    });
  }
};

// ---- the screen: the server list (vanilla's multiplayer list) ------------------------------

class ServerListScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '多人游戏');
    this.parent = parent;
    this.titleY = 16;
    this.entries = [];
    this.selected = -1;
    this.pinging = false;
    this.page = 0;
    this.userName = (typeof Account !== 'undefined' && Account.loggedIn && Account.name) || game.settings.netName || 'Steve';
    this.status = '';
    this.load();
  }
  load() {
    this.entries = Multiplayer.list().map(e => ({
      ...e
    }));
    if (this.selected >= this.entries.length) this.selected = this.entries.length - 1;
    if (this.selected < 0 && this.entries.length) this.selected = 0;
  }
  // the row height and how many fit: vanilla's list is a scrolling box between the title and the buttons
  metrics() {
    const u = this.game.ui;
    const listTop = 32,
      listBottom = u.h - 60;
    const rowH = 36;
    return {
      listTop,
      listBottom,
      rowH,
      rows: Math.max(1, Math.floor((listBottom - listTop) / rowH)),
      cx: u.w / 2,
      boxW: Math.min(400, u.w - 20)
    };
  }
  layout() {
    const u = this.game.ui,
      m = this.metrics(),
      cx = m.cx,
      n = m.rows;
    const pages = Math.max(1, Math.ceil(this.entries.length / n));
    this.page = clamp(this.page, 0, pages - 1);
    const bw = (m.boxW - 8) / 2,
      by = u.h - 54;
    this.widgets = [{
      x: cx - m.boxW / 2,
      y: by,
      w: bw,
      h: 20,
      label: '加入服务器',
      enabled: this.selected >= 0 && this.selected < this.entries.length,
      onClick: () => this.joinSelected()
    }, {
      x: cx - m.boxW / 2 + bw + 8,
      y: by,
      w: bw,
      h: 20,
      label: '直接连接',
      onClick: () => {
        this.game.ui.hideInput();
        this.game.ui.open(new DirectConnectScreen(this.game, this, this.userName));
      }
    }, {
      x: cx - m.boxW / 2,
      y: by + 24,
      w: bw,
      h: 20,
      label: '添加服务器',
      onClick: () => {
        this.game.ui.hideInput();
        this.game.ui.open(new EditServerScreen(this.game, this, null));
      }
    }, {
      x: cx - m.boxW / 2 + bw + 8,
      y: by + 24,
      w: bw,
      h: 20,
      label: '编辑',
      enabled: this.selected >= 0 && this.selected < this.entries.length,
      onClick: () => {
        this.game.ui.hideInput();
        this.game.ui.open(new EditServerScreen(this.game, this, this.entries[this.selected]));
      }
    }, {
      x: cx - m.boxW / 2,
      y: by + 48,
      w: bw,
      h: 20,
      label: this.pinging ? '正在刷新…' : '刷新',
      enabled: !this.pinging,
      onClick: () => this.refresh()
    }, {
      x: cx - m.boxW / 2 + bw + 8,
      y: by + 48,
      w: bw,
      h: 20,
      label: '返回',
      onClick: () => this.back()
    }];
    // a name row above the list, like vanilla's (this build has no account service any more: the
    // name is local, and a server that allows offline play accepts it as it is)
    this.nameBox = {
      x: cx - m.boxW / 2,
      y: 16,
      w: m.boxW,
      h: 20
    };
    // paging: arrows at the right of the list, when there is more than a page
    if (pages > 1) {
      this.widgets.push({
        x: cx + m.boxW / 2 - 24,
        y: m.listTop - 1,
        w: 22,
        h: 11,
        label: '▲',
        enabled: this.page > 0,
        onClick: () => {
          this.page--;
          this.layout();
        }
      }, {
        x: cx + m.boxW / 2 - 24,
        y: m.listBottom - 12,
        w: 22,
        h: 11,
        label: '▼',
        enabled: this.page < pages - 1,
        onClick: () => {
          this.page++;
          this.layout();
        }
      });
    }
    this.pages = pages;
  }
  // a click on the list picks a row (and a double click joins, like vanilla)
  mouseDown(ui, mx, my, b) {
    const m = this.metrics();
    if (b === 0 && mx >= m.cx - m.boxW / 2 && mx <= m.cx + m.boxW / 2 && my >= m.listTop && my < m.listBottom) {
      const i = this.page * m.rows + Math.floor((my - m.listTop) / m.rowH);
      if (i >= 0 && i < this.entries.length) {
        const was = this.selected;
        this.selected = i;
        this.layout();
        if (was === i) {
          this.joinSelected();
          return;
        }
        Sound.click();
        return;
      }
    }
    super.mouseDown(ui, mx, my, b);
  }
  back() {
    this.game.ui.hideInput();
    this.game.ui.open(this.parent || new TitleScreen(this.game));
  }
  onEsc() {
    this.back();
  }
  // the offline user name, as typed in the box above the list
  okName() {
    const n = String(this.userName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    if (!n) {
      this.status = '先输入玩家名（英文字母、数字、下划线）';
      this.statusBad = true;
      return null;
    }
    this.userName = n;
    this.game.settings.netName = n;
    this.game.saveSettings();
    return n;
  }
  async refresh() {
    if (this.pinging || !this.entries.length) return;
    this.pinging = true;
    this.status = '';
    this.layout();
    const proxy = Multiplayer.defaultProxy();
    // a few at a time: a phone's little connection pool, and the bridge may be on a slow link
    const queue = this.entries.map((e, i) => [e, i]);
    const CONC = 4;
    const run = async () => {
      while (queue.length) {
        const [e, i] = queue.shift();
        const r = await Multiplayer.ping(e);
        const cur = this.entries[i];
        if (cur) {
          cur.ping = r ? (r.ms ?? true) : false;
          cur.online = r ? r.online : null;
          cur.max = r ? r.max : null;
          cur.version = r ? r.version : '';
          cur.motd = r ? r.motd : '';
          cur.checked = Date.now();
        }
        if (this.game.ui.screen === this) this.layout();
      }
    };
    await Promise.all(Array.from({
      length: Math.min(CONC, this.entries.length)
    }, run));
    this.pinging = false;
    const ok = this.entries.filter(e => e.ping).length;
    this.status = ok ? `在线 ${ok} / ${this.entries.length}` : '全部无法连接（检查中转地址：' + proxy + '）';
    this.statusBad = !ok;
    this.savePings();
    if (this.game.ui.screen === this) this.layout();
  }
  savePings() {
    // the pings are kept with the list so the next visit shows them while it refreshes
    const cur = Multiplayer.list();
    const byIp = new Map(cur.map(e => [e.ip + ':' + (e.port || 25565), e]));
    for (const e of this.entries) {
      const t = byIp.get(e.ip + ':' + (e.port || 25565));
      if (t) {
        t.ping = e.ping;
        t.online = e.online;
        t.max = e.max;
        t.version = e.version;
        t.motd = e.motd;
        t.checked = e.checked;
      }
    }
    Multiplayer.save(cur);
  }
  joinSelected() {
    const e = this.entries[this.selected];
    if (!e) return;
    const n = this.okName();
    if (!n) return;
    const g = this.game;
    g.ui.hideInput();
    e.lastPlayed = Date.now();
    Multiplayer.save(this.entries);
    g.ui.open(new LoadingScreen(g, '正在连接 ' + Multiplayer.addr(e) + '…'));
    // (NetClient takes over from here; a failure comes back through Game.prototype.leaveServer)
    g.joinServer(Multiplayer.ws(e), n);
  }
  drawExtra(ui) {
    const c = ui.ctx,
      m = this.metrics(),
      cx = m.cx,
      list = this.entries.slice(this.page * m.rows, this.page * m.rows + m.rows);
    // the name box
    const b = this.nameBox;
    Font.draw(c, '玩家名', b.x, b.y - 10, '#A0A0A0');
    ui.nine('text_field', b.x, b.y, b.w, b.h, 1);
    Font.draw(c, fitText(this.userName || '', b.w - 8), b.x + 4, b.y + 6, '#E0E0E0');
    // the list box
    const x0 = cx - m.boxW / 2,
      y0 = m.listTop,
      h = m.listBottom - m.listTop;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(x0, y0, m.boxW, h);
    ui.nine('text_field', x0 - 2, y0 - 2, m.boxW + 4, h + 4, 1);
    if (!this.entries.length) {
      Font.center(c, '还没有服务器，点「添加服务器」', cx, y0 + h / 2 - 4, '#A0A0A0');
    }
    list.forEach((e, i) => {
      const idx = this.page * m.rows + i,
        y = y0 + i * m.rowH,
        sel = idx === this.selected;
      if (sel) {
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.fillRect(x0 + 1, y + 1, m.boxW - 2, m.rowH - 2);
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.lineWidth = 1;
        c.strokeRect(x0 + 1.5, y + 1.5, m.boxW - 3, m.rowH - 3);
      }
      const tx = x0 + 8,
        tw = m.boxW - 16 - 24;
      // name, then the second line: players · version · motd (vanilla's two lines)
      Font.draw(c, fitText(e.name || e.ip, tw), tx, y + 5, sel ? '#FFFFFF' : '#E0E0E0');
      const line2 = [];
      if (e.online != null) line2.push(`${e.online}/${e.max ?? '?'}`);
      if (e.version) line2.push(fitText(String(e.version).split(' ')[0], 70));
      if (e.motd) line2.push(fitText(String(e.motd).replace(/\s+/g, ' '), tw - 60));
      const txt2 = line2.join(' · ');
      Font.draw(c, fitText(txt2 || Multiplayer.addr(e), tw), tx, y + 18, e.online != null ? '#7FCF7F' : '#909090');
      // the signal bars, at the right: 0-5 lit for the ping, crossed out when unreachable
      this.drawBars(c, x0 + m.boxW - 20, y + 10, e.ping);
    });
    // the address of the selected one, under the list, in the small vanilla way
    const sel = this.entries[this.selected];
    if (sel) Font.center(c, Multiplayer.addr(sel) + (sel.proxy ? '  ·  中转 ' + sel.proxy : ''), cx, m.listBottom + 4, '#909090');
    if (this.status) Font.center(c, fitText(this.status, ui.w - 8), cx, ui.h - 62, this.statusBad ? '#FF6060' : '#7FCF7F');
    if (this.pages > 1) Font.draw(c, `${this.page + 1}/${this.pages}`, cx + m.boxW / 2 - 22, m.listTop + 2, '#A0A0A0');
  }
  // vanilla's five-bar signal icon. null ping: grey bars with a cross; 0: red
  drawBars(c, x, y, ping) {
    const bw = 2,
      gap = 1,
      H = 8;
    let lit = 0,
      col = '#FFFFFF';
    if (ping === false) lit = 0;else if (ping === true || ping === undefined) lit = 0;else if (typeof ping === 'number') {
      lit = ping < 60 ? 5 : ping < 120 ? 4 : ping < 250 ? 3 : ping < 500 ? 2 : 1;
      col = ping < 120 ? '#55FF55' : ping < 300 ? '#FFFF55' : '#FF5555';
    }
    for (let i = 0; i < 5; i++) {
      const h = Math.round(H * (i + 1) / 5);
      c.fillStyle = i < lit ? col : 'rgba(160,160,160,0.45)';
      c.fillRect(x + i * (bw + gap), y + H - h, bw, h);
    }
    if (ping === false || ping === null || ping === undefined) {
      c.strokeStyle = '#FF5555';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x - 1, y + H + 1);
      c.lineTo(x + 13, y - 2);
      c.stroke();
    }
  }
}

// ---- add / edit one server -----------------------------------------------------------------

class EditServerScreen extends MenuScreen {
  constructor(game, parent, entry) {
    super(game, entry ? '编辑服务器' : '添加服务器');
    this.parent = parent;
    this.entry = entry;
    this.titleY = 20;
    this.name = entry ? entry.name || '' : '';
    this.ip = entry ? entry.ip || '' : '';
    this.port = entry ? String(entry.port || 25565) : '25565';
    this.proxyAddr = entry ? entry.proxy || '' : '';
    this.userName = (typeof Account !== 'undefined' && Account.loggedIn && Account.name) || game.settings.netName || 'Steve';
    this.field = 'ip';
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      w = Math.min(300, u.w - 24);
    this.boxes = {
      name: {
        x: cx - w / 2,
        y: 52,
        w,
        h: 20
      },
      ip: {
        x: cx - w / 2,
        y: 88,
        w,
        h: 20
      },
      port: {
        x: cx - w / 2,
        y: 124,
        w: 100,
        h: 20
      },
      proxy: {
        x: cx - w / 2,
        y: 160,
        w,
        h: 20
      }
    };
    this.widgets = [{
      x: cx - w / 2,
      y: u.h - 56,
      w: this.entry ? (w - 8) / 2 : w,
      h: 20,
      label: '完成',
      onClick: () => this.done()
    }, {
      x: cx + 4,
      y: u.h - 56,
      w: (w - 8) / 2,
      h: 20,
      label: '取消',
      onClick: () => this.onEsc()
    }];
    if (this.entry) this.widgets.push({
      x: cx - w / 2,
      y: u.h - 32,
      w: w,
      h: 20,
      label: '删除',
      onClick: () => this.remove()
    });
    this.focus(this.field);
  }
  focus(k) {
    const u = this.game.ui,
      b = this.boxes[k];
    if (!b) return;
    this.field = k;
    u.showInput(b.x + 4, b.y + 6, b.w - 8, 10, this[k], () => this.done(), {
      onInput: v => {
        this[k] = v;
      },
      onEsc: () => this.onEsc(),
      max: k === 'name' ? 32 : k === 'port' ? 5 : k === 'proxy' ? 200 : 128
    });
  }
  mouseDown(ui, mx, my, b) {
    for (const k in this.boxes) {
      const r = this.boxes[k];
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) {
        this.focus(k);
        return;
      }
    }
    super.mouseDown(ui, mx, my, b);
  }
  // "host:port" typed into the address box fills in the port too, as vanilla's does
  done() {
    const ipRaw = String(this.ip || '').trim();
    if (!ipRaw) {
      this.focus('ip');
      return;
    }
    let ip = ipRaw,
      port = String(this.port || '').trim();
    const mm = /^([^:/\s]+)(?::(\d{1,5}))?$/.exec(ipRaw);
    if (mm) {
      ip = mm[1];
      if (mm[2]) port = mm[2];
    }
    const pnum = Math.max(1, Math.min(65535, Number(port) || 25565));
    const list = Multiplayer.list();
    const rec = {
      name: String(this.name || '').trim() || ip,
      ip,
      port: pnum
    };
    const px = String(this.proxyAddr || '').trim();
    if (px) rec.proxy = px;
    if (this.entry) {
      const i = list.indexOf(list.find(x => x.ip === this.entry.ip && (x.port || 25565) === (this.entry.port || 25565)));
      if (i >= 0) list[i] = {
        ...list[i],
        ...rec
      };else list.push(rec);
    } else list.push(rec);
    Multiplayer.save(list);
    const n = String(this.userName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    if (n) {
      this.game.settings.netName = n;
      this.game.saveSettings();
    }
    this.back();
  }
  // vanilla asks twice ("are you sure you want to remove this server?"), the second one red
  remove() {
    const g = this.game,
      ip = this.entry.ip,
      port = this.entry.port || 25565;
    const strip = () => {
      const list = Multiplayer.list().filter(x => !(x.ip === ip && (x.port || 25565) === port));
      Multiplayer.save(list);
    };
    const second = () => g.ui.open(new AskScreen(g, '真的要删除吗？', [`「${this.entry.name || ip}」会从列表里消失。`, '只有这一条记录；服务器本身不受影响。'], '删除', true, () => {
      strip();
      this.parent.selected = -1;
      this.parent.load();
      this.back();
    }, () => this.layout()));
    g.ui.open(new AskScreen(g, '删除服务器', [`你确定要把「${this.entry.name || ip}」从列表里删掉吗？`], '继续', false, second, () => this.layout()));
  }
  onEsc() {
    this.game.ui.hideInput();
    this.game.ui.open(this.parent || new TitleScreen(this.game));
  }
  drawExtra(ui) {
    const c = ui.ctx;
    const draw = (k, label) => {
      const r = this.boxes[k];
      Font.draw(c, label, r.x, r.y - 11, '#A0A0A0');
      ui.nine(this.field === k ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.field !== k) Font.draw(c, fitText(String(this[k] || ''), r.w - 8), r.x + 4, r.y + 6, '#E0E0E0');
    };
    draw('name', '服务器名称');
    draw('ip', '服务器地址（IP 或域名）');
    draw('port', '端口');
    draw('proxy', '中转地址（留空用默认：' + Multiplayer.defaultProxy() + '）');
    Font.center(c, '这是网页版：地址由中转去连（浏览器不能直接开 TCP），中转默认在本站的 8780 端口', ui.w / 2, ui.h - 76, '#808080');
  }
}

// ---- 直接连接 (vanilla's Direct Connect) ---------------------------------------------------

class DirectConnectScreen extends MenuScreen {
  constructor(game, parent, name) {
    super(game, '直接连接');
    this.parent = parent;
    this.titleY = 20;
    this.addr = game.settings.netAddr || '';
    this.userName = name || (typeof Account !== 'undefined' && Account.loggedIn && Account.name) || game.settings.netName || 'Steve';
    this.field = 'addr';
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      w = Math.min(300, u.w - 24);
    this.boxes = {
      addr: {
        x: cx - w / 2,
        y: 66,
        w,
        h: 20
      },
      name: {
        x: cx - w / 2,
        y: 110,
        w,
        h: 20
      }
    };
    this.widgets = [{
      x: cx - w / 2,
      y: 148,
      w: w,
      h: 20,
      label: '加入服务器',
      onClick: () => this.join()
    }, {
      x: cx - w / 2,
      y: u.h - 32,
      w: w,
      h: 20,
      label: '取消',
      onClick: () => this.onEsc()
    }];
    this.focus(this.field);
  }
  focus(k) {
    const u = this.game.ui,
      b = this.boxes[k];
    this.field = k;
    u.showInput(b.x + 4, b.y + 6, b.w - 8, 10, this[k], () => this.join(), {
      onInput: v => {
        this[k] = v;
      },
      onEsc: () => this.onEsc(),
      max: k === 'name' ? 16 : 200
    });
  }
  mouseDown(ui, mx, my, b) {
    for (const k in this.boxes) {
      const r = this.boxes[k];
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) {
        this.focus(k);
        return;
      }
    }
    super.mouseDown(ui, mx, my, b);
  }
  // The box takes any of: "host", "host:port", "wss://bridge/ws" (a bridge directly), or
  // "host:port@wss://bridge/ws" (a server through a named bridge).
  join() {
    const g = this.game;
    const raw = String(this.addr || '').trim();
    const n = String(this.userName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    if (!raw) {
      this.focus('addr');
      return;
    }
    if (!n) {
      this.focus('name');
      return;
    }
    g.settings.netAddr = raw;
    g.settings.netName = n;
    g.saveSettings();
    g.ui.hideInput();
    let entry = null;
    const m = /^(\S+?)(?::(\d{1,5}))?\s*@\s*(\S+)$/.exec(raw);
    if (/^wss?:\/\//.test(raw)) {
      // a bridge address as it is: the server is chosen by the bridge (a local, single-server proxy)
      g.joinServer(raw, n);
      return;
    }
    if (m) entry = {
      name: m[1],
      ip: m[1],
      port: Number(m[2]) || 25565,
      proxy: m[3]
    };else {
      const mm = /^([^:/\s]+)(?::(\d{1,5}))?$/.exec(raw);
      if (!mm) {
        this.addr = '';
        this.focus('addr');
        return;
      }
      entry = {
        name: mm[1],
        ip: mm[1],
        port: Number(mm[2]) || 25565
      };
    }
    const list = Multiplayer.list();
    if (!list.some(x => x.ip === entry.ip && (x.port || 25565) === entry.port)) {
      list.push(entry);
      Multiplayer.save(list);
    }
    this.parent && this.parent.load && this.parent.load();
    this.parent && this.parent.entries && (this.parent.selected = this.parent.entries.findIndex(x => x.ip === entry.ip && (x.port || 25565) === entry.port));
    g.joinServer(Multiplayer.ws(entry), n);
  }
  onEsc() {
    this.game.ui.hideInput();
    this.game.ui.open(this.parent || new TitleScreen(this.game));
  }
  drawExtra(ui) {
    const c = ui.ctx;
    const draw = (k, label, color) => {
      const r = this.boxes[k];
      Font.draw(c, label, r.x, r.y - 11, color || '#A0A0A0');
      ui.nine(this.field === k ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.field !== k) Font.draw(c, fitText(String(this[k] || ''), r.w - 8), r.x + 4, r.y + 6, '#E0E0E0');
    };
    draw('addr', '服务器地址（域名或 IP，可带端口）');
    draw('name', '玩家名（离线名字，服务器允许离线时直接用）');
    Font.center(c, '例：mc.hypixel.net　　或　play.example.com:25566', ui.w / 2, 140, '#808080');
    Font.center(c, '也可以填中转的 ws 地址：wss://你的中转/ws', ui.w / 2, 152, '#808080');
  }
}


// ---- shared helpers (the forms in account/checkin/companion extend FormScreen) -------------

// text cut to a width (with an ellipsis), for the lists on narrow screens
const fitText = (t, w) => {
  t = String(t);
  if (Font.width(t) <= w) return t;
  while (t.length && Font.width(t + '…') > w) t = t.slice(0, -1);
  return t + '…';
};

// a screen of labelled text fields with a keyboard overlay per field: the base of the account, admin
// and companion screens (vanilla has no equivalent; this is the modals the original build used)
class FormScreen extends MenuScreen {
  constructor(game, title, parent) {
    super(game, title);
    this.parent = parent;
    this.titleY = 20;
    this.fields = {};
    this.field = null;
    this.note = '';
    this.noteColor = '#A0A0A0';
  }
  addField(k, x, y, w, label, max, filter) {
    this.fields[k] = {
      x,
      y,
      w,
      h: 20,
      label,
      max,
      filter
    };
  }
  focus(k) {
    const u = this.game.ui,
      b = this.fields[k];
    if (!b) return;
    this.field = k;
    u.showInput(b.x + 4, b.y + 6, b.w - 8, 10, this[k], () => this.submit(), {
      onInput: v => {
        this[k] = b.filter ? b.filter(v) : v;
      },
      onEsc: () => this.onEsc(),
      max: b.max
    });
  }
  submit() {}
  mouseDown(ui, mx, my, b) {
    for (const k in this.fields) {
      const r = this.fields[k];
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) {
        this.focus(k);
        return;
      }
    }
    super.mouseDown(ui, mx, my, b);
  }
  drawFields(ui) {
    const c = ui.ctx;
    for (const k in this.fields) {
      const r = this.fields[k];
      Font.draw(c, r.label, r.x, r.y - 11, '#A0A0A0');
      ui.nine(this.field === k ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.field !== k) Font.draw(c, String(this[k] || ''), r.x + 4, r.y + 6, '#E0E0E0');
    }
    if (this.note) Font.center(c, this.note, ui.w / 2, ui.h - 52, this.noteColor);
  }
  say(text, bad) {
    this.note = text;
    this.noteColor = bad ? '#FF6060' : '#A0A0A0';
  }
  back() {
    this.game.ui.hideInput();
    this.game.ui.open(this.parent || new TitleScreen(this.game));
  }
  onEsc() {
    this.back();
  }
}

const nameOnly = v => String(v).replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
const codeOnly = v => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// ---- AskScreen: a confirmation with several lines, and optionally a red (destructive) yes ----

class AskScreen extends MenuScreen {
  constructor(game, title, lines, yesLabel, danger, onYes, onNo) {
    super(game, title);
    this.titleY = 40;
    this.lines = Array.isArray(lines) ? lines : [String(lines)];
    this.yesLabel = yesLabel || '确定';
    this.danger = !!danger;
    this.onYes = onYes;
    this.onNo = onNo;
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      y = Math.min(u.h - 40, 96 + this.lines.length * 12);
    this.widgets = [{
      x: cx - 155,
      y,
      w: 150,
      h: 20,
      label: this.yesLabel,
      tint: this.danger ? 'rgba(140,30,30,0.55)' : null,
      onClick: () => this.onYes && this.onYes()
    }, {
      x: cx + 5,
      y,
      w: 150,
      h: 20,
      label: '取消',
      onClick: () => this.onNo ? this.onNo() : this.onEsc()
    }];
  }
  drawExtra(ui) {
    const c = ui.ctx;
    this.lines.forEach((t, i) => Font.center(c, fitText(t, ui.w - 16), ui.w / 2, 62 + i * 12, i === 0 && this.danger ? '#FF8888' : '#FFFFFF'));
  }
  onEsc() {
    this.onNo ? this.onNo() : this.back();
  }
  back() {}
}
