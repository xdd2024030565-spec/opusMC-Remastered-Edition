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
  // a server record's WebSocket address: the entry's own proxy, else the default.
  // The MC host/port ride in the query string: the bridge needs them to know which
  // real server to connect to (the game client's hello only carries name/rd).
  ws(entry) {
    let base = (entry.proxy || this.defaultProxy()).replace(/\/+$/, '');
    if (!/\/ws$/.test(base)) base += '/ws';
    const sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + 'host=' + encodeURIComponent(entry.ip) +
      '&port=' + (Number(entry.port) || 25565);
  },
  // the address the entry is for, written the way people write it: host[:port]
  addr(entry) {
    return entry.port && Number(entry.port) !== 25565 ? entry.ip + ':' + entry.port : entry.ip;
  },
  // the servers list: kept in the cloud (saves/servers.json) with localStorage as a
  // fast cache so the screen paints instantly before the pull lands.
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
  // a fresh install starts with no servers at all: the user adds the ones they want.
  // (the well-known public servers were removed at the user's request: they don't work
  //  through this build's offline bridge and only clutter the list.)
  seedList() {
    return [];
  },
  // pull the server list from the cloud (saves/servers.json). Returns the list, or the
  // cached/seed list on any failure so the screen never blanks.
  async cloudList() {
    try {
      if (window.CloudGitHub && window.CloudGitHub.kvLoad) {
        const v = await window.CloudGitHub.kvLoad('servers');
        if (v && Array.isArray(v.list)) {
          const a = v.list.filter(s => s && typeof s.ip === 'string' && s.ip);
          this.save(a);            // refresh the local cache
          return a;
        }
      }
    } catch (e) {}
    return this.list();
  },
  // push the list to the cloud (saves/servers.json). Falls back to local-only on failure.
  async cloudSave(list) {
    this.save(list);               // always refresh the local cache first
    try {
      if (window.CloudGitHub && window.CloudGitHub.kvSave) {
        await window.CloudGitHub.kvSave('servers', { list }, 'update server list');
      }
    } catch (e) {}
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
    this.status = '';
    // the chosen offline account is loaded from the cloud; it is not kept in
    // game.settings any more (the user wanted a dedicated cloud file).
    this.accounts = null;      // { list:[{name}], current: <name> } once loaded
    this.accountName = null;   // the current name, cached for drawExtra
    this.load();
    this.loadAccounts();
  }
  load() {
    this.entries = Multiplayer.list().map(e => ({
      ...e
    }));
    if (this.selected >= this.entries.length) this.selected = this.entries.length - 1;
    if (this.selected < 0 && this.entries.length) this.selected = 0;
    // refresh from the cloud in the background; re-layout when it lands so the
    // list updates without the user doing anything.
    Multiplayer.cloudList().then(a => {
      this.entries = a.map(e => ({ ...e }));
      if (this.selected >= this.entries.length) this.selected = this.entries.length - 1;
      if (this.selected < 0 && this.entries.length) this.selected = 0;
      if (this.game.ui.screen === this) this.layout();
    });
  }
  // pull the offline accounts file from the cloud (saves/accounts.json via the Worker).
  // failures fall back to a single ephemeral name so the screen still works.
  async loadAccounts() {
    let acc = null;
    try {
      if (window.CloudGitHub && window.CloudGitHub.kvLoad) {
        acc = await window.CloudGitHub.kvLoad('accounts');
      }
    } catch (e) { /* password wrong etc: treated as no cloud accounts */ }
    if (acc && Array.isArray(acc.list) && acc.list.length) {
      this.accounts = acc;
      const cur = acc.list.find(a => a.name === acc.current);
      this.accountName = cur ? cur.name : acc.list[0].name;
    } else {
      this.accounts = { list: [], current: null };
      this.accountName = null;
    }
    if (this.game.ui.screen === this) this.layout();
  }
  // the name used when joining a server: the current account, or a fallback
  currentName() {
    if (this.accountName) return this.accountName;
    if (this.accounts && this.accounts.list && this.accounts.list.length)
      return this.accounts.list[0].name;
    return 'Player' + Math.floor(Math.random() * 9000 + 1000);
  }
  // a compact, vanilla-style centered panel (not edge to edge): the list is narrower
  // and vertically centered, with room for the account line at the top.
  metrics() {
    const u = this.game.ui;
    const rowH = 30;                       // vanilla's rows are a bit shorter than this build's
    const maxRows = 8;                     // keep the panel small: scroll when more
    const top = 54;                        // below the account line (drawn at y~30)
    const bottomPad = 96;                  // three button rows + status at the bottom
    const avail = u.h - top - bottomPad;
    const rows = Math.max(1, Math.min(maxRows, Math.floor(avail / rowH)));
    const listH = rows * rowH;
    const listBottom = top + listH;
    return {
      listTop: top,
      listBottom,
      rowH,
      rows,
      cx: u.w / 2,
      boxW: Math.min(360, u.w - 24)        // narrower than before; centered
    };
  }
  layout() {
    const u = this.game.ui,
      m = this.metrics(),
      cx = m.cx,
      n = m.rows;
    const pages = Math.max(1, Math.ceil(this.entries.length / n));
    this.page = clamp(this.page, 0, pages - 1);
    this.pages = pages;
    const bw = (m.boxW - 8) / 2,
      by = m.listBottom + 8;
    this.widgets = [{
      x: cx - m.boxW / 2,
      y: by,
      w: bw,
      h: 18,
      label: '加入服务器',
      enabled: this.selected >= 0 && this.selected < this.entries.length,
      onClick: () => this.joinSelected()
    }, {
      x: cx - m.boxW / 2 + bw + 8,
      y: by,
      w: bw,
      h: 18,
      label: '直接连接',
      onClick: () => {
        this.game.ui.hideInput();
        this.game.ui.open(new DirectConnectScreen(this.game, this));
      }
    }, {
      x: cx - m.boxW / 2,
      y: by + 22,
      w: bw,
      h: 18,
      label: '添加服务器',
      onClick: () => {
        this.game.ui.hideInput();
        this.game.ui.open(new EditServerScreen(this.game, this, null));
      }
    }, {
      x: cx - m.boxW / 2 + bw + 8,
      y: by + 22,
      w: bw,
      h: 18,
      label: '编辑',
      enabled: this.selected >= 0 && this.selected < this.entries.length,
      onClick: () => {
        this.game.ui.hideInput();
        this.game.ui.open(new EditServerScreen(this.game, this, this.entries[this.selected]));
      }
    }, {
      x: cx - m.boxW / 2,
      y: by + 44,
      w: bw,
      h: 18,
      label: this.pinging ? '正在刷新…' : '刷新',
      enabled: !this.pinging,
      onClick: () => this.refresh()
    }, {
      x: cx - m.boxW / 2 + bw + 8,
      y: by + 44,
      w: bw,
      h: 18,
      label: '返回',
      onClick: () => this.back()
    }];
    // the account button at the top-right, and the current-account label at top-left,
    // drawn (not widgets) so they sit above the title cleanly.
    this.acctBtn = {
      x: cx + m.boxW / 2 - 96,
      y: 28,
      w: 96,
      h: 18
    };
    this.acctLabel = {
      x: cx - m.boxW / 2,
      y: 28,
      w: m.boxW - 104,
      h: 18
    };
    // paging arrows on the right edge of the list when there is more than one page
    if (pages > 1) {
      this.widgets.push({
        x: cx + m.boxW / 2 - 22,
        y: m.listTop - 1,
        w: 20,
        h: 11,
        label: '▲',
        enabled: this.page > 0,
        onClick: () => { this.page--; this.layout(); }
      }, {
        x: cx + m.boxW / 2 - 22,
        y: m.listBottom - 12,
        w: 20,
        h: 11,
        label: '▼',
        enabled: this.page < pages - 1,
        onClick: () => { this.page++; this.layout(); }
      });
    }
  }
  // a click on the list picks a row (and a double click joins, like vanilla)
  mouseDown(ui, mx, my, b) {
    if (b === 0) {
      // the account button opens the offline-accounts screen
      if (this.acctBtn && mx >= this.acctBtn.x && mx < this.acctBtn.x + this.acctBtn.w && my >= this.acctBtn.y && my < this.acctBtn.y + this.acctBtn.h) {
        this.game.ui.hideInput();
        this.game.ui.open(new OfflineAccountsScreen(this.game, this));
        return;
      }
      const m = this.metrics();
      if (mx >= m.cx - m.boxW / 2 && mx <= m.cx + m.boxW / 2 && my >= m.listTop && my < m.listBottom) {
        const i = this.page * m.rows + Math.floor((my - m.listTop) / m.rowH);
        if (i >= 0 && i < this.entries.length) {
          const was = this.selected;
          this.selected = i;
          this.layout();
          if (was === i) { this.joinSelected(); return; }
          Sound.click();
          return;
        }
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
  async refresh() {
    if (this.pinging || !this.entries.length) return;
    this.pinging = true;
    this.status = '';
    this.layout();
    const proxy = Multiplayer.defaultProxy();
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
    await Promise.all(Array.from({ length: Math.min(CONC, this.entries.length) }, run));
    this.pinging = false;
    const ok = this.entries.filter(e => e.ping).length;
    const defaultBridge = !new URLSearchParams(location.search).get('proxy') && !window.MP_PROXY &&
      /:8780$/.test(proxy);
    this.status = ok ? `在线 ${ok} / ${this.entries.length}` :
      (defaultBridge ? '全部无法连接：联机需要运行 bridge 中转（见 README）' : '全部无法连接（检查中转地址：' + proxy + '）');
    this.statusBad = !ok;
    this.savePings();
    if (this.game.ui.screen === this) this.layout();
  }
  savePings() {
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
    Multiplayer.cloudSave(cur);
  }
  joinSelected() {
    const e = this.entries[this.selected];
    if (!e) return;
    const n = this.currentName();
    const g = this.game;
    g.ui.hideInput();
    e.lastPlayed = Date.now();
    Multiplayer.cloudSave(this.entries);
    g.ui.open(new LoadingScreen(g, '正在连接 ' + Multiplayer.addr(e) + '…'));
    g.joinServer(Multiplayer.ws(e), n);
  }
  drawExtra(ui) {
    const c = ui.ctx,
      m = this.metrics(),
      cx = m.cx,
      list = this.entries.slice(this.page * m.rows, this.page * m.rows + m.rows);
    // the current-account line at the top-left, and the button at the top-right
    const an = this.accountName || '（未选择）';
    Font.draw(c, '当前账号', this.acctLabel.x, this.acctLabel.y - 9, '#808080');
    ui.nine('text_field', this.acctLabel.x, this.acctLabel.y, this.acctLabel.w, this.acctLabel.h, 1);
    Font.draw(c, fitText(an + ' ▼', this.acctLabel.w - 8), this.acctLabel.x + 4, this.acctLabel.y + 5, '#E0E0E0');
    // the "离线账号" button at the top-right (drawn as a real button so it is visible & clickable)
    const b = this.acctBtn;
    ui.button({ x: b.x, y: b.y, w: b.w, h: b.h, label: '离线账号', gold: true });
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
      Font.draw(c, fitText(e.name || e.ip, tw), tx, y + 4, sel ? '#FFFFFF' : '#E0E0E0');
      const line2 = [];
      if (e.online != null) line2.push(`${e.online}/${e.max ?? '?'}`);
      if (e.version) line2.push(fitText(String(e.version).split(' ')[0], 70));
      if (e.motd) line2.push(fitText(String(e.motd).replace(/\s+/g, ' '), tw - 60));
      const txt2 = line2.join(' · ');
      Font.draw(c, fitText(txt2 || Multiplayer.addr(e), tw), tx, y + 16, e.online != null ? '#7FCF7F' : '#909090');
      this.drawBars(c, x0 + m.boxW - 20, y + 9, e.ping);
    });
    // the address of the selected one, under the list
    const sel = this.entries[this.selected];
    if (sel) Font.center(c, Multiplayer.addr(sel) + (sel.proxy ? '  ·  中转 ' + sel.proxy : ''), cx, m.listBottom + 4, '#909090');
    if (this.status) Font.center(c, fitText(this.status, ui.w - 8), cx, ui.h - 58, this.statusBad ? '#FF6060' : '#7FCF7F');
    if (this.pages > 1) Font.draw(c, `${this.page + 1}/${this.pages}`, cx + m.boxW / 2 - 20, m.listTop + 2, '#A0A0A0');
  }
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

// ---- offline accounts (a dedicated cloud file saves/accounts.json) ------------------------
//
// The list and the currently-selected one live in one cloud file:
//   { list:[{name:"Steve"},...], current:"Steve" }
// No localStorage; no per-account files. The user picks one before joining.

class OfflineAccountsScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '离线账号');
    this.parent = parent;                 // the ServerListScreen (so we can push the choice back)
    this.titleY = 20;
    this.list = (parent && parent.accounts && parent.accounts.list) ? parent.accounts.list.slice() : [];
    this.current = (parent && parent.accounts) ? parent.accounts.current : null;
    this.editing = -1;                     // index being added/edited, -1 = none
    this.editName = '';
    this.editField = null;
    this.busy = false;                     // saving to the cloud
    this.note = '';
    this.noteBad = false;
    this.mode = 'list';                    // 'list' | 'edit'
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      w = Math.min(280, u.w - 24);
    if (this.mode === 'edit') {
      this.boxes = { name: { x: cx - w / 2, y: 70, w, h: 20 } };
      this.widgets = [{
        x: cx - w / 2, y: 110, w: (w - 8) / 2, h: 20, label: '保存', onClick: () => this.saveEdit()
      }, {
        x: cx + 4, y: 110, w: (w - 8) / 2, h: 20, label: '取消', onClick: () => this.cancelEdit()
      }];
      if (this.editing >= 0 && this.editing < this.list.length) {
        this.widgets.push({
          x: cx - w / 2, y: 136, w, h: 20, label: '删除', tint: 'rgba(140,30,30,0.55)',
          onClick: () => this.removeEdit()
        });
      }
      this.focusEdit();
      return;
    }
    // list mode: each account is a row; a row shows ● current / name / [编辑]
    const rowH = 24,
      top = 48,
      maxRows = 7,
      rows = Math.max(1, Math.min(maxRows, this.list.length));
    this.widgets = [];
    this.list.forEach((a, i) => {
      const y = top + i * rowH;
      this.widgets.push({
        x: cx - w / 2, y, w: w - 70, h: 20,
        label: () => (a.name === this.current ? '● ' : '  ') + fitText(a.name, w - 90),
        gold: a.name === this.current,
        onClick: () => this.select(i)
      }, {
        x: cx + w / 2 - 62, y, w: 62, h: 20,
        label: '编辑', onClick: () => this.beginEdit(i)
      });
    });
    const by = top + rows * rowH + 8;
    this.widgets.push({
      x: cx - w / 2, y: by, w: (w - 8) / 2, h: 20,
      label: this.busy ? '正在同步…' : '添加离线账号',
      enabled: !this.busy,
      onClick: () => this.beginEdit(-1)
    }, {
      x: cx + 4, y: by, w: (w - 8) / 2, h: 20,
      label: '关闭', onClick: () => this.onEsc()
    });
  }
  focusEdit() {
    const u = this.game.ui, b = this.boxes.name;
    this.editField = 'name';
    u.showInput(b.x + 4, b.y + 6, b.w - 8, 10, this.editName, () => this.saveEdit(), {
      onInput: v => { this.editName = String(v || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16); },
      onEsc: () => this.cancelEdit(),
      max: 16
    });
  }
  beginEdit(i) {
    this.editing = i;
    this.editName = i >= 0 ? this.list[i].name : '';
    this.mode = 'edit';
    this.note = '';
    this.game.ui.hideInput();
    this.layout();
  }
  cancelEdit() {
    this.mode = 'list';
    this.editing = -1;
    this.game.ui.hideInput();
    this.layout();
  }
  mouseDown(ui, mx, my, b) {
    if (this.mode === 'edit') {
      const r = this.boxes.name;
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) { this.focusEdit(); return; }
    }
    super.mouseDown(ui, mx, my, b);
  }
  // commit an add/edit; saves the whole file to the cloud
  async saveEdit() {
    const n = String(this.editName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    if (!n) { this.note = '名字不能为空（字母、数字、下划线，≤16）'; this.noteBad = true; this.layout(); return; }
    if (this.editing >= 0) {
      this.list[this.editing] = { name: n };
      if (this.current === this.list[this.editing] && this.list[this.editing]) this.current = n;
    } else {
      this.list.push({ name: n });
    }
    // selecting the one just added/edited, like vanilla
    this.current = n;
    this.mode = 'list';
    this.game.ui.hideInput();
    await this.sync();
  }
  removeEdit() {
    const i = this.editing;
    if (i < 0 || i >= this.list.length) return;
    const name = this.list[i].name;
    const g = this.game;
    g.ui.open(new AskScreen(g, '删除离线账号', [`「${name}」会从云端账号列表删除。`], '删除', true, async () => {
      this.list.splice(i, 1);
      if (this.current === name) this.current = this.list.length ? this.list[0].name : null;
      this.mode = 'list';
      this.editing = -1;
      g.ui.hideInput();
      await this.sync();
    }, () => g.ui.open(this), this));
  }
  select(i) {
    if (i < 0 || i >= this.list.length) return;
    this.current = this.list[i].name;
    this.sync();
  }
  // write { list, current } to the cloud and push back to the parent
  async sync() {
    this.busy = true;
    this.note = '正在同步到云端…';
    this.noteBad = false;
    this.layout();
    try {
      if (window.CloudGitHub && window.CloudGitHub.kvSave) {
        await window.CloudGitHub.kvSave('accounts', { list: this.list, current: this.current }, 'update offline accounts');
      }
      this.note = '已保存';
      this.noteBad = false;
    } catch (e) {
      this.note = '云端保存失败：' + (e && e.message || e);
      this.noteBad = true;
    }
    this.busy = false;
    // push back so the parent's top-left label updates immediately
    if (this.parent) {
      this.parent.accounts = { list: this.list.slice(), current: this.current };
      this.parent.accountName = this.current;
    }
    this.layout();
  }
  onEsc() {
    this.game.ui.hideInput();
    this.game.ui.open(this.parent || new TitleScreen(this.game));
  }
  drawExtra(ui) {
    const c = ui.ctx;
    if (this.mode === 'edit') {
      const r = this.boxes.name;
      Font.draw(c, '离线账号名字', r.x, r.y - 11, '#A0A0A0');
      ui.nine(this.editField === 'name' ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.editField !== 'name') Font.draw(c, fitText(this.editName, r.w - 8), r.x + 4, r.y + 6, '#E0E0E0');
      Font.center(c, '只允许英文字母、数字、下划线，最多 16 个', ui.w / 2, 94, '#808080');
    } else {
      if (!this.list.length) Font.center(c, '还没有离线账号，点「添加离线账号」', ui.w / 2, 36, '#A0A0A0');
    }
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), ui.w / 2, ui.h - 52, this.noteBad ? '#FF6060' : '#7FCF7F');
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
      y: 196,
      w: this.entry ? (w - 8) / 2 : w,
      h: 20,
      label: '完成',
      onClick: () => this.done()
    }, {
      x: cx + 4,
      y: 196,
      w: (w - 8) / 2,
      h: 20,
      label: '取消',
      onClick: () => this.onEsc()
    }];
    if (this.entry) this.widgets.push({
      x: cx - w / 2,
      y: 222,
      w: w,
      h: 20,
      label: '删除',
      tint: 'rgba(140,30,30,0.55)',
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
    Multiplayer.cloudSave(list);
    // the offline account name comes from the parent now, not from this screen
    this.back();
  }
  // vanilla asks twice ("are you sure you want to remove this server?"), the second one red
  remove() {
    const g = this.game,
      ip = this.entry.ip,
      port = this.entry.port || 25565;
    const strip = () => {
      const list = Multiplayer.list().filter(x => !(x.ip === ip && (x.port || 25565) === port));
      Multiplayer.cloudSave(list);
    };
    const second = () => g.ui.open(new AskScreen(g, '真的要删除吗？', [`「${this.entry.name || ip}」会从列表里消失。`, '只有这一条记录；服务器本身不受影响。'], '删除', true, () => {
      strip();
      this.parent.selected = -1;
      this.parent.load();
      this.back();
    }, () => g.ui.open(this), this.parent));
    g.ui.open(new AskScreen(g, '删除服务器', [`你确定要把「${this.entry.name || ip}」从列表里删掉吗？`], '继续', false, second, () => g.ui.open(this), this.parent));
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
    Font.center(c, '网页版由中转连服务器（浏览器不能直接开 TCP）', ui.w / 2, 250, '#808080');
  }
}

