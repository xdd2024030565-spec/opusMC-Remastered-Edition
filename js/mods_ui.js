
'use strict';

// ---------------------------------------------------------------------------
// The mods' screen (title: the 模组 button: download / delete), the mods each world has (ticked in 创建新的世界,
// 编辑世界 and the world list's 模组管理; the page loads the world's own - mods.js), the mods' credits.
// (the user 11-12: the lists scroll up and down - smoothly, no pages; each mod a card: an item it is known for
// (index.json "icon"), its Chinese and English names, a line of what it is; a world's mods ticked in a list)
// ---------------------------------------------------------------------------
const MOD_BLUE = 'rgba(120,200,255,0.55)';

// ---- smooth scrolling: the list follows a finger / the mouse dragging it and flies on when let go, slowing down;
// past either end it gives like rubber and springs back; the wheel glides to where it points ----
class SmoothScroll {
  constructor() {
    this.y = 0;
    this.goal = 0;
    this.v = 0;
    this.max = 0;
    this.held = false;
    this.t = 0;
    this.trail = [];
  }
  setMax(m) {
    this.max = Math.max(0, m);
    if (!this.held && !this.v) this.goal = clamp(this.goal, 0, this.max);
  }
  // the finger moved by d (GUI px, down +): the list goes with it - less and less the further past an end
  drag(d) {
    const out = this.y < 0 ? -this.y : this.y > this.max ? this.y - this.max : 0;
    this.y -= d * (out > 0 ? Math.max(0.12, 0.5 - out / 100) : 1);
    this.goal = this.y;
    this.held = true;
    this.v = 0;
    const now = performance.now();
    this.trail.push([now, this.y]);
    while (this.trail.length > 2 && now - this.trail[0][0] > 90) this.trail.shift();
  }
  // let go: on at the speed it was moving the last moment (none if the finger had stopped)
  release() {
    const tr = this.trail,
      now = performance.now();
    this.held = false;
    this.trail = [];
    this.goal = clamp(this.y, 0, this.max);
    if (tr.length < 2 || now - tr[tr.length - 1][0] > 70) return;
    const dt = (tr[tr.length - 1][0] - tr[0][0]) / 1000;
    if (dt > 0.005) this.v = clamp((tr[tr.length - 1][1] - tr[0][1]) / dt, -3000, 3000);
  }
  wheel(d) {
    this.v = 0;
    this.goal = clamp(this.goal + d, 0, this.max);
  }
  // each frame: flying on (slowing down; hard past the ends), else gliding to the goal (a wheel's, or back in)
  step() {
    const now = performance.now(),
      dt = this.t ? Math.min(0.05, (now - this.t) / 1000) : 0;
    this.t = now;
    if (this.held || !dt) return;
    const out = () => this.y < 0 || this.y > this.max;
    if (this.v) {
      this.y += this.v * dt;
      this.v *= Math.exp(-(out() ? 30 : 3) * dt);
      if (Math.abs(this.v) < 8) this.v = 0;
      this.goal = clamp(this.y, 0, this.max);
      if (!out()) return;
    }
    const goal = clamp(this.goal, 0, this.max),
      d = goal - this.y;
    this.y = Math.abs(d) < 0.05 ? goal : this.y + d * (1 - Math.exp(-15 * dt));
  }
  moving() {
    return this.held || !!this.v || Math.abs(clamp(this.goal, 0, this.max) - this.y) > 0.05;
  }
}

