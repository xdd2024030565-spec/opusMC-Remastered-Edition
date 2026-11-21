'use strict';

// 连锁挖矿 (vein mining; our own, no one else's code or art): a switch - the 连锁挖矿 key (` by default, set in 按键设置)
// or a phone's 连 button turns it on and off (the user 11-13: it was held, and on phones it did nothing for players), kept
// in the settings; while it is on, breaking a block takes the blocks joined to it (the 26 around, on and on) that are its
// kind, up to 64:
//   - ores: the same ore, its deepslate form too (iron ore and deepslate iron ore together)
//   - trees: the logs and wood of the same tree (oak log and oak wood together; the leaves fall by themselves)
//   - crops: a ripe crop takes the ripe ones of its kind around it, and each is planted again with a seed of what it
//     gave (wheat, carrots, potatoes, beetroots, nether wart, cocoa, torchflowers); melons and pumpkins their own kind
//   - nothing else (the user 11-13: stone, dirt, sand ... a whole hillside at a time was too much - balance)
// Each block is broken as by hand: the tool needed to drop it, a point of the tool's wear each, hunger; it stops
// before the tool would break. What they drop lands where the first one was. The blocks it would take are outlined
// while it is on. Single player only, as every mod.
(function () {
  const MAX = 64;
  // ---- the switch: the key or the 连 button, on and off (settings.veinOn, saved with the settings - the touch
  // controls' own state was cleared whenever the page lost the focus) ----
  if (typeof KEYBIND_CATS !== 'undefined' && !KEY_DEFAULT.veinmine) {
    KEYBIND_CATS.push(['连锁挖矿', [['veinmine', '连锁挖矿（开 / 关）', 'Backquote']]]);
    KEY_DEFAULT.veinmine = 'Backquote';
    KEY_CN.veinmine = '连锁挖矿（开 / 关）';
  }
  const isOn = g => !!(g && g.settings && g.settings.veinOn);
  const active = g => !g.net && g.player && isOn(g);
  const toggle = g => {
    g.settings.veinOn = !isOn(g);
    if (g.saveSettings) g.saveSettings();
    if (g.ui && g.ui.message) g.ui.message(g.settings.veinOn ? '连锁挖矿：开（再按一次关闭）' : '连锁挖矿：关', g.settings.veinOn ? '#55FF55' : '#AAAAAA');
  };
  // (the key or mouse button bound to it, pressed while playing - not held down again by the key's repeat)
  const pressed = code => {
    const g = typeof game !== 'undefined' ? game : null;
    if (!g || g.state !== 'play' || g.ui.screen || g.net || !g.player) return;
    const k = g.settings.keys && g.settings.keys.veinmine,
      bound = k !== undefined ? k : KEY_DEFAULT.veinmine;
    if (bound && bound === code) toggle(g);
  };
  window.addEventListener('keydown', e => {
    if (!e.repeat) pressed(e.code);
  });
  window.addEventListener('mousedown', e => pressed('Mouse' + e.button));

  // ---- what goes together ----
  const keyOf = id => BLOCKS[id] ? BLOCKS[id].key : '';
  const prop = (id, m, k) => typeof Features !== 'undefined' ? Features.propOf(id, m, k) : undefined;
  const CROP_SEED = {
    wheat: 'wheat_seeds',
    carrots: 'carrot',
    potatoes: 'potato',
    beetroots: 'beetroot_seeds',
    nether_wart: 'nether_wart',
    cocoa: 'cocoa_beans',
    torchflower_crop: 'torchflower_seeds'
  };
  const maxAge = new Map();
  const ageMax = id => {
    if (!maxAge.has(id)) {
      const b = BLOCKS[id];
      maxAge.set(id, b && b.states ? Math.max(...b.states.map(s => +s.age || 0)) : 0);
    }
    return maxAge.get(id);
  };
  // (wheat - the old block 64 - keeps its age in its meta, 0-7; the others in their states)
  const WHEAT = 64;
  const ripe = (id, m) => !!CROP_SEED[keyOf(id)] && (id === WHEAT ? m >= 7 : ageMax(id) > 0 && +(prop(id, m, 'age') || 0) >= ageMax(id));
  const youngMeta = (id, m) => id === WHEAT ? 0 : typeof Features !== 'undefined' ? Features.withProp(id, m, 'age', '0') : 0;
  const isOre = k => /_ore$/.test(k) || k === 'ancient_debris';
  const isLog = k => /_(log|wood|stem|hyphae)$/.test(k) && !/^(mushroom_stem)$/.test(k);
  const FRUIT = new Set(['melon', 'pumpkin']);
  // (a group name: blocks with the same one go together)
  function group(id, m) {
    const k = keyOf(id);
    if (CROP_SEED[k]) return ripe(id, m) ? 'crop:' + k : null;
    if (isOre(k)) return 'ore:' + k.replace(/^deepslate_/, '');
    if (isLog(k)) return 'log:' + k.replace(/_(log|wood|stem|hyphae)$/, '');
    if (FRUIT.has(k)) return 'crop:' + k;
    return null; // (any other block: broken alone, as without the key)
  }
  // (not these: unbreakable, fluids, block entities - a chest's contents -, doors and beds, air)
  const can = id => {
    const b = BLOCKS[id];
    return !!(id && b && !IS_FLUID[id] && b.hardness >= 0 && !b.be && !b.door && !b.bed && !b.chestLike);
  };
  // the blocks a break here would take (the first is this one), by distance
  function vein(w, x, y, z) {
    const id0 = w.getBlock(x, y, z);
    if (!can(id0)) return [];
    const g0 = group(id0, w.getMeta(x, y, z));
    if (!g0) return [];
    const out = [[x, y, z]],
      seen = new Set([x + ',' + y + ',' + z]);
    for (let i = 0; i < out.length && out.length < MAX; i++) {
      const [cx, cy, cz] = out[i];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (out.length >= MAX) break;
        const nx = cx + dx,
          ny = cy + dy,
          nz = cz + dz,
          k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = w.getBlock(nx, ny, nz);
        if (can(id) && group(id, w.getMeta(nx, ny, nz)) === g0) out.push([nx, ny, nz]);
      }
    }
    return out;
  }
  // (how much wear the held tool has left - a Tinkers' tool by its own stats)
  function wearLeft(st) {
    if (!st) return Infinity;
    const d = ITEMS[st.id];
    if (!d) return Infinity;
    if (d.tcTool && self.tcStats) {
      if (self.tcBroken && self.tcBroken(st)) return 0;
      const dur = self.tcStats(st).durability;
      return dur ? dur - (st.dmg || 0) : Infinity;
    }
    return d.durability ? d.durability - (st.dmg || 0) : Infinity;
  }

  // ---- breaking ----
  const bb = Game.prototype.breakBlock;
  Game.prototype.breakBlock = function (x, y, z, natural, silent) {
    if (natural || this.veining || !active(this)) return bb.call(this, x, y, z, natural, silent);
    const w = this.world,
      list = vein(w, x, y, z);
    if (list.length < 2) return bb.call(this, x, y, z, natural, silent);
    const p = this.player,
      held0 = p.inv.held,
      heldId = held0 ? held0.id : null,
      crops = [];
    // (their drops and experience gathered, put down where the first one was at the end)
    const drops = [],
      di = this.dropItem,
      dx = this.dropXp;
    let xp = 0;
    this.dropItem = (px, py, pz, st) => {
      if (st) drops.push(st);
    };
    this.dropXp = (px, py, pz, n) => {
      xp += n;
    };
    this.veining = true;
    try {
      list.forEach(([bx, by, bz], i) => {
        const h = p.inv.held;
        if (i > 0) {
          // (stop: the tool gone or changed, about to break; hungry in survival)
          if (heldId !== null && (!h || h.id !== heldId) || wearLeft(h) <= 1) throw 'stop';
          if (this.mode !== 'creative' && p.food <= 0) throw 'stop';
        }
        const id = w.getBlock(bx, by, bz),
          m = w.getMeta(bx, by, bz);
        if (i > 0 && !can(id)) return;
        if (CROP_SEED[keyOf(id)]) crops.push([bx, by, bz, id, m]);
        bb.call(this, bx, by, bz, false, i > 0);
      });
    } catch (e) {
      if (e !== 'stop') throw e;
    } finally {
      this.veining = false;
      this.dropItem = di;
      this.dropXp = dx;
    }
    // crops planted again, a seed each from what they gave
    for (const [bx, by, bz, id, m] of crops) {
      if (w.getBlock(bx, by, bz)) continue;
      const seed = ITEM_KEY[CROP_SEED[keyOf(id)]],
        st = drops.find(s => s && s.id === seed && s.count > 0);
      if (!st && this.mode !== 'creative') continue;
      const m0 = youngMeta(id, m);
      if (this.supported && !this.supported(bx, by, bz, id, m0)) continue;
      w.setBlock(bx, by, bz, id, m0);
      if (st) st.count--;
    }
    const [ox, oy, oz] = list[0];
    // (alike stacks together, full stacks at most)
    const merged = [];
    for (const st of drops) {
      if (!st || st.count <= 0) continue;
      const ms = typeof maxStack === 'function' ? maxStack(st.id) : 64;
      const same = merged.find(o => o.count < ms && (typeof sameKind === 'function' ? sameKind(o, st) : o.id === st.id));
      if (same) {
        const k = Math.min(st.count, ms - same.count);
        same.count += k;
        if (st.count - k > 0) merged.push({
          ...st,
          count: st.count - k
        });
      } else merged.push({
        ...st
      });
    }
    for (const st of merged) di.call(this, ox + 0.5, oy + 0.5, oz + 0.5, st);
    if (xp > 0) dx.call(this, ox + 0.5, oy + 0.5, oz + 0.5, xp);
    this.flushMesh && this.flushMesh();
  };

  // ---- the outline of what it would take, while it is on ----
  let shown = null;
  const ds = Game.prototype.drawSelection;
  Game.prototype.drawSelection = function (env) {
    ds.call(this, env);
    const t = this.target;
    if (!t || !active(this) || this.ui.hideHud || this.perspective === 2) {
      shown = null;
      return;
    }
    const key = t.pos.join(',') + '|' + t.id + '|' + (this.tickCount / 10 | 0);
    if (!shown || shown.key !== key) shown = {
      key,
      list: vein(this.world, ...t.pos)
    };
    if (shown.list.length < 2) return;
    const v = [],
      e = 0.004;
    for (const [x, y, z] of shown.list) {
      const x0 = x - e,
        y0 = y - e,
        z0 = z - e,
        x1 = x + 1 + e,
        y1 = y + 1 + e,
        z1 = z + 1 + e;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      const L = (a, b) => v.push(a[0], a[1], a[2], 0, 0, 0, 1, b[0], b[1], b[2], 0, 0, 0, 1);
      for (let i = 0; i < 4; i++) {
        L(c[i], c[(i + 1) % 4]);
        L(c[i + 4], c[(i + 1) % 4 + 4]);
        L(c[i], c[i + 4]);
      }
    }
    this.renderer.gl.enable(this.renderer.gl.DEPTH_TEST);
    this.renderer.drawLines(v, [1, 1, 1, 0.6]);
  };
  // (how many, by the crosshair)
  if (typeof UI !== 'undefined' && UI.prototype.drawHUD) {
    const dh = UI.prototype.drawHUD;
    UI.prototype.drawHUD = function (...a) {
      const r = dh.apply(this, a),
        g = this.game;
      if (g && g.state === 'play' && !this.screen && shown && shown.list.length > 1 && active(g)) Font.center(this.ctx, '连锁挖矿：' + shown.list.length + ' 个', this.w / 2, this.h / 2 + 10, '#FFFFFF');
      return r;
    };
  }

  // ---- on a phone: a 连 button (on / off), above the attack button (put in once every script has loaded: the
  // phone controls' own layout - mobile.js - comes after this file) ----
  const touchSetup = () => {
    if (typeof TouchControls !== 'undefined') {
      const P = TouchControls.prototype;
      const lay = P.layout;
      P.layout = function () {
        const L = lay.call(this),
          g = this.g;
        if (L.attack && g.mode !== 'spectator') {
          const B = L.attack.w,
            gp = 2,
            off = (g.settings.touchLayout || {}).vein,
            sc = (g.settings.touchScale || {}).vein || 1;
          const w = Math.round(B * sc);
          L.vein = {
            x: L.attack.x,
            y: L.attack.y - w - gp - 2,
            w,
            h: w
          };
          if (off) {
            L.vein.x = clamp(L.vein.x + off[0], 0, (L.W || 9999) - w);
            L.vein.y = clamp(L.vein.y + off[1], 0, (L.H || 9999) - w);
          }
        }
        return L;
      };
      const st = P.startPlay;
      P.startPlay = function (s) {
        const L = this.layout(),
          th = this.g.touchHeld;
        if (L.vein && this.hitL(L.vein, s.x, s.y)) {
          s.kind = 'none';
          if (!this.g.net) toggle(this.g);
          return;
        }
        return st.call(this, s);
      };
      const dr = P.draw;
      P.draw = function (ui) {
        var _g$settings$touchOpac;
        dr.call(this, ui);
        const L = this.L,
          g = this.g;
        if (!L || !L.vein || ui.screen) return;
        const c = ui.ctx;
        c.save();
        c.globalAlpha = (_g$settings$touchOpac = g.settings.touchOpacity) !== null && _g$settings$touchOpac !== void 0 ? _g$settings$touchOpac : 0.7;
        this.btn(c, L.vein, null, isOn(g), '连');
        c.restore();
      };
    }
    if (typeof TouchLayoutScreen !== 'undefined') {
      const ids = TouchLayoutScreen.prototype.ids;
      TouchLayoutScreen.prototype.ids = function () {
        return [...ids.call(this), 'vein'];
      };
    }
  };
  if (document.readyState === 'complete') touchSetup();else window.addEventListener('load', touchSetup);
})();