// ---- 直接连接 (vanilla's Direct Connect) ---------------------------------------------------

class DirectConnectScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '直接连接');
    this.parent = parent;
    this.titleY = 20;
    this.addr = game.settings.netAddr || '';
    this.field = 'addr';
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      w = Math.min(300, u.w - 24);
    this.boxes = {
      addr: {
        x: cx - w / 2,
        y: 70,
        w,
        h: 20
      }
    };
    this.widgets = [{
      x: cx - w / 2,
      y: 100,
      w: w,
      h: 20,
      label: '加入服务器',
      onClick: () => this.join()
    }, {
      x: cx - w / 2,
      y: 128,
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
      max: 200
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
  // The offline account name is the current one on the parent ServerListScreen.
  join() {
    const g = this.game;
    const raw = String(this.addr || '').trim();
    if (!raw) {
      this.focus('addr');
      return;
    }
    const n = (this.parent && this.parent.currentName) ? this.parent.currentName() :
      ('Player' + Math.floor(Math.random() * 9000 + 1000));
    g.settings.netAddr = raw;
    g.saveSettings();
    g.ui.hideInput();
    let entry = null;
    const m = /^(\S+?)(?::(\d{1,5}))?\s*@\s*(\S+)$/.exec(raw);
    if (/^wss?:\/\//.test(raw)) {
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
      Multiplayer.cloudSave(list);
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
    Font.center(c, '例：mc.hypixel.net　　或　play.example.com:25566', ui.w / 2, 94, '#808080');
    Font.center(c, '也可以填中转的 ws 地址：wss://你的中转/ws', ui.w / 2, 106, '#808080');
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
  constructor(game, title, lines, yesLabel, danger, onYes, onNo, parent) {
    super(game, title);
    this.titleY = 40;
    this.lines = Array.isArray(lines) ? lines : [String(lines)];
    this.yesLabel = yesLabel || '确定';
    this.danger = !!danger;
    this.onYes = onYes;
    this.onNo = onNo;
    this.parent = parent || null;
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
      onClick: () => this.onNo ? this.onNo() : this.back()
    }];
  }
  drawExtra(ui) {
    const c = ui.ctx;
    this.lines.forEach((t, i) => Font.center(c, fitText(t, ui.w - 16), ui.w / 2, 62 + i * 12, i === 0 && this.danger ? '#FF8888' : '#FFFFFF'));
  }
  onEsc() {
    this.onNo ? this.onNo() : this.back();
  }
  back() {
    // return to where the ask came from (parent screen), never a dead end
    this.game.ui.hideInput();
    this.game.ui.open(this.parent || new TitleScreen(this.game));
  }
}