// ---- a screen with a list of rows that scrolls that way: rows [{ h }] top to bottom, drawRow(ui, row, y) and
// clickRow(row, mx, y in the row) of its own; the list in this.area ----
class ModListScreen extends MenuScreen {
  constructor(game, title) {
    super(game, title);
    this.titleY = 10;
    this.pauses = false;
    this.sc = new SmoothScroll();
    this.rows = [];
    this.contentH = 0;
    this.area = {
      x: 0,
      y: 34,
      w: 0,
      h: 0
    };
    this.t0 = performance.now();
  }
  // the rows' places in the list (y from its top) and how far it scrolls
  place() {
    let y = 4;
    for (const r of this.rows) {
      r.y = y;
      y += r.h + 4;
    }
    this.contentH = y;
    this.sc.setMax(y - this.area.h);
  }
  // (the scroll on whole device pixels: smooth, and the pixel font stays sharp)
  offset(ui) {
    return Math.round(this.sc.y * ui.scale) / ui.scale;
  }
  // (a mouse notch is ~100 CSS px; a touchpad sends small steps as it goes)
  wheel(ui, dy) {
    this.sc.wheel(Math.abs(dy) < 4 ? Math.sign(dy) * 30 : clamp(dy * ui.dpr / ui.scale, -90, 90));
  }
  // touch (touch.js): a finger down stops the list flying (and that tap isn't a click), its move, letting go
  touchHold() {
    this.halted = Math.abs(this.sc.v) > 60;
    this.sc.v = 0;
  }
  scrollPx(d) {
    this.sc.drag(d);
  }
  scrollRelease() {
    this.sc.release();
  }
  inArea(mx, my) {
    const a = this.area;
    return mx >= a.x - 4 && mx < a.x + a.w + 8 && my >= a.y && my < a.y + a.h;
  }
  // the mouse: pressed in the list, it drags it once moved; let go without moving, a click on the row there
  mouseDown(ui, mx, my, b) {
    if (b === 0 && this.inArea(mx, my)) {
      this.press = {
        y: my,
        ly: my,
        moved: false,
        stop: this.halted || Math.abs(this.sc.v) > 60
      };
      this.halted = false;
      this.sc.v = 0;
      return;
    }
    super.mouseDown(ui, mx, my, b);
  }
  mouseMove(ui, mx, my) {
    const p = this.press;
    if (p && ui.mouse.down) {
      if (!p.moved && Math.abs(my - p.y) > 3) {
        p.moved = true;
        p.ly = p.y;
      }
      if (p.moved) {
        this.sc.drag(my - p.ly);
        p.ly = my;
      }
      return;
    }
    super.mouseMove(ui, mx, my);
  }
  mouseUp(ui, mx, my) {
    const p = this.press;
    this.press = null;
    if (p && p.moved) this.sc.release();else if (p && !p.stop && this.inArea(mx, my)) {
      const ly = my - this.area.y + this.offset(ui),
        r = this.rows.find(r => ly >= r.y && ly < r.y + r.h);
      if (r) this.clickRow(r, mx, ly - r.y);
    }
    super.mouseUp(ui, mx, my);
  }
  // the row under the mouse (not while the list is dragged; a finger leaves the mouse off the screen)
  hover(ui, r, y) {
    const a = this.area,
      mx = ui.mouse.x,
      my = ui.mouse.y;
    return !(this.press && this.press.moved) && !this.sc.held && mx >= a.x && mx < a.x + a.w && my >= Math.max(a.y, y) && my < Math.min(a.y + a.h, y + r.h);
  }
  // the list: its background, the rows in view (each fading in a little after the one above when the list comes),
  // shadows where it goes on under the edges, the bar on the right
  drawList(ui) {
    this.sc.step();
    const c = ui.ctx,
      a = this.area,
      oy = this.offset(ui),
      t = performance.now() - this.t0;
    ui.listBackground(a.y, a.y + a.h);
    c.save();
    c.beginPath();
    c.rect(0, a.y, ui.w, a.h);
    c.clip();
    this.rows.forEach((r, i) => {
      const y = a.y + r.y - oy;
      if (y + r.h < a.y || y > a.y + a.h) return;
      const k = clamp((t - i * 45) / 220, 0, 1);
      if (k <= 0) return;
      c.globalAlpha = k;
      this.drawRow(ui, r, y + Math.round((1 - k) * (1 - k) * 8));
      c.globalAlpha = 1;
    });
    let g = c.createLinearGradient(0, a.y, 0, a.y + 6);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, a.y, ui.w, 6);
    g = c.createLinearGradient(0, a.y + a.h - 6, 0, a.y + a.h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = g;
    c.fillRect(0, a.y + a.h - 6, ui.w, 6);
    c.restore();
    if (this.sc.max > 0) {
      const h = a.h - 4,
        bh = Math.max(16, Math.round(h * a.h / this.contentH)),
        f = clamp(this.sc.y / this.sc.max, 0, 1);
      const bx = a.x + a.w + 4,
        by = a.y + 2 + Math.round((h - bh) * f);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(bx, a.y + 2, 3, h);
      c.fillStyle = this.sc.moving() ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)';
      c.fillRect(bx, by, 3, bh);
    }
  }
}

// a mod's icon (index.json "icon": 16 px pictures drawn sharp, the 3D block ones bigger and smooth) in a slot like
// the inventory's; a mod without one (one installed with the SDK): the first character of its name
const modIconImgs = new Map();
function drawModIcon(ui, m, x, y, s) {
  const c = ui.ctx;
  c.fillStyle = '#373737';
  c.fillRect(x, y, s + 2, s + 2);
  c.fillStyle = '#FFFFFF';
  c.fillRect(x + 1, y + 1, s + 1, s + 1);
  c.fillStyle = '#8B8B8B';
  c.fillRect(x + 1, y + 1, s, s);
  let im = m.icon ? modIconImgs.get(m.id) : null;
  if (m.icon && !im) {
    im = new Image();
    im.src = m.icon;
    modIconImgs.set(m.id, im);
  }
  if (im && im.complete && im.naturalWidth) {
    c.imageSmoothingEnabled = im.naturalWidth > 16;
    c.imageSmoothingQuality = 'high';
    c.drawImage(im, x + 1, y + 1, s, s);
    c.imageSmoothingEnabled = false;
  } else Font.center(c, String(m.name || m.id).slice(0, 1), x + 1 + s / 2, y + 1 + Math.floor((s - 8) / 2), '#FFFFFF');
}
// a card's frame: 1 px round it
function modFrame(c, x, y, w, h) {
  c.fillRect(x, y, w, 1);
  c.fillRect(x, y + h - 1, w, 1);
  c.fillRect(x, y + 1, 1, h - 2);
  c.fillRect(x + w - 1, y + 1, 1, h - 2);
}
// text in lines of at most w, at most max of them (the last cut with …); a line ends after a comma / 、 / space near its
// end when there is one (金属 was split over two lines), and no line starts with one
function modWrap(text, w, max) {
  const lines = [],
    BRK = '，、。；：！？ ,;:';
  let line = '';
  for (const ch of String(text || '')) {
    if (line && Font.width(line + ch) > w && !BRK.includes(ch)) {
      let cut = -1;
      for (let i = line.length - 1; i >= Math.max(1, line.length - 8); i--) if (BRK.includes(line[i])) {
        cut = i + 1;
        break;
      }
      if (cut > 0 && cut < line.length) {
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      } else {
        lines.push(line);
        line = '';
      }
    }
    line += ch;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = fitText(lines[max - 1] + '……', w);
  }
  return lines.length ? lines : [''];
}
const modMB = n => n < 102400 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
// the name: Chinese, then the English one in grey (cut to what is left of w)
function drawModName(c, m, x, y, w) {
  const zh = fitText(m.name || m.id, w),
    nw = Font.width(zh);
  Font.draw(c, zh, x, y, '#FFFFFF');
  if (m.en && nw + 6 < w - 12) Font.draw(c, fitText(m.en, w - nw - 6), x + nw + 6, y, '#9A9A9A');
}

