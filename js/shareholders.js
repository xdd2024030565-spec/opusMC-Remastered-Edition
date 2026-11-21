
'use strict';

// ---------------------------------------------------------------------------
// 股东名单 (the user 11-13): who follows the UP gets in (the title screen's 股东名单 button - in Bilibili, not
// following: the follow screen first) and may put their own name in it (their Bilibili nickname: the account's,
// so logged in). The names flow past in one of two looks, picked at random each time it opens (the user 11-13:
// 弹幕 and 烟花 only, not chosen by the player), the count
// above them, live: the room service is asked every few seconds what came in since (multiplayer/rooms/shareholders.js)
// - a new one comes in with a welcome, their name thrown into the flow. 找到我: the player's own name comes into the
// flow and stands out of it - the others dim and slow, theirs held in the light a while, then the flow goes on (the
// user 11-13: not a lottery reel); joining throws their name in the same way, from the button - a danmaku sent, a
// rocket going up. The player can take their name out again (a tap on 第 N 位股东).
// ---------------------------------------------------------------------------
const Share = {
  count: 0,
  seq: -1,
  pool: [],
  at: 0,
  me: null,
  err: '',
  news: [],
  ok: false,
  url(q) {
    return RoomService.base() + '/api/shareholders' + (q || '');
  },
  async get(q) {
    const f = await fetch(this.url(q));
    if (!f.ok) throw new Error('股东名单读取失败（' + f.status + '）');
    return f.json();
  },
  // the first look: the count, a sample of names (random ones and the newest), shuffled
  async load() {
    const r = await this.get('');
    this.count = r.count | 0;
    this.seq = r.seq | 0;
    const names = [...new Set([...(r.names || []), ...(r.recent || []).map(x => x[0])])];
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    this.pool = names;
    this.at = 0;
    this.ok = true;
    this.err = '';
  },
  // what came in since the last look: into the pool, and welcomed
  async poll() {
    if (this.seq < 0) return this.load();
    const r = await this.get('?after=' + this.seq);
    this.count = r.count | 0;
    this.seq = r.seq | 0;
    for (const [name, no] of r.add || []) {
      if (!this.pool.includes(name)) this.pool.splice(Math.floor(Math.random() * (this.pool.length + 1)), 0, name);
      this.news.push({
        name,
        no,
        t: performance.now()
      });
    }
    if (this.news.length > 20) this.news.splice(0, this.news.length - 20);
  },
  async mine() {
    if (!Account.loggedIn) {
      this.me = null;
      return;
    }
    try {
      this.me = await Account.api('/api/account/shareholders/me', {});
    } catch (e) {}
  },
  async join() {
    // (the follow told to the account first - the service lets in only those it knows follow. Following is all it
    // asks, no 三连 (the user 11-13): only the follow is read and told, not the whole unlock check)
    try {
      if (typeof Toy !== 'undefined' && !Toy.phoneWeb && (await Toy.ready()) && (await Toy.following()) === true) await Account.api('/api/account/unlocks', {
        follow: true
      });
    } catch (e) {}
    const r = await Account.api('/api/account/shareholders/join', {});
    this.me = r;
    this.count = Math.max(this.count, r.count | 0);
    if (r.name && !this.pool.includes(r.name)) this.pool.push(r.name);
    return r;
  },
  async leave() {
    const r = await Account.api('/api/account/shareholders/leave', {});
    this.me = r;
    this.count = r.count | 0;
    return r;
  },
  // the next name to show (round the pool; nothing yet: an empty seat)
  next() {
    if (!this.pool.length) return null;
    if (this.at >= this.pool.length) this.at = 0;
    return this.pool[this.at++];
  }
};

