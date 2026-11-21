
'use strict';

// ---------------------------------------------------------------------------
// The live settings (multiplayer/rooms/admin.js LIVE, changed in the admin panel - tools/admin): GET /api/live on
// the room service. Read as the page starts (the last ones kept in this browser, so they apply before the answer
// comes), every 5 minutes on the menus while the page is shown, at once when a room says so ({ t: 'live' }, net.js),
// and in single player when the announcements' answer names a newer one (social.js) - so nobody asks twice. Without a service (a test page, offline) every setting is the
// game's own, as before.
// Where each is used: title.* here and in checkin.js / shareholders.js / mods_ui.js; mods.* in mods.js / mods_ui.js;
// jing.* in companion.js; client.telemetry in telemetry.js; client.announceMin in social.js; defaults.* and the
// title's notice, splash and feedback button here.
// ---------------------------------------------------------------------------
const Live = {
  v: 0,
  values: {},
  busy: false,
  at: 0,
  get(k, d) {
    return Object.prototype.hasOwnProperty.call(this.values, k) ? this.values[k] : d;
  },
  // a switch that is on unless the panel turned it off
  on(k) {
    return this.get(k, true) !== false;
  },
  load() {
    try {
      const j = JSON.parse(localStorage.getItem('mcjs-live') || 'null');
      if (j && j.values) {
        this.v = +j.v || 0;
        this.values = j.values;
      }
    } catch (e) {}
  },
  // asked again (v: the one a room or the announcements named - nothing to do when it is this one)
  async fetch(v) {
    if (v !== undefined && +v === this.v) return;
    if (this.busy || typeof RoomService === 'undefined' || !RoomService.base()) return;
    const now = Date.now();
    if (now - this.at < 2000) return;
    this.busy = true;
    this.at = now;
    try {
      const r = await fetch(RoomService.base() + '/api/live?v=' + this.v, {
        cache: 'no-store'
      });
      const j = await r.json();
      if (r.ok && j && !j.same && j.values) {
        const old = JSON.stringify(this.values);
        this.v = +j.v || 0;
        this.values = j.values;
        try {
          localStorage.setItem('mcjs-live', JSON.stringify({
            v: this.v,
            values: this.values
          }));
        } catch (e) {}
        if (JSON.stringify(this.values) !== old) this.changed();
      }
    } catch (e) {}
    this.busy = false;
  },
  // what changes at once: the defaults of a new player, the title screen redrawn
  changed() {
    const g = typeof game !== 'undefined' && game;
    if (!g || !g.settings) return;
    this.defaults(g);
    const sc = g.ui && g.ui.screen;
    if (sc && typeof TitleScreen !== 'undefined' && sc instanceof TitleScreen) sc.layout();
  },
  // a player's settings never saved: the panel's defaults (defaults.*) for the ones the player hasn't set
  defaults(g) {
    let saved = {};
    try {
      saved = g.loadSettings() || {};
    } catch (e) {}
    const D = {
      fov: ['defaults.fov', 1],
      volume: ['defaults.volume', 100],
      sens: ['defaults.sens', 100],
      clouds: ['defaults.clouds'],
      bobbing: ['defaults.bobbing']
    };
    for (const [k, [lk, div]] of Object.entries(D)) {
      if (k in saved || !Object.prototype.hasOwnProperty.call(this.values, lk)) continue;
      const v = this.values[lk];
      if (div) {
        const n = Number(v);
        if (Number.isFinite(n)) g.settings[k] = n / div;
      } else if (typeof v === 'boolean') g.settings[k] = v;
    }
  }
};
Live.load();

// ---- the title screen: the panel's notice over the buttons, its splash, the feedback button hidden ----
(() => {
  if (typeof TitleScreen !== 'function') return;
  const COLORS = {
    gold: '#FFAA00',
    red: '#FF5555',
    green: '#55FF55',
    aqua: '#55FFFF',
    white: '#FFFFFF'
  };
  let first = true;
  const lay = TitleScreen.prototype.layout,
    dx = TitleScreen.prototype.drawExtra;
  TitleScreen.prototype.layout = function (...a) {
    if (first && this.game) {
      first = false;
      Live.defaults(this.game);
    }
    lay.apply(this, a);
    const sp = String(Live.get('title.splash', '') || '').trim();
    if (sp) this.splash = sp;else if (this.liveSplash) this.splash = SPLASHES[Math.random() * SPLASHES.length | 0];
    this.liveSplash = !!sp;
    if (!Live.on('client.feedback')) {
      const fb = this.widgets.find(w => w.label === '反馈问题'),
        sk = this.widgets.find(w => w.label === '皮肤和装饰');
      if (fb) {
        this.widgets.splice(this.widgets.indexOf(fb), 1);
        if (sk && sk.y === fb.y) sk.w = fb.x + fb.w - sk.x;
      }
    }
  };
  TitleScreen.prototype.drawExtra = function (ui) {
    dx.call(this, ui);
    const t = String(Live.get('notice.text', '') || '').trim();
    if (!t) return;
    const c = ui.ctx,
      l = Math.floor(ui.h / 4 + 48),
      y = l - 14,
      tw = Math.min(ui.w - 8, Font.width(t) + 12);
    const blink = Live.get('notice.blink', false) === true ? 0.65 + 0.35 * Math.sin(performance.now() / 260) : 1;
    c.globalAlpha = 0.55;
    c.fillStyle = '#000';
    c.fillRect(Math.floor(ui.w / 2 - tw / 2), y - 2, tw, 12);
    c.globalAlpha = blink;
    Font.center(c, fitText(t, ui.w - 16), ui.w / 2, y, COLORS[Live.get('notice.color', 'gold')] || COLORS.gold);
    c.globalAlpha = 1;
  };
})();

// ---- asked: as the page starts, then every 5 minutes on the menus while it is shown (playing: the room or the
// announcements' answer says when) ----
(() => {
  const menus = () => {
    const g = typeof game !== 'undefined' && game;
    return !g || g.state !== 'play';
  };
  setTimeout(() => Live.fetch(), 1500);
  setInterval(() => {
    if (!document.hidden && menus()) Live.fetch();
  }, 5 * 60e3);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && menus() && Date.now() - Live.at > 5 * 60e3) Live.fetch();
  });
})();