// ---- the mods' screen: every mod as a card - download, delete, or built in ----
class ModsScreen extends ModListScreen {
  constructor(game, parent) {
    super(game, '模组');
    this.parent = parent;
    this.list = null;
    this.note = '正在读取模组列表…';
    this.noteColor = '#A0A0A0';
    Mods.loadIndex().then(ix => {
      this.list = Mods.listed(ix);
      this.note = '';
      this.t0 = performance.now();
      this.layout();
      if (Mods.dl && !Mods.dl.background) this.follow((ix.mods || []).find(m => m.id === Mods.dl.id));
    }).catch(e => {
      this.list = [];
      this.note = e.message;
      this.noteColor = '#FF5555';
      this.layout();
    });
    this.takeGift();
  }
  // the chef's hat (the user 11-13): given the first time the screen is really opened, logged in - the room service
  // gives it once (POST /api/account/gift/mods); shown as a little ceremony over the list. A guest is told to log in
  // and come back
  async takeGift() {
    const C = typeof Cosmetics !== 'undefined' ? Cosmetics : null;
    if (!C || typeof Account === 'undefined' || typeof RoomService === 'undefined' || !RoomService.base()) return;
    if (!Account.loggedIn) {
      this.guestGift = !C.has(MODS_GIFT);
      return;
    }
    if (C.has(MODS_GIFT) || ModsScreen.giftAsked) return;
    ModsScreen.giftAsked = true;
    try {
      const r = await Account.api('/api/account/gift/mods', {});
      if (r.account) Account.took({
        account: r.account
      });
      if (!r.fresh) return;
      if (typeof Telemetry !== 'undefined' && Telemetry.count) Telemetry.count('mods_gift');
      this.pop = {
        id: r.gift || MODS_GIFT,
        t0: performance.now()
      };
      Sound.ev && Sound.ev('entity.player.levelup', null, 0.8, 1);
      this.layout();
    } catch (e) {
      ModsScreen.giftAsked = false;
    } // (asked again next time)
  }
  // the gift's card: its two buttons
  popButtons() {
    const u = this.game.ui,
      cx = Math.floor(u.w / 2),
      cy = Math.floor(u.h / 2),
      P = {
        x: cx - 110,
        y: cy - 62,
        w: 220,
        h: 124
      };
    return {
      P,
      wear: {
        x: cx - 104,
        y: P.y + P.h - 26,
        w: 102,
        h: 20,
        label: '去穿戴',
        gold: true,
        act: () => {
          this.pop = null;
          Cosmetics.openWardrobe(this.game, this, MODS_GIFT);
        }
      },
      ok: {
        x: cx + 2,
        y: P.y + P.h - 26,
        w: 102,
        h: 20,
        label: '好的',
        act: () => {
          this.pop = null;
          this.layout();
        }
      }
    };
  }
  mouseDown(ui, mx, my, b) {
    if (this.pop) {
      if (b === 0 && performance.now() - this.pop.t0 > 400) for (const k of ['wear', 'ok']) {
        const w = this.popButtons()[k];
        if (ui.hit(w, mx, my)) {
          Sound.click();
          w.act();
          return;
        }
      }
      return;
    }
    super.mouseDown(ui, mx, my, b);
  }
  drawPop(ui) {
    const c = ui.ctx,
      t = (performance.now() - this.pop.t0) / 1000,
      {
        P,
        wear,
        ok
      } = this.popButtons();
    const k = Math.min(1, t / 0.35),
      e = 1 - (1 - k) ** 3;
    c.fillStyle = 'rgba(0,0,0,' + (0.55 * e).toFixed(3) + ')';
    c.fillRect(0, 0, ui.w, ui.h);
    c.save();
    // (the card flies in: grows from the middle, a little overshoot)
    const s = k < 1 ? 0.6 + 0.4 * e + Math.sin(k * Math.PI) * 0.08 : 1,
      cx = P.x + P.w / 2,
      cy = P.y + P.h / 2;
    c.translate(cx, cy);
    c.scale(s, s);
    c.translate(-cx, -cy);
    c.globalAlpha = e;
    c.fillStyle = 'rgba(16,12,4,0.92)';
    c.fillRect(P.x, P.y, P.w, P.h);
    c.fillStyle = '#F2C94C';
    modFrame(c, P.x, P.y, P.w, P.h);
    c.fillStyle = 'rgba(242,201,76,0.35)';
    modFrame(c, P.x + 2, P.y + 2, P.w - 4, P.h - 4);
    // the light behind the hat: rays turning slowly, sparks
    const ix = cx,
      iy = P.y + 38;
    c.save();
    c.translate(ix, iy);
    c.rotate(t * 0.6);
    for (let i = 0; i < 12; i++) {
      c.rotate(Math.PI / 6);
      c.fillStyle = i % 2 ? 'rgba(255,226,122,0.18)' : 'rgba(255,240,190,0.10)';
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-5, -34);
      c.lineTo(5, -34);
      c.closePath();
      c.fill();
    }
    c.restore();
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4 + t * 0.9,
        r = 20 + (t * 18 + i * 7) % 18,
        tw = Math.max(0, Math.sin(t * 5 + i * 1.7));
      c.fillStyle = 'rgba(255,236,150,' + (0.8 * tw).toFixed(3) + ')';
      c.fillRect(Math.round(ix + Math.cos(a) * r), Math.round(iy + Math.sin(a) * r * 0.8), 1, 1);
    }
    const bounce = t < 0.9 ? Math.abs(Math.sin(t * 7)) * (0.9 - t) * 10 : Math.sin(t * 2.2) * 1.2,
      S = 32;
    Cosmetics.drawIcon(c, this.pop.id, Math.round(ix - S / 2), Math.round(iy - S / 2 - bounce), S, false);
    Font.center(c, '第一次来模组界面', cx, P.y + 64, '#E0E0E0');
    Font.center(c, '送你一顶「' + Cosmetics.name(this.pop.id) + '」！', cx, P.y + 76, '#FFD24A');
    ui.button(wear);
    ui.button(ok);
    c.restore();
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      W = Math.min(u.w - 28, 340);
    this.area = {
      x: Math.floor(cx - W / 2),
      y: 34,
      w: W,
      h: u.h - 34 - 48
    };
    this.textW = W - 45 - 72;
    // (a tapped card opens under it to its usage - index.json "usage", the user 11-13: players didn't know how to use
    // 连锁挖矿; it stays open as the list is laid out again)
    const was = new Set((this.rows || []).filter(r => r.open).map(r => r.m.id));
    this.rows = (this.list || []).map(m => {
      const lines = modWrap(m.brief || m.desc || '', this.textW, 2),
        top = 32 + lines.length * 10 + (m.usage && m.usage.length ? 10 : 0),
        open = was.has(m.id) && !!(m.usage && m.usage.length);
      const use = open ? m.usage.flatMap(t => modWrap(t, W - 51, 4)) : [];
      return {
        m,
        lines,
        top,
        open,
        use,
        h: top + (open ? use.length * 10 + 16 : 0)
      };
    });
    this.place();
    this.widgets = [{
      x: cx - 100,
      y: u.h - 28,
      w: 200,
      h: 20,
      label: '完成',
      onClick: () => this.back()
    }];
  }
  back() {
    this.game.ui.open(this.parent);
  }
  onEsc() {
    this.back();
  }
  // the player's download going on (not one fetched ahead), or its bar still running
  busy(id) {
    return !!Mods.dl && !Mods.dl.background && Mods.dl.id === id || !!this.anim && this.anim.id === id;
  }
  anyBusy() {
    return !!Mods.dl && !Mods.dl.background || !!this.anim;
  }
  // the bar: the real progress - but at least a second and a half from the click to full, also when everything was
  // already fetched ahead
  shown() {
    const d = Mods.dl,
      real = d && !d.background ? d.total ? Math.min(1, d.done / d.total) : 0 : 1;
    return this.anim ? Math.min(real, (performance.now() - this.anim.t0) / 1500) : real;
  }
  download(m) {
    this.anim = {
      id: m.id,
      t0: performance.now()
    };
    Mods.download(m).catch(() => {});
    this.layout();
    this.follow(m);
  }
  // the end of a download (started here or before): its note, the buttons again
  async follow(m) {
    if (!m || !Mods.dl) {
      this.anim = null;
      return;
    }
    let ok = true;
    try {
      await Mods.dl.promise;
    } catch (e) {
      ok = false;
      this.note = '下载失败：' + e.message + '（再点下载会从断开的地方接着下）';
      this.noteColor = '#FF5555';
    }
    if (ok && this.anim) {
      const left = 1500 - (performance.now() - this.anim.t0);
      if (left > 0) await new Promise(r => setTimeout(r, left));
    }
    this.anim = null;
    if (ok) {
      this.note = m.name + ' 下载好了：在「单人游戏」里选中世界，点「模组管理」装上';
      this.noteColor = '#80FF80';
    }
    if (this.game.ui.screen === this) this.layout();
  }
  remove(m) {
    Mods.remove(m.id);
    this.note = '已删除 ' + m.name + ' 的资源';
    this.noteColor = '#A0A0A0';
    this.layout();
  }
  // a card's button (none for one built in), at the card's y
  // the right column of a card: its button (download / delete; none built in) over its tutorial map's, when it has one -
  // the two centred together
  btnY(r, y, i) {
    const two = !!r.m.tutorial && (typeof Live === 'undefined' || Live.on('mods.tutorials'));
    return y + Math.floor(((r.top || r.h) - (two ? 38 : 18)) / 2) + (two ? i * 20 : 0);
  }
  action(r, y) {
    const m = r.m,
      a = this.area;
    if (Mods.always.includes(m.id)) return null;
    const got = Mods.isDownloaded(m.id),
      busy = this.busy(m.id);
    return {
      x: a.x + a.w - 66,
      y: this.btnY(r, y, 0),
      w: 60,
      h: 18,
      enabled: !this.anyBusy(),
      glowBlue: !got && !busy,
      label: busy ? Math.round(this.shown() * 100) + '%' : got ? '删除' : '下载',
      act: () => got ? this.remove(m) : this.download(m)
    };
  }
  // 教程地图 (the user 11-13: the demo maps made for the videos, in the game): a world of its own with the mod and the map
  tutorial(r, y) {
    const m = r.m,
      a = this.area,
      t = m.tutorial;
    if (!t || !(typeof Live === 'undefined' || Live.on('mods.tutorials'))) return null; // (the admin panel can hide them: js/live.js)
    const got = Mods.isDownloaded(m.id);
    return {
      x: a.x + a.w - 66,
      y: this.btnY(r, y, 1),
      w: 60,
      h: 18,
      enabled: got && !this.anyBusy(),
      gold: got,
      label: '教程地图',
      tip: got ? ['一张专门的教程世界：沿路线体验' + m.name + '的玩法', '输入 /demo reset 整张地图重置'] : ['先下载' + m.name],
      act: () => openTutorial(this.game, m)
    };
  }
  clickRow(r, mx, ry) {
    for (const b of [this.action(r, 0), this.tutorial(r, 0)]) {
      if (b && b.enabled && mx >= b.x && mx < b.x + b.w && ry >= b.y - 1 && ry < b.y + b.h + 1) {
        Sound.init();
        Sound.click();
        b.act();
        return;
      }
    }
    // (anywhere else on the card: its usage, open or shut)
    if (r.m.usage && r.m.usage.length) {
      Sound.init();
      Sound.click();
      r.open = !r.open;
      this.layout();
    }
  }
  draw(ui) {
    super.draw(ui);
    if (this.pop) this.drawPop(ui);
  }
  // (the list stays put under the gift's card)
  wheel(ui, dy) {
    if (!this.pop) super.wheel(ui, dy);
  }
  scrollPx(d) {
    if (!this.pop) super.scrollPx(d);
  }
  drawRow(ui, r, y) {
    const c = ui.ctx,
      a = this.area,
      m = r.m,
      hov = this.hover(ui, r, y),
      x = a.x,
      W = a.w;
    const built = Mods.always.includes(m.id),
      got = Mods.isDownloaded(m.id),
      busy = this.busy(m.id);
    c.fillStyle = hov ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.42)';
    c.fillRect(x, y, W, r.h);
    c.fillStyle = hov ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.13)';
    modFrame(c, x, y, W, r.h);
    // (a strip down the left: gold built in, green downloaded)
    if (built || got) {
      c.fillStyle = built ? '#E8B73A' : '#5FD35F';
      c.fillRect(x + 1, y + 1, 2, r.h - 2);
    }
    drawModIcon(ui, m, x + 6, y + Math.floor((r.top - 34) / 2), 32);
    const tx = x + 45,
      tw = this.textW;
    drawModName(c, m, tx, y + 6, tw);
    r.lines.forEach((l, i) => Font.draw(c, l, tx, y + 17 + i * 10, '#D2D2D2'));
    const my = y + 17 + r.lines.length * 10,
      meta = (m.author || '') + ' · ' + (m.license || '') + (built ? '' : ' · ' + modMB(m.size || 0));
    const mt = fitText(meta, tw - 36);
    Font.draw(c, mt, tx, my, '#7F7F7F');
    if (got && !built && !busy) Font.draw(c, '已下载', tx + Font.width(mt) + 6, my, '#7FD87F');
    const b = this.action(r, y),
      tb = this.tutorial(r, y);
    if (b) ui.button(b);else Font.center(c, '已内置', x + W - 36, tb ? this.btnY(r, y, 0) + 5 : y + Math.floor((r.top - 8) / 2), '#F2C94C');
    // the usage: a hint to tap while shut; open, its lines under a thin rule
    if (m.usage && m.usage.length) {
      if (!r.open) Font.draw(c, '点开看用法 »', tx, my + 10, '#6FB8FF');else {
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(x + 6, y + r.top, W - 12, 1);
        Font.draw(c, '用法', x + 6, y + r.top + 5, '#FFD24A');
        r.use.forEach((l, i) => Font.draw(c, l, x + 33, y + r.top + 5 + i * 10, '#E6E6E6'));
        Font.draw(c, '« 收起', x + W - 6 - Font.width('« 收起'), y + r.h - 11, '#6FB8FF');
      }
    }
    if (tb) ui.button(tb);
    if (busy) {
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(x + 1, y + r.h - 3, W - 2, 2);
      c.fillStyle = '#4AA8FF';
      c.fillRect(x + 1, y + r.h - 3, Math.round((W - 2) * this.shown()), 2);
    }
  }
  drawExtra(ui) {
    const c = ui.ctx,
      cx = ui.w / 2;
    if (this.guestGift) Font.center(c, fitText('登录后再打开这里，送你一顶厨师帽', ui.w - 16), cx, 22, '#FFD24A');else Font.center(c, fitText('下载后，在「单人游戏」里选中世界，点「模组管理」勾选要装的模组', ui.w - 16), cx, 22, '#A0A0A0');
    this.drawList(ui);
    if (this.list && !this.list.length && !this.note) Font.center(c, '还没有模组', cx, this.area.y + 20, '#A0A0A0');
    if (this.note) Font.center(c, fitText(this.note, ui.w - 16), cx, ui.h - 42, this.noteColor);
  }
}