// ---- small things the looks share ----
const SH = {
  hash(s) {
    let h = 2166136261;
    for (const ch of String(s)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  },
  // text at a scale (1 = the game's 8 px font), alpha, from its left or centred
  text(c, s, x, y, col, k = 1, a = 1, center = false, shadow = true) {
    if (a <= 0.01) return;
    c.save();
    c.globalAlpha *= Math.min(1, a);
    const w = Font.width(s);
    c.translate(center ? x - w * k / 2 : x, y);
    if (k !== 1) c.scale(k, k);
    Font.draw(c, s, 0, 0, col, shadow);
    c.restore();
  },
  hsl: (h, s, l) => 'hsl(' + Math.round((h % 360 + 360) % 360) + ',' + s + '%,' + l + '%)',
  hex(h, s, l) {
    // (the font wants #rrggbb)
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12,
      a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
    return '#' + f(0) + f(8) + f(4);
  },
  stars(n, seed) {
    const out = [];
    for (let i = 0; i < n; i++) out.push([SH.hash(seed + 'x' + i), SH.hash(seed + 'y' + i), SH.hash(seed + 's' + i)]);
    return out;
  }
};
const EMPTY_SEAT = '虚位以待';

// ---- the looks: each { id, name, init(S), step(S, dt, t), draw(S, c, t) } with its own things in S.st ----
// S: the screen (S.w, S.h, S.top: under the heading, S.bot: above the buttons, S.me: the player's own name or null,
// S.slow: 0-1 how much the flow is held back - 找到我)
const SHARE_STYLES = [
// 弹幕: names flying across like Bilibili's danmaku - most white, some coloured, now and then a big one; the
// player's own in a box (as one's own danmaku is); a newcomer's welcome fixed at the top
{
  id: 'danmaku',
  name: '弹幕',
  COLS: ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FE0302', '#FFFF00', '#00CD00', '#89D5FF', '#FF7204', '#CC0273', '#4266BE'],
  init(S) {
    S.st = {
      items: [],
      lanes: [],
      top: []
    };
  },
  step(S, dt) {
    const st = S.st,
      lh = 12,
      n = Math.max(3, Math.floor((S.bot - S.top - 8) / lh));
    while (st.lanes.length < n) st.lanes.push(0);
    st.lanes.length = n;
    for (let i = 0; i < n; i++) {
      st.lanes[i] -= dt;
      if (st.lanes[i] > 0) continue;
      // (a newcomer's name thrown in: big, gold, the next lane free)
      const inc = i < n - 1 && S.incoming.length ? S.incoming.shift() : null;
      const name = inc || Share.next() || EMPTY_SEAT,
        big = !!inc || Math.random() < 0.06 && i < n - 1,
        k = big ? 2 : 1;
      const w = Font.width(name) * k,
        v = (55 + Math.random() * 45) * (S.w / 400 + 0.4) * (big ? 0.8 : 1);
      const col = inc ? '#F2C94C' : name === EMPTY_SEAT ? '#808080' : this.COLS[Math.floor(SH.hash(name) * this.COLS.length)];
      st.items.push({
        name,
        x: S.w + 4,
        y: S.top + 4 + i * lh,
        v,
        k,
        w,
        col,
        mine: name === S.me
      });
      st.lanes[i] = (w + 24) / v + Math.random() * 1.6;
      if (big) st.lanes[i + 1] = Math.max(st.lanes[i + 1], st.lanes[i]);
    }
    for (const it of st.items) it.x -= it.v * dt * (1 - S.slow * 0.85);
    st.items = st.items.filter(it => it.x + it.w > -4);
    for (const nw of Share.news.splice(0)) st.top.push({
      text: '欢迎 ' + nw.name + ' 成为第 ' + nw.no + ' 位股东！',
      t: 0
    });
    for (const x of st.top) x.t += dt;
    st.top = st.top.filter(x => x.t < 4);
    // the player's own name: in (from the right like any danmaku, or sent up from the join button), easing to a stop
    // in the middle, held there big and lit; then off to the left with the rest
    const h = st.hero;
    if (h) {
      h.t += dt;
      if (h.skip && h.t > h.IN && h.t < h.IN + h.HOLD) h.t = h.IN + h.HOLD;
      if (h.t < h.IN) {
        const e = 1 - Math.pow(1 - h.t / h.IN, 3);
        h.s = h.from ? 1 + e : 2;
        h.cx = h.x0 + (S.w / 2 - h.x0) * e;
        h.cy = h.y0 + (h.yc - h.y0) * e - (h.from ? Math.sin(e * Math.PI) * 26 : 0);
      } else if (h.t < h.IN + h.HOLD) {
        h.s = 2;
        h.cx = S.w / 2;
        h.cy = h.yc;
        if (!h.landed) {
          h.landed = true;
          Sound.ev && Sound.ev('entity.player.levelup', null, 0.8, 1.3);
        }
      } else {
        h.dim = false;
        h.v = (h.v || 40) + 520 * dt;
        h.cx -= h.v * dt;
        if (h.cx + Font.width(h.name) < -8) st.hero = null;
      }
    }
  },
  hero(S, h) {
    const yc = Math.round((S.top + S.bot) / 2 - 8);
    Object.assign(h, {
      t: 0,
      IN: h.from ? 0.8 : 1.2,
      HOLD: 2.8,
      dim: true,
      s: h.from ? 1 : 2,
      yc,
      x0: h.from ? h.from.x : S.w + 4 + Font.width(h.name),
      y0: h.from ? h.from.y - 8 : yc
    });
    h.cx = h.x0;
    h.cy = h.y0;
    S.st.hero = h;
    if (typeof Sound !== 'undefined' && Sound.click) Sound.click();
  },
  // (over the dimmed flow: the name in gold in its own-danmaku box, a glow and a few glints round it, a line under it)
  drawHero(S, c, t) {
    const h = S.st.hero;
    if (!h) return;
    const held = h.landed && h.dim,
      k = h.s + (held ? Math.sin(h.t * 5) * 0.06 : 0),
      w = Font.width(h.name) * k,
      x = Math.round(h.cx - w / 2),
      y = Math.round(h.cy),
      my = y + 4 * k;
    const gl = c.createRadialGradient(h.cx, my, 0, h.cx, my, w / 2 + 34);
    gl.addColorStop(0, 'rgba(255,214,90,' + (held ? 0.32 : 0.18) + ')');
    gl.addColorStop(1, 'rgba(255,214,90,0)');
    c.fillStyle = gl;
    c.fillRect(h.cx - w / 2 - 40, my - w / 2 - 40, w + 80, w + 80);
    const bx = x - 3,
      by = y - 3,
      bw = Math.round(w) + 6,
      bh = Math.round(8 * k) + 5;
    c.fillStyle = 'rgba(8,10,20,0.8)';
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.fillRect(bx, by, bw, 1);
    c.fillRect(bx, by + bh, bw + 1, 1);
    c.fillRect(bx, by, 1, bh);
    c.fillRect(bx + bw, by, 1, bh);
    SH.text(c, h.name, x, y, '#FFE94A', k, 1);
    if (held) {
      const a = Math.min(1, (h.t - h.IN) * 3);
      for (let i = 0; i < 8; i++) {
        const q = Math.sin(t * 3 + i * 2.1);
        if (q < 0.3) continue;
        const gx = Math.round(h.cx + Math.cos(i * 0.785 + 0.3) * (w / 2 + 14)),
          gy = Math.round(my + Math.sin(i * 0.785 + 0.3) * (6 * k + 6));
        c.fillStyle = 'rgba(255,240,180,' + (a * q).toFixed(2) + ')';
        c.fillRect(gx, gy - 1, 1, 3);
        c.fillRect(gx - 1, gy, 3, 1);
      }
      SH.text(c, h.kind === 'join' ? '欢迎你成为第 ' + h.no + ' 位股东！' : '你在这里 · 第 ' + h.no + ' 位股东', S.w / 2, by + bh + 8, '#FFFFFF', 1, a, true);
    }
  },
  draw(S, c, t) {
    const g = c.createLinearGradient(0, 0, 0, S.h);
    g.addColorStop(0, '#0B0E1A');
    g.addColorStop(1, '#171C30');
    c.fillStyle = g;
    c.fillRect(0, 0, S.w, S.h);
    // (a player's frame: faint scan lines, a pink progress bar running)
    c.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < S.h; y += 3) c.fillRect(0, y, S.w, 1);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(8, S.bot - 3, S.w - 16, 1);
    const pg = t / 40 % 1 * (S.w - 16);
    c.fillStyle = '#FB7299';
    c.fillRect(8, S.bot - 3, pg, 1);
    c.fillRect(8 + pg - 1, S.bot - 5, 3, 5);
    for (const it of S.st.items) {
      if (it.mine) {
        c.fillStyle = 'rgba(255,255,255,0.9)';
        const x = Math.round(it.x) - 2,
          y = it.y - 2,
          w = it.w + 4,
          h = 8 * it.k + 3;
        c.fillRect(x, y, w, 1);
        c.fillRect(x, y + h, w, 1);
        c.fillRect(x, y, 1, h);
        c.fillRect(x + w, y, 1, h + 1);
      }
      SH.text(c, it.name, it.x, it.y, it.col, it.k, 1);
    }
    let y = S.top + 2;
    for (const x of S.st.top) {
      const a = Math.min(1, x.t * 4, (4 - x.t) * 2);
      c.fillStyle = 'rgba(0,0,0,' + 0.45 * a + ')';
      c.fillRect(S.w / 2 - Font.width(x.text) / 2 - 4, y - 2, Font.width(x.text) + 8, 12);
      SH.text(c, x.text, S.w / 2, y, '#FFE94A', 1, a, true);
      y += 13;
    }
  }
},
// 烟花: rockets from the town below bursting over it - a burst's name large in the middle, a few more flung out and
// falling with the sparks
{
  id: 'fireworks',
  name: '烟花',
  init(S) {
    S.st = {
      rockets: [],
      sparks: [],
      names: [],
      spawn: 0.2,
      sky: SH.stars(90, 'f')
    };
  },
  step(S, dt) {
    const st = S.st,
      k = 1 - S.slow * 0.85,
      gy = 70;
    st.spawn -= dt * k;
    if (st.spawn <= 0) {
      st.rockets.push({
        x: S.w * (0.15 + Math.random() * 0.7),
        y: S.bot - 14,
        vy: -(S.bot - S.top) * (0.9 + Math.random() * 0.35),
        h: Math.random() * 360
      });
      st.spawn = 0.75 + Math.random() * 0.7;
    }
    for (const r of st.rockets) {
      // (the player's own rocket - and its sparks - at full speed while the rest is held back)
      const kk = r.hero ? 1 : k;
      r.x += (r.vx || 0) * dt * kk;
      r.y += r.vy * dt * kk;
      r.vy += gy * 1.6 * dt * kk;
      if (Math.random() < (r.hero ? 1 : 0.6)) st.sparks.push({
        x: r.x + (Math.random() - 0.5),
        y: r.y + 2,
        vx: 0,
        vy: 10,
        t: 0,
        life: r.hero ? 0.6 : 0.4,
        c: '#FFE2A0',
        hero: r.hero
      });
      if (r.vy > -30 || r.y < S.top + 20) {
        r.done = true;
        if (r.hero) {
          // (the player's own: a big gold and white burst, their name in the middle of it)
          for (let i = 0; i < 140; i++) {
            const a = i / 70 * Math.PI * 2 + Math.random() * 0.05,
              v = (i < 70 ? 95 : 55) + Math.random() * 25;
            st.sparks.push({
              x: r.x,
              y: r.y,
              vx: Math.cos(a) * v,
              vy: Math.sin(a) * v,
              t: 0,
              life: 1.8 + Math.random() * 0.8,
              c: i % 3 ? '#FFD86A' : '#FFFFFF',
              hero: true
            });
          }
          const h = st.hero;
          if (h) {
            h.up = false;
            h.x = r.x;
            h.y = r.y;
            h.bt = 0;
          }
          Sound.ev && Sound.ev('entity.firework_rocket.large_blast', null, 1, 1);
          continue;
        }
        const col = SH.hsl(r.h, 90, 65);
        for (let i = 0; i < 46; i++) {
          const a = i / 46 * Math.PI * 2,
            v = 40 + Math.random() * 40;
          st.sparks.push({
            x: r.x,
            y: r.y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            t: 0,
            life: 1.2 + Math.random() * 0.6,
            c: col
          });
        }
        // (a newcomer's name thrown in: theirs the big one)
        const big = S.incoming.length && S.incoming.shift() || Share.next() || EMPTY_SEAT;
        st.names.push({
          name: big,
          x: r.x,
          y: r.y,
          vx: 0,
          vy: -6,
          t: 0,
          life: 2.6,
          k: 2,
          col: SH.hex(r.h, 90, 75)
        });
        for (let i = 0; i < 5; i++) {
          const n = Share.next() || EMPTY_SEAT,
            a = i / 5 * Math.PI * 2 + Math.random();
          st.names.push({
            name: n,
            x: r.x,
            y: r.y,
            vx: Math.cos(a) * 34,
            vy: Math.sin(a) * 26 - 10,
            t: 0,
            life: 2.2,
            k: 1,
            col: SH.hex(r.h + 30 * i, 80, 80),
            g: 1
          });
        }
      }
    }
    st.rockets = st.rockets.filter(r => !r.done);
    for (const s of st.sparks) {
      const kk = s.hero ? 1 : k;
      s.t += dt * kk;
      s.vx *= Math.exp(-dt * kk * 1.8);
      s.vy = s.vy * Math.exp(-dt * kk * 1.8) + gy * dt * kk;
      s.x += s.vx * dt * kk;
      s.y += s.vy * dt * kk;
    }
    st.sparks = st.sparks.filter(s => s.t < s.life);
    for (const n of st.names) {
      n.t += dt * k;
      n.x += n.vx * dt * k;
      n.y += n.vy * dt * k;
      if (n.g) n.vy += 22 * dt * k;
      n.vx *= Math.exp(-dt * 0.8);
    }
    st.names = st.names.filter(n => n.t < n.life);
    // the player's own name: up with its rocket, then out of the burst - grown big, held in the light, fading
    const h = st.hero;
    if (h) {
      if (h.up) {
        if (!st.rockets.includes(h.rocket)) st.hero = null;
      } else {
        h.bt += dt;
        h.y -= 4 * dt;
        if (h.skip && h.bt > 0.6 && h.bt < 3.4) h.bt = 3.4;
        if (h.bt > 3.4) h.dim = false;
        if (h.bt > 4.2) st.hero = null;
      }
    }
  },
  // the player's own rocket: from the join button (or the town's middle) to burst high over the middle
  hero(S, h) {
    const x0 = h.from ? h.from.x : S.w / 2,
      y0 = h.from ? h.from.y - 6 : S.bot - 14,
      tx = S.w / 2,
      ty = Math.round(S.top + (S.bot - S.top) * 0.36);
    const a = 70 * 1.6,
      vy = -Math.sqrt(2 * a * Math.max(20, y0 - ty) + 900),
      T = (-vy - 30) / a;
    const r = {
      x: x0,
      y: y0,
      vx: (tx - x0) / T,
      vy,
      h: 45,
      hero: true
    };
    S.st.rockets.push(r);
    Object.assign(h, {
      up: true,
      rocket: r,
      bt: 0,
      dim: true
    });
    S.st.hero = h;
    Sound.ev && Sound.ev('entity.firework_rocket.launch', null, 1, 1);
  },
  // (over the dimmed sky: the rocket with the name riding under it; then its sparks, the name big in gold, a line under)
  drawHero(S, c, t) {
    const h = S.st.hero;
    for (const s of S.st.sparks) {
      if (!s.hero) continue;
      c.globalAlpha = Math.max(0, 1 - s.t / s.life);
      c.fillStyle = s.c;
      c.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    c.globalAlpha = 1;
    if (!h) return;
    if (h.up) {
      const r = h.rocket;
      c.fillStyle = '#FFF4D0';
      c.fillRect(Math.round(r.x), Math.round(r.y), 2, 4);
      SH.text(c, h.name, r.x + 1, r.y + 8, '#FFE94A', 1, 1, true);
      return;
    }
    const bt = h.bt,
      e = Math.min(1, bt / 0.35),
      k = 0.8 + 1.8 * (1 - Math.pow(1 - e, 3)) + (bt > 0.35 ? Math.sin(bt * 4) * 0.05 : 0);
    const a = bt > 3.6 ? Math.max(0, 1 - (bt - 3.6) / 0.6) : 1,
      w = Font.width(h.name) * k;
    const gl = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, w / 2 + 40);
    gl.addColorStop(0, 'rgba(255,214,90,' + (0.35 * a).toFixed(2) + ')');
    gl.addColorStop(1, 'rgba(255,214,90,0)');
    c.fillStyle = gl;
    c.fillRect(h.x - w / 2 - 44, h.y - w / 2 - 44, w + 88, w + 88);
    SH.text(c, h.name, h.x, h.y - 4 * k, '#FFE94A', k, a, true);
    if (bt > 0.3) SH.text(c, h.kind === 'join' ? '欢迎你成为第 ' + h.no + ' 位股东！' : '你在这里 · 第 ' + h.no + ' 位股东', h.x, h.y + 4 * k + 8, '#FFFFFF', 1, a * Math.min(1, (bt - 0.3) * 3), true);
  },
  draw(S, c, t) {
    const g = c.createLinearGradient(0, 0, 0, S.h);
    g.addColorStop(0, '#03051A');
    g.addColorStop(1, '#1C1236');
    c.fillStyle = g;
    c.fillRect(0, 0, S.w, S.h);
    for (const [x, y, s] of S.st.sky) {
      c.fillStyle = 'rgba(255,255,255,' + (0.2 + 0.5 * Math.max(0, Math.sin(t * 1.5 + s * 50))).toFixed(2) + ')';
      c.fillRect(Math.floor(x * S.w), Math.floor(y * S.h * 0.7), 1, 1);
    }
    c.fillStyle = '#F4F0DA';
    c.fillRect(S.w - 40, S.top + 4, 10, 10);
    c.fillStyle = '#E2DCC0';
    c.fillRect(S.w - 38, S.top + 6, 2, 2);
    c.fillRect(S.w - 34, S.top + 10, 2, 2);
    for (const s of S.st.sparks) {
      if (s.hero) continue;
      c.globalAlpha = Math.max(0, 1 - s.t / s.life);
      c.fillStyle = s.c;
      c.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    c.globalAlpha = 1;
    for (const r of S.st.rockets) {
      if (r.hero) continue;
      c.fillStyle = '#FFF4D0';
      c.fillRect(Math.round(r.x), Math.round(r.y), 1, 3);
    }
    for (const n of S.st.names) {
      const a = Math.min(1, n.t * 4) * Math.min(1, (n.life - n.t) * 1.5),
        mine = n.name === S.me;
      SH.text(c, n.name, n.x, n.y - 4 * n.k, mine ? '#FFD24A' : n.col, n.k + (n.k > 1 ? Math.min(0.4, n.t * 0.3) : 0), a, true);
    }
    // the town below: blocky roofs and trees in silhouette, a few lit windows
    const base = S.bot - 6;
    for (let x = 0, i = 0; x < S.w; i++) {
      const w = 10 + Math.floor(SH.hash('b' + i) * 4) * 6,
        h = 8 + Math.floor(SH.hash('h' + i) * 5) * 4,
        tree = SH.hash('t' + i) < 0.3;
      c.fillStyle = '#0A0814';
      if (tree) {
        c.fillRect(x + w / 2 - 1, base - 6, 2, 6);
        c.fillRect(x + 1, base - 14, w - 2, 9);
      } else {
        c.fillRect(x, base - h, w, h);
        c.fillRect(x + 2, base - h - 3, w - 4, 3);
        if (SH.hash('w' + i) < 0.6) {
          c.fillStyle = Math.sin(t * 0.7 + i) > -0.6 ? '#FFC860' : '#4A3A20';
          c.fillRect(x + 3, base - h + 3, 2, 2);
        }
      }
      x += w + 1;
    }
    c.fillStyle = '#0A0814';
    c.fillRect(0, base, S.w, S.h - base);
  }
}];
class ShareholdersScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, null);
    this.parent = parent;
    this.pauses = false;
    this.blurBg = false;
    this.bgDim = 0;
    this.si = Math.floor(Math.random() * SHARE_STYLES.length);
    this.t0 = performance.now();
    this.last = this.t0;
    this.slow = 0;
    this.shown = Share.count;
    this.bump = 0;
    this.plus = [];
    this.toast = [];
    this.incoming = [];
    this.heroOn = false;
    this.note = '';
    this.busy = false;
    this.st = null;
    this.style().init(this);
    Share.news.length = 0;
    this.loading = true;
    Share.load().catch(e => {
      Share.err = e.message;
    }).then(() => {
      this.loading = false;
      this.shown = Share.count;
    });
    Share.mine().then(() => this.layout());
    // (live: what came in since, every 3 s while this is open)
    this.timer = setInterval(() => {
      if (!document.hidden) Share.poll().then(() => this.took()).catch(() => {});
    }, 3000);
  }
  close() {
    clearInterval(this.timer);
  }
  style() {
    return SHARE_STYLES[this.si];
  }
  // the count went up: a little bump and +n floating up; a welcome for each newcomer
  took() {
    const d = Share.count - Math.round(this.shown);
    if (d > 0) {
      this.bump = 1;
      this.plus.push({
        n: d,
        t: performance.now()
      });
    }
    for (const nw of Share.news) {
      this.toast.push({
        ...nw,
        t: performance.now()
      });
      // (their name thrown into the flow - not the player's own: that went in from the button)
      if (nw.name !== this.me && this.incoming.length < 6) this.incoming.push(nw.name);
    }
    // (the danmaku look shows them its own way)
    if (this.style().id !== 'danmaku') Share.news.length = 0;
    if (this.toast.length > 3) this.toast.splice(0, this.toast.length - 3);
  }
  get me() {
    return Share.me && Share.me.in ? Share.me.name : null;
  }
  layout() {
    const u = this.game.ui,
      W = Math.min(u.w - 12, 360),
      x0 = Math.floor(u.w / 2 - W / 2),
      bw = Math.floor((W - 8) / 3),
      y = u.h - 24,
      inn = !!(Share.me && Share.me.in);
    this.widgets = [{
      x: x0,
      y,
      w: bw,
      h: 20,
      label: '返回',
      onClick: () => this.back()
    }, {
      x: x0 + bw + 4,
      y,
      w: bw,
      h: 20,
      gold: !inn,
      enabled: !this.busy,
      label: () => this.busy ? '…' : inn ? '第 ' + Share.me.no + ' 位股东' : '加入股东名单',
      tip: inn ? ['你已经在股东名单里了', '再点一下可以退出'] : ['用你的 B站 昵称加入股东名单'],
      onClick: () => inn ? this.askLeave() : this.join()
    }, {
      x: x0 + 2 * (bw + 4),
      y,
      w: bw,
      h: 20,
      glowBlue: inn,
      enabled: !this.heroOn,
      label: '找到我',
      tip: ['在名单里找到你自己'],
      onClick: () => this.findMe()
    }];
  }
  back() {
    this.game.ui.open(this.parent || new TitleScreen(this.game));
  }
  onEsc() {
    if (this.st && this.st.hero) {
      this.st.hero.skip = true;
      return;
    }
    this.back();
  }
  async join() {
    const g = this.game;
    if (!Account.loggedIn) {
      g.ui.open(new LoginScreen(g, () => {
        g.ui.open(this);
        this.join();
      }, () => g.ui.open(this)));
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.layout();
    try {
      await Share.join();
      Sound.ev && Sound.ev('entity.player.levelup', null, 0.8, 1);
      if (typeof Telemetry !== 'undefined' && Telemetry.count) Telemetry.count('share_join');
      this.busy = false;
      this.layout();
      this.launch('join');
    } catch (e) {
      this.busy = false;
      this.say(e.message);
      this.layout();
    }
  }
  askLeave() {
    const g = this.game;
    g.ui.open(new ConfirmScreen(g, '要退出股东名单吗？', '你的名字会从名单里拿掉（以后还可以重新加入）', '退出', async yes => {
      g.ui.open(this);
      if (!yes) return;
      try {
        await Share.leave();
        this.say('已经退出股东名单');
      } catch (e) {
        this.say(e.message);
      }
      this.layout();
    }));
  }
  say(t) {
    this.note = t;
    this.noteT = performance.now();
  }
  // 找到我: the player's own name into the flow, standing out of it (the look's own way: a danmaku stopping in the
  // middle, a rocket bursting into it)
  findMe() {
    if (!this.me) {
      this.say(Account.loggedIn ? '先点「加入股东名单」，再来找自己' : '先登录，再加入股东名单');
      return;
    }
    this.launch('find');
  }
  // (kind: 'find', or 'join' - thrown in from the join button)
  launch(kind) {
    if (!this.me || this.st && this.st.hero) return;
    const b = this.widgets && this.widgets[1],
      from = kind === 'join' && b ? {
        x: b.x + b.w / 2,
        y: b.y
      } : null;
    try {
      this.style().hero(this, {
        name: this.me,
        no: Share.me.no,
        kind,
        from
      });
    } catch (e) {}
    this.heroOn = true;
    this.layout();
  }
  mouseDown(ui, mx, my, b) {
    // (a tap away from the buttons while it is held: on with the flow)
    if (this.st && this.st.hero && b === 0 && !this.widgets.some(w => ui.hit(w, mx, my))) {
      this.st.hero.skip = true;
      return;
    }
    super.mouseDown(ui, mx, my, b);
  }
  draw(ui) {
    const c = ui.ctx,
      now = performance.now(),
      dt = Math.min(0.05, (now - this.last) / 1000),
      t = (now - this.t0) / 1000;
    this.last = now;
    const S = this;
    S.w = ui.w;
    S.h = ui.h;
    S.top = 40;
    S.bot = ui.h - 30;
    // (the player's own name standing out: the rest dimmed and slowed while it is held)
    const H = this.st && this.st.hero;
    if (!!H !== this.heroOn) {
      this.heroOn = !!H;
      this.layout();
    }
    this.slow += ((H && H.dim ? 1 : 0) - this.slow) * Math.min(1, dt * 4);
    const st = this.style();
    try {
      st.step(S, dt, t);
    } catch (e) {
      if (this.st) this.st.hero = null;
    }
    c.save();
    try {
      st.draw(S, c, t, ui);
    } catch (e) {}
    c.restore();
    if (this.slow > 0.02) {
      c.fillStyle = 'rgba(0,0,0,' + (0.62 * this.slow).toFixed(3) + ')';
      c.fillRect(0, 0, ui.w, ui.h);
    }
    c.save();
    try {
      st.drawHero(S, c, t);
    } catch (e) {}
    c.restore();
    this.drawHead(ui, t, dt);
    // the bar under the buttons: a dark strip for them to sit on
    const g = c.createLinearGradient(0, ui.h - 34, 0, ui.h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = g;
    c.fillRect(0, ui.h - 34, ui.w, 34);
    if (this.note && now - this.noteT < 4000) SH.text(c, fitText(this.note, ui.w - 16), ui.w / 2, ui.h - 36, '#FFD24A', 1, Math.min(1, (4000 - (now - this.noteT)) / 500), true);
    if (this.loading) SH.text(c, '正在读取股东名单…', ui.w / 2, ui.h / 2, '#E0E0E0', 1, 1, true);else if (Share.err && !Share.ok) SH.text(c, fitText(Share.err, ui.w - 16), ui.w / 2, ui.h / 2, '#FF7070', 1, 1, true);
    for (const w of this.widgets) ui.button(w);
    for (const w of this.widgets) if (w.tip && ui.hit(w)) ui.tooltip(w.tip.map(x => ({
      text: x
    })), ui.mouse.x, ui.mouse.y);
  }
  // the heading: 股东名单 in gold with a light sweeping across it, the count rolling up to the real one (a bump and a
  // +n when it grows), a red dot for live; the newcomers' welcome on the right
  drawHead(ui, t, dt) {
    const c = ui.ctx,
      cx = ui.w / 2,
      now = performance.now();
    const g = c.createLinearGradient(0, 0, 0, 44);
    g.addColorStop(0, 'rgba(0,0,0,0.65)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, ui.w, 44);
    const title = '股东名单',
      tw = Font.width(title) * 2,
      tx = Math.round(cx - tw / 2);
    SH.text(c, title, tx, 4, '#F2C94C', 2);
    const sw = (t * 0.5 % 1.6 - 0.3) * (tw + 40) - 20;
    c.save();
    c.beginPath();
    c.rect(tx + sw, 0, 10, 24);
    c.clip();
    SH.text(c, title, tx, 4, '#FFF8D8', 2, 1, false, false);
    c.restore();
    this.shown += (Share.count - this.shown) * Math.min(1, dt * 3);
    if (Math.abs(Share.count - this.shown) < 0.5) this.shown = Share.count;
    this.bump = Math.max(0, this.bump - dt * 2.5);
    const num = Math.round(this.shown).toLocaleString('en-US'),
      line = '感谢 ' + num + ' 位股东',
      lw = Font.width(line),
      k = 1 + this.bump * 0.25;
    SH.text(c, line, cx, 25 - (k - 1) * 4, this.bump > 0 ? '#FFFFFF' : '#E8E8E8', k, 1, true);
    // (live: a red dot breathing)
    const dx = Math.round(cx + lw * k / 2 + 6),
      a = 0.5 + 0.5 * Math.sin(now / 300);
    c.fillStyle = 'rgba(255,60,60,' + (0.5 + 0.5 * a).toFixed(2) + ')';
    c.fillRect(dx, 27, 4, 4);
    SH.text(c, '实时', dx + 7, 25, '#FF8080', 1, 0.9);
    for (const p of this.plus) {
      const s = (now - p.t) / 1000;
      SH.text(c, '+' + p.n, cx + lw / 2 + 36, 22 - s * 14, '#7CFF7C', 1, 1 - s / 1.4, true);
    }
    this.plus = this.plus.filter(p => now - p.t < 1400);
    let y = 44;
    for (const x of this.toast) {
      const s = (now - x.t) / 1000;
      if (s > 4) continue;
      const text = fitText('欢迎 ' + x.name + ' 成为第 ' + x.no + ' 位股东！', ui.w * 0.6),
        w = Font.width(text) + 10,
        ox = s < 0.3 ? (1 - s / 0.3) * (w + 8) : s > 3.6 ? (s - 3.6) / 0.4 * (w + 8) : 0;
      if (this.style().id === 'danmaku') continue;
      c.fillStyle = 'rgba(40,24,0,0.75)';
      c.fillRect(ui.w - w - 6 + ox, y, w, 12);
      c.fillStyle = '#F2C94C';
      c.fillRect(ui.w - w - 6 + ox, y, 2, 12);
      SH.text(c, text, ui.w - w - 1 + ox, y + 2, '#FFE9A0');
      y += 14;
    }
    this.toast = this.toast.filter(x => now - x.t < 4000);
  }
}

// the way in: follow the UP first (in Bilibili - elsewhere it can't be seen, so not asked), as the single-player
// game's own gate does
async function openShareholders(g, parent) {
  // (a super administrator - the UP, who can't follow themselves - and an account the service already knows follows:
  // straight in, as the single-player gate does; the UP was kept out by Bilibili's "not following" - the user 11-13)
  if (typeof Account !== 'undefined' && Account.loggedIn && Account.data && (Account.data.super || Account.unlocks && Account.unlocks.follow)) {
    g.ui.open(new ShareholdersScreen(g, parent));
    return;
  }
  let f = null,
    err = null;
  if (typeof Toy !== 'undefined' && Toy.following) {
    try {
      f = await Toy.following();
    } catch (e) {
      err = e;
    }
  }
  if (f === false && !err && typeof FollowGateScreen !== 'undefined') {
    g.ui.open(new FollowGateScreen(g, parent, () => g.ui.open(new ShareholdersScreen(g, parent)), '关注 UP 主「土豆味小哲」后就能进入股东名单'));
    return;
  }
  g.ui.open(new ShareholdersScreen(g, parent));
}

// the title screen: a gold 股东名单 button under the news sign's (and the sign-in's) - only with a room service
(() => {
  const tl = TitleScreen.prototype.layout;
  TitleScreen.prototype.layout = function () {
    tl.call(this);
    const g = this.game,
      u = g.ui;
    if (typeof RoomService === 'undefined' || !RoomService.base() || typeof Checkin === 'undefined' || !(typeof Live === 'undefined' || Live.on('title.shareholders'))) return;
    const r = Checkin.titleRect(u),
      ck = this.widgets.find(w => w.checkin);
    this.widgets.push({
      x: r.x,
      y: ck ? ck.y + ck.h + 4 : r.y,
      w: r.w,
      h: 16,
      label: '股东名单',
      gold: true,
      tip: ['关注 UP 主后，把你的名字加进股东名单'],
      onClick: () => openShareholders(g, this)
    });
  };
})();