// ---- a world's mods (创建新的世界 / 编辑世界 / 模组管理): every mod with a box to tick; one not downloaded yet
// is shown greyed out - a tap on it opens the mods' screen to download it ----
class ModPickScreen extends ModListScreen {
  constructor(game, parent, chosen, onDone, opts = {}) {
    super(game, opts.title || '世界的模组');
    this.parent = parent;
    this.chosen = new Set(chosen || []);
    this.was = new Set(opts.was || chosen || []);
    this.onDone = onDone;
    this.opts = opts;
    this.list = null;
    Mods.loadIndex().then(ix => {
      this.list = Mods.listed(ix);
      this.t0 = performance.now();
      this.layout();
    }).catch(() => {
      this.list = [];
      this.layout();
    });
  }
  layout() {
    const u = this.game.ui,
      cx = u.w / 2,
      W = Math.min(u.w - 28, 320);
    this.area = {
      x: Math.floor(cx - W / 2),
      y: 34,
      w: W,
      h: u.h - 34 - 50
    };
    this.rows = (this.list || []).map(m => ({
      m,
      h: 32
    }));
    this.place();
    const bw = Math.min(100, Math.floor((Math.min(u.w - 16, 316) - 8) / 3)),
      x0 = Math.floor(cx - (bw * 3 + 8) / 2);
    this.widgets = [{
      x: x0,
      y: u.h - 28,
      w: bw,
      h: 20,
      label: '完成',
      onClick: () => this.done()
    }, {
      x: x0 + bw + 4,
      y: u.h - 28,
      w: bw,
      h: 20,
      label: '下载模组…',
      onClick: () => this.toDownloads()
    }, {
      x: x0 + 2 * bw + 8,
      y: u.h - 28,
      w: bw,
      h: 20,
      label: '取消',
      onClick: () => this.onEsc()
    }];
  }
  // (back here after, with the ticks as they are)
  toDownloads() {
    this.game.ui.open(new ModsScreen(this.game, new ModPickScreen(this.game, this.parent, [...this.chosen], this.onDone, Object.assign({}, this.opts, {
      was: [...this.was]
    }))));
  }
  done() {
    this.onDone([...this.chosen]);
    this.game.ui.open(this.parent);
  }
  onEsc() {
    this.game.ui.open(this.parent);
  }
  gone() {
    return [...this.was].filter(id => !this.chosen.has(id));
  }
  clickRow(r) {
    const id = r.m.id;
    Sound.init();
    Sound.click();
    if (!Mods.isDownloaded(id)) {
      this.toDownloads();
      return;
    }
    if (this.chosen.has(id)) this.chosen.delete(id);else this.chosen.add(id);
    r.flip = performance.now();
  }
  drawRow(ui, r, y) {
    const c = ui.ctx,
      a = this.area,
      m = r.m,
      hov = this.hover(ui, r, y),
      x = a.x,
      W = a.w;
    const got = Mods.isDownloaded(m.id),
      on = got && this.chosen.has(m.id);
    if (!got) c.globalAlpha *= 0.6;
    c.fillStyle = on ? hov ? 'rgba(70,150,255,0.34)' : 'rgba(50,130,255,0.24)' : hov ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.42)';
    c.fillRect(x, y, W, r.h);
    c.fillStyle = on ? 'rgba(120,190,255,0.85)' : hov ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.13)';
    modFrame(c, x, y, W, r.h);
    // the box: ticked with a pop (it grows from small for a moment)
    const bx = x + 8,
      by = y + 10;
    c.fillStyle = hov ? '#FFFFFF' : '#A0A0A0';
    modFrame(c, bx, by, 12, 12);
    c.fillStyle = on ? '#2F7FE0' : '#101010';
    c.fillRect(bx + 1, by + 1, 10, 10);
    if (on) {
      const k = r.flip ? clamp((performance.now() - r.flip) / 140, 0, 1) : 1,
        s = 0.55 + 0.45 * k;
      c.save();
      c.translate(bx + 6, by + 6);
      c.scale(s, s);
      c.fillStyle = '#FFFFFF';
      // (the tick, 2 px thick: down the short side, up the long one)
      for (let i = 0; i < 3; i++) c.fillRect(-4 + i, -1 + i, 2, 2);
      for (let i = 0; i < 5; i++) c.fillRect(-1 + i, 1 - i, 2, 2);
      c.restore();
    }
    drawModIcon(ui, m, x + 26, y + 3, 24);
    const tx = x + 58,
      tw = W - 58 - (got ? 8 : 52);
    drawModName(c, m, tx, y + 6, tw);
    Font.draw(c, fitText(m.brief || m.desc || '', tw), tx, y + 18, '#A8A8A8');
    if (!got) Font.draw(c, '未下载', x + W - 46, y + 12, '#FF9090');
    if (!got) c.globalAlpha /= 0.6;
  }
  drawExtra(ui) {
    const c = ui.ctx,
      cx = ui.w / 2;
    Font.center(c, fitText(this.opts.world ? '世界：' + this.opts.world.name : '勾选这个世界要装的模组（可以装多个）', ui.w - 16), cx, 22, '#A0A0A0');
    this.drawList(ui);
    if (!this.list) Font.center(c, '正在读取模组列表…', cx, this.area.y + 20, '#A0A0A0');else if (!this.list.length) Font.center(c, '还没有模组', cx, this.area.y + 20, '#A0A0A0');
    // (taking one away from a world that has it: its blocks and items there are gone)
    const gone = this.gone();
    if (this.opts.existing && gone.length) Font.center(c, fitText('去掉 ' + gone.map(id => Mods.nameOf(id)).join('、') + ' 后，世界里它的方块和物品会消失', ui.w - 16), cx, ui.h - 43, '#FF5555');else Font.center(c, fitText('已选 ' + [...this.chosen].filter(id => Mods.isDownloaded(id)).length + ' 个 · 只在单人游戏里生效', ui.w - 16), cx, ui.h - 43, '#A0A0A0');
  }
}
// the way into the mods' screen (the title's 模组 button, the wardrobe's chef's hat): one place, so a condition can be
// put in front of it later (the user 11-13: e.g. following and 三连 a new video)
const MODS_GIFT = 'hat:chef';
// a mod's tutorial map (index.json "tutorial": { mod, name, seed, difficulty }): its world if there is one, else made -
// superflat, survival with cheats on, with the mod and the map's own (it builds itself on entering: tcdemo, fddemo)
async function openTutorial(g, m) {
  const t = m.tutorial;
  if (!t) return;
  if (!Mods.isDownloaded(t.mod)) Mods.markDownloaded(t.mod); // (the mod downloaded before tutorials came)
  if (typeof Telemetry !== 'undefined' && Telemetry.count) Telemetry.count('mods_tutorial:' + m.id);
  let list = [];
  try {
    list = await DB.listWorlds();
  } catch (e) {}
  const w = list.find(x => (x.mods || []).includes(t.mod));
  if (w) {
    g.ui.hideInput && g.ui.hideInput();
    g.loadWorld(w.id);
    return;
  }
  Mods.reloadWith([m.id, t.mod], {
    create: [t.name, t.seed, 'survival', true, {
      cheats: true,
      difficulty: t.difficulty || 0
    }]
  });
}
// the 模组 screen, and choosing a world's mods, ask what playing online asks (the user, 11-13): an account that follows
// the UP and gave the new video a 三连 (the service's gate, /api/gate). What the service already saw is enough - an
// account logged in by its identity code somewhere without Bilibili goes straight in; in Bilibili it's checked again
// on the way (unfollowed, it's asked again). A super administrator, and a page without a room service (a test page),
// go straight in. Only past this does the 模组 screen open - and give its gift (ModsScreen.takeGift)
async function modsGate(g, then, parent) {
  return then(); // 离线包：不要求登录/关注/三连，任何入口直接放行
  const gate = await Account.loadGate();
  if (!gate.requireAccount && !gate.follow && !gate.triple) return then();
  if (!Account.loggedIn) {
    Telemetry.count && Telemetry.count('gate_mods_login');
    return g.ui.open(new LoginScreen(g, () => modsGate(g, then, parent), () => g.ui.open(parent || new TitleScreen(g))));
  }
  if (Account.data && Account.data.super || Account.has('online')) {
    then();
    Account.checkUnlocks(true).catch(() => {});
    return;
  }
  try {
    await Account.checkUnlocks(true);
  } catch (e) {}
  if (Account.has('online')) return then();
  Telemetry.count && Telemetry.count('gate_mods');
  g.ui.open(new UnlockScreen(g, parent, gate.triple && gate.videos && gate.videos.length ? '模组需要关注 UP 主并给新视频三连（老视频的三连不算）' : '模组需要关注 UP 主', () => modsGate(g, then, parent)));
}
function openModsScreen(g, parent) {
  // 离线包：没有 B站账号服务，直接打开模组界面（不弹登录）
  g.ui.open(new ModsScreen(g, parent));
}
const modNames = ids => ids && ids.length ? ids.map(id => Mods.nameOf(id)).join('、') : '无';

// the title: a 模组 button under the others
(() => {
  const lay = TitleScreen.prototype.layout;
  TitleScreen.prototype.layout = function () {
    lay.call(this);
    // (under 皮肤和披风 / 反馈问题; the options row moves 12 down to make room - at l + 108 it covered the bottom lines)
    // (glowBlue: the blue shine of 触控设置 - the flat light-blue fill looked plain, the user 11-07)
    const u = this.game.ui,
      cx = u.w / 2,
      l = Math.floor(u.h / 4 + 48);
    // (the admin panel can take the mods' ways in away: js/live.js title.mods)
    if (typeof Live === 'undefined' || Live.on('title.mods')) {
      for (const w of this.widgets) if (w.y === l + 84) w.y += 12;
      this.widgets.push({
        x: cx - 100,
        y: l + 72,
        w: 200,
        h: 20,
        label: '模组',
        glowBlue: true,
        tip: ['下载模组；在「单人游戏」里选中世界，点「模组管理」勾选'],
        onClick: () => openModsScreen(this.game, this)
      });
    }
    // (the page loaded again for a world: on into it, once)
    const b = Mods.boot;
    if (b && !b.done && (b.open || b.create)) {
      b.done = true;
      const g = this.game;
      setTimeout(() => {
        if (b.open) g.loadWorld(b.open);else g.createWorld(...b.create);
      }, 0);
    }
  };
  Mods.loadIndex().catch(() => {});
})();

// ---- a world's mods ----
(() => {
  // making one: the mods picked (CreateWorldScreen's 游戏 tab); other than those loaded - the page loads again with them
  const cl = CreateWorldScreen.prototype.layout;
  CreateWorldScreen.prototype.layout = function () {
    if (this.mods === undefined) this.mods = this.from && this.from.mods ? [...this.from.mods] : (window.__OFFLINE_MODS ? window.__OFFLINE_MODS.slice() : []);
    cl.call(this);
    if (this.tab !== 0) return;
    const u = this.game.ui,
      cx = u.w / 2,
      foot = this.widgets.find(w => w.label === '创建新的世界');
    const last = this.widgets.filter(w => w !== foot && w.label !== '取消').reduce((a, w) => Math.max(a, w.y), 0);
    const y = Math.min(last + 28, u.h - 56);
    this.widgets.push({
      x: cx - 105,
      y,
      w: 210,
      h: 20,
      glowBlue: true,
      label: () => fitText('模组：' + modNames(this.mods), 200),
      tip: ['这个世界装的模组（可以装多个）'],
      onClick: () => {
        this.game.ui.hideInput();
        modsGate(this.game, () => this.game.ui.open(new ModPickScreen(this.game, this, this.mods, m => {
          this.mods = m;
        })), this);
      }
    });
  };
  const cc = CreateWorldScreen.prototype.create;
  CreateWorldScreen.prototype.create = function () {
    const mods = this.mods || [];
    if (!Mods.same(mods, Mods.active)) {
      const hc = this.mode === 'hardcore';
      this.game.ui.hideInput();
      Mods.reloadWith(mods, {
        create: [this.name.trim() || '新的世界', this.seed.trim(), hc ? 'survival' : this.mode, this.flat, {
          hardcore: hc,
          difficulty: hc ? 3 : this.difficulty,
          cheats: !hc && this.cheats,
          structures: this.structures,
          bonus: this.bonus
        }]
      });
      return;
    }
    return cc.call(this);
  };
  // (重建 keeps the world's mods: CreateWorldScreen(game, parent, from) - this.from)
  // a world saved without a list of mods (one just made - createWorld saves it, then opens it): it has the mods this
  // page runs (the page always runs the mods of the world being played)
  if (typeof DB !== 'undefined' && DB.putWorld) {
    const pw = DB.putWorld.bind(DB);
    DB.putWorld = function (m, ...a) {
      if (m && m.mods === undefined) m.mods = Mods.active.slice();
      return pw(m, ...a);
    };
  }
  // editing one: its mods changed (a mod taken away: its blocks there are gone the next time it is opened)
  const el = EditWorldScreen.prototype.layout;
  EditWorldScreen.prototype.layout = function () {
    if (this.mods === undefined) this.mods = [...(this.world.mods || [])];
    el.call(this);
    const u = this.game.ui,
      cx = u.w / 2;
    this.widgets.push({
      x: cx - 100,
      y: 197,
      w: 200,
      h: 20,
      glowBlue: true,
      label: () => fitText('模组：' + modNames(this.mods), 190),
      tip: ['这个世界装的模组（可以装多个）'],
      onClick: () => {
        this.game.ui.hideInput();
        modsGate(this.game, () => this.game.ui.open(new ModPickScreen(this.game, this, this.mods, m => {
          this.mods = m;
        }, {
          existing: true
        })), this);
      }
    });
  };
  const es = EditWorldScreen.prototype.save;
  EditWorldScreen.prototype.save = async function () {
    this.world.mods = [...(this.mods || [])];
    return es.call(this);
  };
  // opening one: its mods downloaded (else the mods' screen), the page loaded with them (else loaded again for it)
  const lw = Game.prototype.loadWorld;
  Game.prototype.loadWorld = async function (id) {
    const meta = await DB.getWorld(id),
      want = meta && meta.mods || [];
    // (the list only names the mods: not waited for without any, nor more than 3 s - on a stalled connection the click
    // seemed to do nothing, 11-10)
    if (want.length) try {
      await Promise.race([Mods.loadIndex(), new Promise(r => setTimeout(r, 3000))]);
    } catch (e) {}
    const missing = want.filter(m => !Mods.isDownloaded(m));
    if (missing.length) {
      this.ui.open(new ConfirmScreen(this, '这个世界用了模组：' + modNames(missing), '先在「模组」里下载，再打开这个世界', '去模组', yes => yes ? openModsScreen(this, new WorldListScreen(this)) : this.ui.open(new WorldListScreen(this))));
      return;
    }
    if (!Mods.same(want, Mods.active)) {
      this.ui.hideInput && this.ui.hideInput();
      this.ui.open(new LoadingModsScreen(this, want));
      Mods.reloadWith(want, {
        open: id
      });
      return;
    }
    this.modTips = Mods.active.length ? {
      at: 0
    } : null;
    return lw.call(this, id);
  };
  // (the user 11-13: many didn't know how to use 连锁挖矿 - on entering a world with mods, a line for each in the chat,
  // index.json "hint", a moment after the welcome line; again each time a world is opened)
  const tk = Game.prototype.tick;
  Game.prototype.tick = function (...a) {
    const T = this.modTips;
    if (T && this.state === 'play' && !this.net) {
      if (!T.at) T.at = performance.now();else if (performance.now() - T.at > 1500) {
        this.modTips = null;
        const ms = (Mods.index && Mods.index.mods || []).filter(m => Mods.active.includes(m.id) && m.hint);
        if (ms.length) {
          this.ui.message('这个世界装了模组（「模组」界面里点开卡片能看详细用法）：', '#FFD24A');
          for (const m of ms) this.ui.message('【' + m.name + '】' + m.hint, '#9FDCFF');
        }
      }
    }
    return tk.apply(this, a);
  };
  // the world list: 模组管理 - a row of its own under the other buttons (they and the list's bottom move up for it), lit
  // and clickable once a world is picked: its mods ticked in a list (the user 11-12)
  const wl = WorldListScreen.prototype.layout;
  WorldListScreen.prototype.layout = function () {
    wl.call(this);
    if (!(typeof Live === 'undefined' || Live.on('title.mods'))) return;
    const u = this.game.ui,
      cx = u.w / 2,
      g = this.game,
      w = this.shown()[this.sel];
    for (const b of this.widgets) b.y -= 24;
    this.listBottom -= 24;
    this.widgets.push({
      x: cx - 154,
      y: u.h - 28,
      w: 308,
      h: 20,
      enabled: !!w,
      glowBlue: !!w,
      label: () => !w ? '模组管理（先选中一个世界）' : fitText('模组管理' + (w.mods && w.mods.length ? '：' + modNames(w.mods) : '：没有装模组'), 296),
      tip: ['选中的世界装哪些模组：勾选（可以装多个）'],
      onClick: () => {
        g.ui.hideInput();
        modsGate(g, () => g.ui.open(new ModPickScreen(g, this, w.mods || [], async m => {
          w.mods = m;
          try {
            await DB.putWorld(w);
          } catch (e) {
            console.error(e);
          }
        }, {
          existing: true,
          title: '模组管理',
          world: w
        })), this);
      }
    });
  };
  // the world list: a world's mods under its name
  const wd = WorldListScreen.prototype.drawExtra;
  WorldListScreen.prototype.drawExtra = function (ui) {
    wd.call(this, ui);
    if (!this.worlds) return;
    const c = ui.ctx,
      cx = ui.w / 2,
      top = this.listTop,
      bottom = this.listBottom,
      rowH = 36,
      x0 = Math.floor(cx - this.rowW / 2) + 2;
    const list = this.shown(),
      vis = Math.floor((bottom - top - 4) / rowH);
    c.save();
    c.beginPath();
    c.rect(0, top, ui.w, bottom - top);
    c.clip();
    list.slice(this.scroll, this.scroll + vis + 1).forEach((w, i) => {
      if (!w.mods || !w.mods.length) return;
      const y = top + 4 + i * rowH,
        t = '模组：' + modNames(w.mods),
        tw = Font.width(t);
      Font.draw(c, fitText(t, 110), x0 + this.rowW - 6 - Math.min(110, tw), y + 1, '#80C8FF');
    });
    c.restore();
  };
})();
// (while the page loads again for a world's mods)
class LoadingModsScreen extends MenuScreen {
  constructor(game, mods) {
    super(game, null);
    this.mods = mods;
    this.pauses = false;
  }
  layout() {
    this.widgets = [];
  }
  drawExtra(ui) {
    Font.center(ui.ctx, mods_loadingText(this.mods), ui.w / 2, ui.h / 2 - 4, '#FFFFFF');
  }
}
const mods_loadingText = mods => mods.length ? '正在加载模组：' + modNames(mods) + '…' : '正在卸下模组…';

// the SDK's local test (?modtest=... on this computer - tools/modsdk): straight on to the title and the test world, without
// the agreement and the first-run questions (patched once every script is in: onboard.js comes after this file)
if (Mods.testing.length && typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  document.addEventListener('DOMContentLoaded', () => {
    const st = Game.prototype.startTitle;
    Game.prototype.startTitle = function (...a) {
      const s = this.settings;
      if (!s.onboarded) {
        s.onboarded = true;
        s.playerKind = s.playerKind || 'vet';
      }
      s.seenBuild = GAME_BUILD;
      if (typeof LEGAL !== 'undefined') s.legalV = LEGAL.v;
      if (typeof FPS_TEST_V !== 'undefined' && (s.fpsTestV || 0) < FPS_TEST_V) s.fpsTestV = FPS_TEST_V;
      this.saveSettings();
      return st.apply(this, a);
    };
  });
}
