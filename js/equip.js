
'use strict';

// ---------------------------------------------------------------------------
// Equipment in single player: the offhand slot (inventory slot 40, swapped with F), the shield, crossbow, trident,
// mace and spears, the elytra (with firework boosts) and the totem of undying; how they look in the hands.
// Hand transforms are vanilla's item model display transforms (models.js / the jar's item models).
// ---------------------------------------------------------------------------
const OFF = 40;
const keyOfStack = s => s && ITEMS[s.id] ? ITEMS[s.id].key : null;
const isSpear = k => !!k && /_spear$/.test(k);
const AMMO = new Set(['arrow', 'tipped_arrow', 'spectral_arrow']);
const glintOf = st => typeof stackGlint === 'function' && stackGlint(st); // (enchanted: the glint in the hand, render.js)

// ---- models: the shield and trident (vanilla ShieldModel / TridentModel, turned y-up) ----
Renderer.prototype.initEquipModels = function () {
  if (this.models.eq_shield) return;
  const M = this.models,
    P = (tw, th, boxes) => ({
      parts: [{
        name: 'p',
        pivot: [0, 0, 0],
        boxes,
        mesh: this.makeModelPart(boxes, tw, th)
      }]
    });
  M.eq_shield = P(64, 64, [[0, 0, -6, -11, -2, 12, 22, 1], [26, 0, -1, -3, -1, 2, 6, 6]]);
  // the elytra's wings (vanilla ElytraModel: x and y turned for this game's y-up models), on the back
  M.eq_elytra = {
    parts: [{
      name: 'lw',
      pivot: [-5, 24, 2],
      boxes: [[22, 0, 0, -20, 0, 10, 20, 2, 1]]
    }, {
      name: 'rw',
      pivot: [5, 24, 2],
      boxes: [[22, 0, -10, -20, 0, 10, 20, 2, 1, true]]
    }]
  };
  this.packParts(M.eq_elytra.parts, 64, 32); // (both wings in one VAO: render.js packParts)
  M.eq_trident = P(32, 32, [[0, 6, -0.5, -27, -0.5, 1, 25, 1], [4, 0, -1.5, -2, -0.5, 3, 2, 1], [4, 3, -2.5, -1, -0.5, 1, 4, 1], [0, 0, -0.5, 0, -0.5, 1, 4, 1], [4, 3, 1.5, -1, -0.5, 1, 4, 1, 0, true]]);
};
// the item model display transforms the game's models don't carry (the "using" variants), and the special ones
const DISPLAY = {
  shield: {
    firstperson_righthand: {
      r: [0, 180, 5],
      t: [-10, 1.75, -10],
      s: [1.25, 1.25, 1.25]
    },
    firstperson_lefthand: {
      r: [0, 180, 5],
      t: [10, 0, -10],
      s: [1.25, 1.25, 1.25]
    },
    thirdperson_righthand: {
      r: [0, 90, 0],
      t: [10, 6, -4],
      s: [1, 1, 1]
    },
    thirdperson_lefthand: {
      r: [0, 90, 0],
      t: [10, 6, 12],
      s: [1, 1, 1]
    }
  },
  shield_blocking: {
    firstperson_righthand: {
      r: [0, 180, -5],
      t: [-15, 3.25, -11],
      s: [1.25, 1.25, 1.25]
    },
    firstperson_lefthand: {
      r: [0, 180, -5],
      t: [5, 5, -11],
      s: [1.25, 1.25, 1.25]
    },
    thirdperson_righthand: {
      r: [45, 155, 0],
      t: [-3.49, 11, -2],
      s: [1, 1, 1]
    },
    thirdperson_lefthand: {
      r: [45, 155, 0],
      t: [11.51, 7, 2.5],
      s: [1, 1, 1]
    }
  },
  trident: {
    firstperson_righthand: {
      r: [0, -90, 25],
      t: [-3, 17, 1],
      s: [1, 1, 1]
    },
    firstperson_lefthand: {
      r: [0, 90, -25],
      t: [13, 17, 1],
      s: [1, 1, 1]
    },
    thirdperson_righthand: {
      r: [0, 60, 0],
      t: [11, 17, -2],
      s: [1, 1, 1]
    },
    thirdperson_lefthand: {
      r: [0, 60, 0],
      t: [3, 17, 12],
      s: [1, 1, 1]
    }
  },
  trident_throwing: {
    thirdperson_righthand: {
      r: [0, 90, 180],
      t: [8, -17, 9],
      s: [1, 1, 1]
    },
    thirdperson_lefthand: {
      r: [0, 90, 180],
      t: [8, -17, -7],
      s: [1, 1, 1]
    }
  }
};
// vanilla ItemTransform.apply: translate, rotate X then Y then Z, scale; the left hand mirrored
function applyDisplay(m, d, left) {
  if (!d) return;
  const D = Math.PI / 180,
    s = left ? -1 : 1,
    t = d.t || [0, 0, 0],
    r = d.r || [0, 0, 0],
    sc = d.s || [1, 1, 1];
  M4.translate(m, s * t[0] / 16, t[1] / 16, t[2] / 16);
  M4.rotX(m, r[0] * D);
  M4.rotY(m, s * r[1] * D);
  M4.rotZ(m, s * r[2] * D);
  M4.scale(m, sc[0], sc[1], sc[2]);
}
// the shield's inventory icon: its model at the item model's gui angle (vanilla item/shield display)
Renderer.prototype.shieldIcon = function (d, env, vp, tex) {
  this.initEquipModels();
  d = d || {
    r: [15, -25, -5],
    t: [2, 3, 0],
    s: [0.65, 0.65, 0.65]
  };
  const m = M4.create();
  applyDisplay(m, d, false);
  M4.translate(m, -0.5, -0.5, -0.5);
  M4.scale(m, 1, 1, -1);
  this.drawModel('eq_shield', tex || this.beTex('shield_base'), m, null, [1, 0], {
    ...env,
    ambient: [0.3, 0.3, 0.3]
  }, {
    vp
  });
};
// a shield with a banner on it: its own icon (the atlas has the plain one), drawn like buildIcons' once per pattern
// texture and kept; null for a plain shield or while the pattern texture loads
Renderer.prototype.shieldStackIcon = function (st) {
  const tex = typeof shieldTex === 'function' && st && (st.base || st.patterns && st.patterns.length) ? shieldTex(this, st) : null;
  if (!tex || tex === 'shield_base' || !this.iconSize) return null;
  const cache = this._shieldIcons || (this._shieldIcons = new Map());
  if (cache.has(tex)) return cache.get(tex);
  const gl = this.gl,
    S = this.iconSize;
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING),
    view = gl.getParameter(gl.VIEWPORT),
    cc = gl.getParameter(gl.COLOR_CLEAR_VALUE);
  const sc = gl.isEnabled(gl.SCISSOR_TEST),
    dt = gl.isEnabled(gl.DEPTH_TEST),
    cu = gl.isEnabled(gl.CULL_FACE),
    bl = gl.isEnabled(gl.BLEND);
  const fb = gl.createFramebuffer(),
    t = gl.createTexture(),
    rb = gl.createRenderbuffer();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  this.texEp = -1; // (a texture bound on the active unit: the frame's go again, like tex2D)
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, S, S);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  gl.viewport(0, 0, S, S);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  const vp = M4.create();
  M4.ortho(vp, -0.5, 0.5, -0.5, 0.5, -10, 10);
  const savedVP = this.vp,
    savedCam = this.camPos,
    savedFx = this.fxOn;
  this.vp = vp;
  this.camPos = [0, 0, 0];
  this.fxOn = false;
  const px = new Uint8Array(S * S * 4);
  try {
    const info = typeof VM !== 'undefined' && VM.ready && VM.data.items.shield,
      model = info && info.m !== undefined ? VM.data.models[info.m] : null;
    this.shieldIcon(model && model.display && model.display.gui, {
      tick: 0,
      day: 1,
      fogColor: [0, 0, 0],
      fogNear: 1e8,
      fogFar: 2e8,
      nightTint: [1, 1, 1]
    }, vp, tex);
    gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
  } catch (e) {
    cache.set(tex, null);
    return null;
  } finally {
    this.vp = savedVP;
    this.camPos = savedCam;
    this.fxOn = savedFx;
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(view[0], view[1], view[2], view[3]);
    gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
    if (sc) gl.enable(gl.SCISSOR_TEST);
    if (!dt) gl.disable(gl.DEPTH_TEST);
    if (cu) gl.enable(gl.CULL_FACE);
    if (bl) gl.enable(gl.BLEND);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(t);
    gl.deleteRenderbuffer(rb);
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d'),
    img = x.createImageData(S, S);
  for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4); // (GL's rows from the bottom)
  x.putImageData(img, 0, 0);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(tex, cv);
  return cv;
};
// the shield on the ground (ctx 'ground': m at the item's feet) and in item frames ('fixed'): its model with the item
// model's own transform - the item model has no shape of its own, only a planks texture, and a plank showed
Game.prototype.drawShieldItem = function (st, m, l, env, ctx) {
  const r = this.renderer,
    vim = r.itemModel(st.id),
    d = vim && vim.model && vim.model.display && vim.model.display[ctx];
  r.initEquipModels();
  const mm = r.mat(m);
  // (vanilla rests an item's lowest point on the ground: the shield's, through its ground transform, is 0.047 below)
  if (ctx === 'ground') M4.translate(mm, 0, 0.046875, 0);
  applyDisplay(mm, d || {
    r: [0, 0, 0],
    t: [0, 0, 0],
    s: [0.25, 0.25, 0.25]
  }, false);
  M4.translate(mm, -0.5, -0.5, -0.5);
  M4.scale(mm, 1, 1, -1);
  const gl = r.gl,
    cull = gl.isEnabled(gl.CULL_FACE);
  gl.disable(gl.CULL_FACE);
  r.drawModel('eq_shield', typeof shieldTex === 'function' ? shieldTex(r, st) : r.beTex('shield_base'), mm, null, l, env, {
    glint: glintOf(st) && 'entity'
  });
  if (cull) gl.enable(gl.CULL_FACE);
};
// ---- armour trims, worn (vanilla EquipmentLayerRenderer.renderTrim): the pattern's grey texture for the layer
// (humanoid / humanoid_leggings) recoloured from trim_palette's keys to the material's palette (PalettedPermutations),
// the material's darker palette on armour of its own material; null until the images have loaded ----
const TRIM_DARKER = new Set(['iron', 'gold', 'diamond', 'netherite', 'copper']);
Renderer.prototype.trimTex = function (trim, armorMat, legs) {
  if (!trim || !trim.pattern || !trim.material) return null;
  const asset = armorMat === 'golden' ? 'gold' : armorMat === 'chain' ? 'chainmail' : armorMat;
  const pal = trim.material + (asset === trim.material && TRIM_DARKER.has(trim.material) ? '_darker' : '');
  const pat = 'trims/entity/' + (legs ? 'humanoid_leggings/' : 'humanoid/') + trim.pattern,
    key = '@trim:' + pat + ':' + pal;
  if (this.entityTex[key]) return key;
  if (this._trimFail && this._trimFail.has(key)) return null;
  const paths = [pat, 'trims/color_palettes/trim_palette', 'trims/color_palettes/' + pal];
  if (paths.some(p => !(window.ETEX && ETEX[p]))) {
    (this._trimFail || (this._trimFail = new Set())).add(key);
    return null;
  } // (a trim this game has no texture for)
  const ims = paths.map(p => {
    this.etex(p);
    return this.images['@' + p];
  });
  if (ims.some(i => !i)) return null;
  const px = im => {
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    return [c, x, x.getImageData(0, 0, im.width, im.height)];
  };
  const [c, x, d] = px(ims[0]),
    keys = px(ims[1])[2].data,
    vals = px(ims[2])[2].data,
    map = new Map();
  for (let i = 0; i + 3 < keys.length && i + 3 < vals.length; i += 4) map.set(keys[i] << 16 | keys[i + 1] << 8 | keys[i + 2], i);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    let j = map.get(p[i] << 16 | p[i + 1] << 8 | p[i + 2]);
    // (a key a few levels off - a browser's colour handling of the PNG: the nearest one)
    if (j === undefined) {
      let best = 300;
      for (let q = 0; q + 3 < keys.length; q += 4) {
        const e = (keys[q] - p[i]) ** 2 + (keys[q + 1] - p[i + 1]) ** 2 + (keys[q + 2] - p[i + 2]) ** 2;
        if (e < best) {
          best = e;
          j = q;
        }
      }
    }
    if (j === undefined || j + 3 >= vals.length) continue;
    p[i] = vals[j];
    p[i + 1] = vals[j + 1];
    p[i + 2] = vals[j + 2];
    p[i + 3] = Math.round(p[i + 3] * vals[j + 3] / 255);
  }
  x.putImageData(d, 0, 0);
  this.entityTex[key] = this.tex2D(c, false);
  return key;
};
// a 16x16 picture of one texture of the strip (for icons that change: crossbow, compass, clock)
Renderer.prototype.tileIcon = function (tex) {
  const cache = this._tileIcons || (this._tileIcons = new Map());
  let cv = cache.get(tex);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    cv.getContext('2d').drawImage(this.stripCanvas, ...this.tileXY(T(tex)), 16, 16, 0, 0, 16, 16);
    cache.set(tex, cv);
  }
  return cv;
};

// the flat texture an item shows now (crossbow loading / loaded, broken elytra ...), or null for its usual one
function itemStateTex(st, p) {
  // (a mod's tool borrowing the crossbow's key - 匠魂's - draws its own loading frames)
  if (st && ITEMS[st.id] && ITEMS[st.id].tcTool) return null;
  const k = keyOfStack(st);
  if (k === 'crossbow') {
    if (st.charged && st.charged.length) return keyOfStack(st.charged[0]) === 'firework_rocket' ? 'i_crossbow_firework' : 'i_crossbow_arrow';
    if (p && p.usingItem === st.id && (p.useHand === 'off' ? p.inv.slots[OFF] : p.inv.held) === st) {
      const f = p.useT / crossbowCharge(st);
      return f >= 1 ? 'i_crossbow_pulling_2' : f >= 0.58 ? 'i_crossbow_pulling_1' : 'i_crossbow_pulling_0';
    }
  }
  if (k === 'elytra' && (st.dmg || 0) >= ITEMS[st.id].durability - 1) return 'i_elytra_broken';
  return typeof dynamicIconTex === 'function' ? dynamicIconTex(st, p) : null;
}

// ---- the offhand: F swaps it with the selected slot ----
Game.prototype.swapOffhand = function () {
  const p = this.player,
    inv = p.inv;
  if (this.net) {
    this.net.send({
      t: 'swaphands'
    });
  }
  const a = inv.slots[inv.sel];
  inv.slots[inv.sel] = inv.slots[OFF] || null;
  inv.slots[OFF] = a || null;
  p.usingItem = null;
  p.useT = 0;
};

// ---- using: what each piece of equipment does on the use button ----
const crossbowCharge = st => Math.max(0, 25 - 5 * enchLevel(st, 'quick_charge'));
// the main hand has a use of its own (then a shield in the other hand stays down)
Game.prototype.mainHandBusy = function (held, def) {
  if (!held) return false;
  const k = def.key;
  if (def.food || def.armor || def.spawnEgg || /potion|bucket|bow$|^trident$|_spear$|^ender_(pearl|eye)$|^snowball$|egg$|^fishing_rod$|^flint_and_steel$|^fire_charge$|^bone_meal$|^shield$|^firework_rocket$/.test(k)) return true;
  return !!this.target && (def.block !== undefined || !!def.places);
};
Game.prototype.startUsing = function (st, hand) {
  const p = this.player;
  p.usingItem = st.id;
  p.useHand = hand;
  p.useT = 0;
};
Game.prototype.useEquipment = function (held, def) {
  const p = this.player,
    k = def && def.key;
  if (k === 'shield') {
    if (!(p.shieldCd > this.tickCount)) this.startUsing(held, 'main');
    return true;
  }
  if (k === 'crossbow') {
    if (held.charged && held.charged.length) {
      this.shootCrossbow(held);
      return true;
    }
    if (this.mode === 'creative' || this.findAmmo(true)) this.startUsing(held, 'main'); // (its sounds: usingTick)
    return true;
  }
  if (k === 'trident') {
    if (enchLevel(held, 'riptide') && !(p.inWater || this.rainingAt(p))) return true;
    if (held.dmg >= ITEMS[held.id].durability - 1) return true;
    this.startUsing(held, 'main');
    return true;
  }
  if (isSpear(k)) {
    this.startUsing(held, 'main');
    p.spearStart = this.tickCount;
    Sound.ev('item.spear.use', p.pos, 1, 1);
    return true;
  }
  if (k === 'firework_rocket' && p.gliding) {
    p.boostT = 10 * 1 + 2 + Math.floor(Math.random() * 6);
    Sound.ev('entity.firework_rocket.launch', p.pos, 3, 1);
    if (this.mode !== 'creative') {
      held.count--;
      if (!held.count) p.inv.slots[p.inv.sel] = null;
    }
    p.swing(); // (vanilla: a successful use swings the hand)
    return true;
  }
  // (a shield in the other hand: raised by its own turn, Game.useHands)
  return false;
};
// vanilla Entity.isInRain: rain (not snow) falls on the feet or the head - nothing above them (World has no getHeight:
// this was always false, so riptide never worked in the rain)
Game.prototype.rainingAt = function (p) {
  if (this.dim !== 'overworld' || !(this.weather > 0.2)) return false;
  const x = Math.floor(p.pos[0]),
    z = Math.floor(p.pos[2]);
  if (this.dryAt(x, z)) return false;
  const top = this.world.surfaceY(x, z);
  return [Math.floor(p.pos[1]), Math.floor(p.pos[1] + p.h)].some(y => y > top && !(this.world.gen2 ? this.snowsAt(x, y, z) : this.isCold(x, z)));
};
// while held down
Game.prototype.usingTick = function (st) {
  const p = this.player,
    k = keyOfStack(st);
  if (k === 'crossbow') {
    // CrossbowItem.onUseTick: the start sound at a fifth of the charge, the middle one at half (none with Quick Charge,
    // whose start sound is its own), the end one when loaded
    const n = crossbowCharge(st),
      q = enchLevel(st, 'quick_charge');
    if (p.useT === Math.ceil(n * 0.2)) Sound.ev(q ? 'item.crossbow.quick_charge_' + Math.min(q, 3) : 'item.crossbow.loading_start', p.pos, 0.5, 1);
    if (!q && p.useT === Math.ceil(n * 0.5)) Sound.ev('item.crossbow.loading_middle', p.pos, 0.5, 1);
    if (p.useT === n) Sound.ev('item.crossbow.loading_end', p.pos, 1, 1 / (Math.random() * 0.5 + 1) + 0.2);
  }
  if (isSpear(k)) this.spearTick(st);
};
// let go
Game.prototype.releaseUsing = function (st) {
  const p = this.player,
    k = keyOfStack(st);
  if (k === 'bow') return this.releaseBow();
  if (k === 'crossbow' && p.useT >= crossbowCharge(st) && !(st.charged && st.charged.length)) return this.loadCrossbow(st);
  if (k === 'trident' && p.useT >= 10) return this.releaseTrident(st);
};

// ---- crossbow ----
// arrows (or a firework in the other hand, for crossbows) from the inventory: [slot, stack]
Game.prototype.findAmmo = function (crossbow) {
  const inv = this.player.inv,
    off = inv.slots[OFF];
  if (off && (AMMO.has(keyOfStack(off)) || crossbow && keyOfStack(off) === 'firework_rocket')) return [OFF, off];
  for (let i = 0; i < 36; i++) {
    const s = inv.slots[i];
    if (s && AMMO.has(keyOfStack(s))) return [i, s];
  }
  return null;
};
Game.prototype.loadCrossbow = function (cb) {
  const p = this.player,
    found = this.findAmmo(true),
    multi = enchLevel(cb, 'multishot') ? 3 : 1;
  const ammo = found ? {
    ...found[1],
    count: 1
  } : this.mode === 'creative' ? makeStack('arrow') : null;
  if (!ammo) return;
  if (found && this.mode !== 'creative') {
    found[1].count--;
    if (!found[1].count) p.inv.slots[found[0]] = null;
  }
  cb.charged = Array.from({
    length: multi
  }, () => ({
    ...ammo
  }));
  Sound.ev('item.crossbow.loading_end', p.pos, 1, 1);
};
Game.prototype.shootCrossbow = function (cb) {
  const p = this.player,
    d = this.lookDir(),
    list = cb.charged,
    pierce = enchLevel(cb, 'piercing');
  list.forEach((ammo, i) => {
    const ang = list.length > 1 ? [0, -10, 10][i] * Math.PI / 180 : 0,
      c = Math.cos(ang),
      s = Math.sin(ang);
    const dir = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
    if (keyOfStack(ammo) === 'firework_rocket') {
      // a firework flies straight and bursts on what it hits (itemuse.js FireworkRocket, shot)
      this.entities.push(new FireworkRocket(this, p.pos[0], p.pos[1] + p.eye() - 0.15, p.pos[2], ammo, dir.map(v => v * 1.6), p));
      return;
    }
    const a = new Arrow(this, p.pos[0], p.pos[1] + p.eye() - 0.15, p.pos[2], dir.map(v => v * 3.15), p);
    a.stack = {
      ...ammo,
      count: 1
    };
    a.pierce = pierce;
    a.crossbow = true;
    if (keyOfStack(ammo) !== 'arrow') a.tip = ammo;
    if (i > 0 || this.mode === 'creative') a.noPickup = true;
    this.entities.push(a);
  });
  delete cb.charged;
  Sound.ev('item.crossbow.shoot', p.pos, 1, 1 / (Math.random() * 0.5 + 1.8) + 0.63);
  // (vanilla getDurabilityUse: 3 a firework, 1 an arrow, for each one shot)
  this.damageHeld(list.reduce((n, a) => n + (keyOfStack(a) === 'firework_rocket' ? 3 : 1), 0));
};

// ---- trident: thrown (it comes back with loyalty), or riptide carries the player ----
class ThrownTrident extends Arrow {
  constructor(game, x, y, z, vel, shooter, stack) {
    super(game, x, y, z, vel, shooter);
    this.stack = stack;
    this.baseDmg = 8;
    this.trident = true;
    this.loyalty = enchLevel(stack, 'loyalty');
    this.returning = false;
    this.dealt = false;
  }
  tick() {
    const g = this.game,
      p = g.player;
    if (this.loyalty && (this.dealt || this.stuck || this.age > 80) && !this.returning && this.shooter === p) {
      this.returning = true;
      this.stuck = false;
      Sound.ev('item.trident.return', this.pos, 10, 1);
    }
    if (this.returning) {
      this.savePrev();
      this.age++;
      const t = [p.pos[0] - this.pos[0], p.pos[1] + p.eye() - this.pos[1], p.pos[2] - this.pos[2]],
        l = Math.hypot(...t) || 1,
        sp = 0.05 * this.loyalty;
      this.pos[1] += t[1] * 0.015 * this.loyalty;
      this.vel = this.vel.map((v, i) => v * 0.95 + t[i] / l * sp);
      for (let i = 0; i < 3; i++) this.pos[i] += this.vel[i];
      this.updateRot();
      if (l < 1.5) this.pickUp();
      return;
    }
    const was = this.stuck;
    super.tick();
    if (!was && this.stuck) Sound.ev('item.trident.hit_ground', this.pos, 1, 1);
  }
  onHit(e) {
    this.dealt = true;
    const v = this.vel;
    this.vel = [v[0] * -0.01, v[1] * -0.1, v[2] * -0.01];
    Sound.ev('item.trident.hit', this.pos, 1, 1);
    // channeling: lightning on a mob hit in a thunderstorm, out under the sky
    if (enchLevel(this.stack, 'channeling') && this.game.thunder && this.game.strikeLightning) this.game.strikeLightning(e.pos[0], e.pos[1], e.pos[2]);
  }
  pickUp() {
    const p = this.game.player;
    if (this.shooter === p && (p.creative || p.inv.add({
      ...this.stack
    }) === 0)) {
      this.dead = true;
      Sound.pop(this.pos);
    }
  }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer;
    r.initEquipModels();
    const m = r.mat();
    M4.translate(m, ip[0], ip[1], ip[2]);
    M4.rotY(m, this.yaw);
    M4.rotX(m, this.pitch - Math.PI / 2);
    M4.translate(m, 0, 0.6, 0);
    r.gl.disable(r.gl.CULL_FACE);
    r.drawModel('eq_trident', r.beTex('trident'), m, null, l, env, {
      glint: glintOf(this.stack) && 'entity'
    });
    r.gl.enable(r.gl.CULL_FACE);
  }
}
Game.prototype.releaseTrident = function (st) {
  const p = this.player,
    rip = enchLevel(st, 'riptide');
  this.damageHeld(1);
  if (rip) {
    // riptide: launched along the view, spinning
    const d = this.lookDir(),
      f = 3 * ((1 + rip) / 4);
    p.vel[0] += d[0] * f;
    p.vel[1] += d[1] * f;
    p.vel[2] += d[2] * f;
    if (p.onGround) p.pos[1] += 1.2;
    p.riptideT = 20;
    p.fallDist = 0;
    Sound.ev('item.trident.riptide_' + Math.min(3, rip), p.pos, 1, 1);
    return;
  }
  const d = this.lookDir(),
    stack = {
      ...st,
      count: 1
    };
  const t = new ThrownTrident(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], d.map(v => v * 2.5), p, stack);
  if (this.mode === 'creative') t.noPickup = true;
  this.entities.push(t);
  if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = null;
  Sound.ev('item.trident.throw', p.pos, 1, 1);
};

// ---- spears (26.x), from their item components: a jab (attack) reaches 2 to 4.5 blocks (creative 2 to 6.5) and
// pierces everything on the line, but only at a full attack charge; its swing is a 19-tick stab. Held up (use) for
// 12 ticks the spear is couched: for 225 ticks it hurts what it runs into by the speed it hits it with (at least
// 4.6 blocks a second; knocks back up to 135 ticks at 5.1), while the player walks and sprints at full speed.
const SPEAR = {
  minR: 2,
  maxR: 4.5,
  minRC: 2,
  maxRC: 6.5,
  margin: 0.125,
  stab: 19,
  delay: 12,
  damageTicks: 225,
  minSpeed: 4.6,
  mult: 0.95,
  knockTicks: 135,
  knockSpeed: 5.1,
  forward: 0.38
};
// each spear's kinetic_weapon (the figures above are iron's): [delay, dismount ticks, knockback ticks, damage ticks, damage multiplier]
const SPEAR_KW = {
  wooden: [15, 100, 200, 300, 0.7],
  stone: [14, 90, 180, 275, 0.82],
  copper: [13, 80, 165, 250, 0.82],
  iron: [12, 50, 135, 225, 0.95],
  golden: [14, 70, 170, 275, 0.7],
  diamond: [10, 60, 130, 200, 1.075],
  netherite: [8, 50, 110, 175, 1.2]
};
const spearKW = k => {
  const v = SPEAR_KW[String(k).split('_')[0]] || SPEAR_KW.iron;
  return {
    delay: v[0],
    dismount: v[1],
    knock: v[2],
    damage: v[3],
    mult: v[4],
    forward: SPEAR.forward
  };
};
// ---- the spear's animations: vanilla's SpearAnimations, with net.minecraft.util.Ease's curves ----
const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const EASE = {
  inQuad: x => x * x,
  inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
  outCubic: x => 1 - (1 - x) ** 3,
  outQuart: x => 1 - (1 - x) ** 4,
  outCirc: x => Math.sqrt(1 - (x - 1) ** 2),
  inCirc: x => 1 - Math.sqrt(1 - x * x),
  outBack: x => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
  inOutBack: x => {
    const c = 2.5949095;
    return x < 0.5 ? (2 * x) ** 2 * ((c + 1) * 2 * x - c) / 2 : ((2 * x - 2) ** 2 * ((c + 1) * (x * 2 - 2) + c) + 2) / 2;
  },
  inOutExpo: x => x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
  inOutElastic: x => {
    const c = 2 * Math.PI / 4.5;
    return x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c)) / 2 : 2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c) / 2 + 1;
  }
};
// SpearAnimations.UseParams: raised over the delay, swaying as the dismount window closes, lowered as the knockback
// one does, drawn back up as the damage one ends
function spearUse(kw, t) {
  const d = kw.delay,
    dis = kw.dismount + d,
    kn = kw.knock + d,
    dmg = kw.damage + d,
    D = Math.PI / 180;
  const raise = prog(t, 0, d),
    sway = prog(t, dis - 20, dis),
    back = prog(t, dmg - 5, dmg);
  const I = 2 * EASE.outCirc(sway) - 2 * EASE.inCirc(back);
  return {
    raise,
    rs: prog(raise, 0, 0.5),
    rm: prog(raise, 0.5, 0.8),
    re: prog(raise, 0.8, 1),
    sway,
    back,
    I,
    lower: EASE.outCubic(EASE.inOutElastic(prog(t - 20, kn - 40, kn))),
    slow: Math.sin(t * 19 * D) * I,
    fast: Math.sin(t * 30 * D) * I
  };
}
// the kick when the couched point hits something (t: ticks since)
const spearKick = t => 0.4 * (EASE.outQuart(prog(t, 1, 3)) - EASE.inOutSine(prog(t, 3, 10)));
// the stab's three beats: drawn back, thrust, recovered
const stabBeats = t => ({
  a: EASE.inOutSine(prog(t, 0, 0.05)),
  q: EASE.inQuad(prog(t, 0.05, 0.2)),
  b: EASE.outBack(prog(t, 0.05, 0.2)),
  c: EASE.inOutExpo(prog(t, 0.4, 1))
});
const rotAround = (m, rot, ang, x, y, z) => {
  M4.translate(m, x, y, z);
  rot(m, ang);
  M4.translate(m, -x, -y, -z);
};
const attackTime = (e, a) => e.swingT > 0 ? clamp(((e.swingDur || 6) - e.swingT + a) / (e.swingDur || 6), 0, 1) : 0;
// the entities on the look line within the spear's reach, nearest first: [{ e, t }]
Game.prototype.spearTargets = function () {
  const p = this.player,
    eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]],
    d = this.lookDir();
  const cr = this.mode === 'creative',
    lo = cr ? SPEAR.minRC : SPEAR.minR,
    hi = cr ? SPEAR.maxRC : SPEAR.maxR,
    m = SPEAR.margin;
  const block = this.raycast(eye, d, hi, false),
    maxT = block ? Math.min(hi, block.t) : hi;
  const out = [];
  for (const e of this.entities) {
    if (e.dead || !(e instanceof Living) && !e.hittable || e.deathTime > 0 || e === p.vehicle) continue;
    const b = e.box(),
      hit = rayBox(eye, d, b[0] - m, b[1] - m, b[2] - m, b[3] + m, b[4] + m, b[5] + m);
    if (hit && hit.t >= lo && hit.t <= maxT) out.push({
      e,
      t: hit.t
    });
  }
  return out.sort((a, b) => a.t - b.t);
};
const _spUpdateTarget = Game.prototype.updateTarget;
Game.prototype.updateTarget = function () {
  const r = _spUpdateTarget.call(this);
  if (isSpear(keyOfStack(this.player.inv.held))) {
    const near = this.spearTargets()[0];
    this.targetEntity = near && (!this.target || near.t < this.target.t) ? near.e : null;
    this.targetPart = null;
  }
  return r;
};
// the stab lasts 19 ticks (vanilla swing_animation "stab")
const _spSwing = Player.prototype.swing;
Player.prototype.swing = function () {
  this.swingN = (this.swingN || 0) + 1; // (Game.useHands: did the main hand's use do something)
  if (isSpear(keyOfStack(this.inv && this.inv.held))) {
    if (this.swingT <= SPEAR.stab / 2) {
      this.swingT = SPEAR.stab;
      this.swingDur = SPEAR.stab;
      this.swingStab = true;
    }
    return;
  }
  this.swingDur = 6;
  this.swingStab = false;
  return _spSwing.call(this);
};
// which hand swings (vanilla's swing(hand)): the other one while its item is used (swingOff); kept while a swing
// that doesn't restart runs on
(() => {
  const _sw = Player.prototype.swing;
  Player.prototype.swing = function (...args) {
    const t = this.swingT,
      r = _sw.apply(this, args);
    if (this.swingT !== t) this.swingHand = this.offSwing ? 'off' : 'main';
    return r;
  };
  Player.prototype.swingOff = function () {
    this.offSwing = true;
    try {
      this.swing();
    } finally {
      this.offSwing = false;
    }
  };
})();
// a jab: hurts every entity on the line - only at a full charge (vanilla minimum_attack_charge 1: Minecraft.startAttack
// does nothing before; it had gone off at any charge, so clicking fast stabbed without end, "长矛没有攻击冷却").
// false when it can't go yet. (0.1 tick of slack: the item data's attack speed is rounded, 1.05 for vanilla's 1.0526)
Game.prototype.spearJab = function () {
  const p = this.player,
    held = p.inv.held,
    def = ITEMS[held.id];
  if (this.attackStrength(0.1) < 1) return false;
  const list = this.spearTargets();
  Sound.ev('item.spear.attack', p.pos, 1, 1);
  let hit = false;
  for (const {
    e
  } of list) {
    const dmg = Math.max(0, (def.attack || 1) + effectAttackBonus(p)) + enchantAttackBonus(held, e);
    const src = {
      type: 'player',
      attacker: p,
      knockFrom: p.pos,
      knock: 0.4 + heldEnch(p, 'knockback') * 0.5,
      player: true,
      looting: heldEnch(p, 'looting')
    };
    if (e.hurt(dmg, src)) {
      hit = true;
      Sound.ev('item.spear.hit', e.pos, 1, 1);
      const fa = heldEnch(p, 'fire_aspect');
      if (fa && !e.fireproof && e instanceof Living) e.fire = Math.max(e.fire || 0, 80 * fa);
    }
  }
  // lunge: the jab carries the player forward (at a cost in food)
  const lu = heldEnch(p, 'lunge');
  if (lu) {
    const d = this.lookDir();
    p.vel[0] += d[0] * 0.458 * lu;
    p.vel[2] += d[2] * 0.458 * lu;
    p.exhaust(lu * 1.5);
  }
  if (hit) {
    this.damageHeld(1);
    p.exhaust(0.1);
  }
  p.attackT = 0;
  p.swing();
  return true;
};
// held up: what the point runs into
Game.prototype.spearTick = function (st) {
  const p = this.player,
    kw = spearKW(keyOfStack(st)),
    held = this.tickCount - (p.spearStart || 0) - kw.delay;
  if (held < 0 || held > kw.damage) return;
  const d = this.lookDir();
  for (const {
    e
  } of this.spearTargets()) {
    if (!(e instanceof Living) || (e.spearHitT || 0) > this.tickCount) continue;
    // how fast the point closes on it: this tick's movement of both along the view, in blocks a second
    const mv = o => o.prev ? [o.pos[0] - o.prev[0], o.pos[1] - o.prev[1], o.pos[2] - o.prev[2]] : [0, 0, 0];
    const pv = mv(p.vehicle || p),
      ev = mv(e);
    const rel = ((pv[0] - ev[0]) * d[0] + (pv[1] - ev[1]) * d[1] + (pv[2] - ev[2]) * d[2]) * 20;
    if (rel < SPEAR.minSpeed) continue;
    const knock = held <= kw.knock && rel >= SPEAR.knockSpeed;
    e.spearHitT = this.tickCount + 10;
    p.spearKickT = this.tickCount;
    if (e.hurt(kw.mult * rel + enchantAttackBonus(st, e), {
      type: 'player',
      attacker: p,
      player: true,
      knockFrom: p.pos,
      knock: knock ? 0.9 : 0
    })) {
      Sound.ev('item.spear.hit', e.pos, 1, 1);
      // (fire aspect sets it alight as with any hit - vanilla's post-attack effects; only the jab had it)
      const fa = enchLevel(st, 'fire_aspect');
      if (fa && !e.fireproof) e.fire = Math.max(e.fire || 0, 80 * fa);
      this.damageHeld(1);
    }
  }
};

// ---- melee: the mace's smash (the longer the fall, the harder), spear jabs reach 4.5 blocks ----
const _attack = Game.prototype.attack;
Game.prototype.attack = function (e) {
  const p = this.player,
    held = p.inv.held,
    k = keyOfStack(held);
  if (isSpear(k)) {
    if (this.spearJab()) this.attackCd = 2;
    return;
  }
  // (vanilla canSmashAttack: not while gliding)
  const smash = k === 'mace' && p.fallDist > 1.5 && !p.onGround && !p.gliding;
  if (smash) {
    const d = p.fallDist,
      dens = enchLevel(held, 'density');
    let bonus = d <= 3 ? 4 * d : d <= 8 ? 12 + 2 * (d - 3) : 22 + (d - 8);
    bonus += 0.5 * dens * d;
    p.maceBonus = bonus; // (game.js attack: added after the cool-down's scaling)
  }
  _attack.call(this, e);
  p.maceBonus = 0;
  // the smash's after-effects come after the hit (vanilla MaceItem.hurtEnemy), so a falling full-strength smash crits too
  if (smash) {
    const d = p.fallDist;
    p.fallDist = 0;
    p.vel[1] = Math.max(p.vel[1], 0.01);
    const wb = enchLevel(held, 'wind_burst');
    if (wb) p.vel[1] = 0.7 + 0.35 * (wb - 1);
    // the shockwave: mobs around get knocked away
    for (const o of this.entities) if (o !== e && o instanceof Living && !o.dead && o.distTo(e) < 3.5) {
      const dx = o.pos[0] - e.pos[0],
        dz = o.pos[2] - e.pos[2],
        l = Math.hypot(dx, dz) || 1,
        f = (3.5 - o.distTo(e)) * 0.7;
      o.vel[0] += dx / l * f;
      o.vel[2] += dz / l * f;
      o.vel[1] += 0.2;
    }
    for (let i = 0; i < 30; i++) this.particles.spawn('crit', e.pos[0] + (Math.random() - 0.5) * 2, e.pos[1] + 0.1, e.pos[2] + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4);
    Sound.ev(d > 5 ? 'item.mace.smash_ground_heavy' : 'item.mace.smash_ground', e.pos, 1, 1);
  }
};

// ---- the shield: blocks what hits it from the front once raised (a quarter second) ----
Player.prototype.blocking = function () {
  if (!this.usingItem || this.useT < 5) return null;
  const st = this.useHand === 'off' ? this.inv.slots[OFF] : this.inv.held;
  return keyOfStack(st) === 'shield' ? st : null;
};
const _playerHurt = Player.prototype.hurt;
Player.prototype.hurt = function (a, src) {
  const sh = this.blocking(),
    t = src && src.type;
  if (sh && a > 0 && t && !['fall', 'drown', 'starve', 'void', 'fire', 'lava', 'magic', 'cactus', 'thorns'].includes(t) && !this.creative) {
    const from = src.knockFrom || src.attacker && src.attacker.pos;
    if (from) {
      const d = this.game.lookDir(),
        v = [from[0] - this.pos[0], 0, from[2] - this.pos[2]],
        l = Math.hypot(v[0], v[2]) || 1;
      if ((v[0] * d[0] + v[2] * d[2]) / l > 0) {
        if (a >= 3 && this.game.mode !== 'creative') {
          const n = 1 + Math.floor(a);
          sh.dmg = (sh.dmg || 0) + n;
          if (sh.dmg >= ITEMS[sh.id].durability) {
            const i = this.useHand === 'off' ? OFF : this.inv.sel;
            this.inv.slots[i] = null;
            this.usingItem = null;
            Sound.ev('item.shield.break', this.pos, 1, 1);
          }
        }
        Sound.ev('item.shield.block', this.pos, 1, 0.8 + Math.random() * 0.4);
        // melee attackers are pushed back
        const at = src.attacker;
        if (at && at.vel && t === 'mob') {
          at.vel[0] += v[0] / l * 0.5;
          at.vel[2] += v[2] / l * 0.5;
        }
        return false;
      }
    }
  }
  return _playerHurt.call(this, a, src);
};
// the totem of undying: held in either hand, it saves from death once
const _playerDie = Player.prototype.die;
Player.prototype.die = function (src) {
  if (!(src && src.type === 'void')) {
    const i = [this.inv.sel, OFF].find(j => keyOfStack(this.inv.slots[j]) === 'totem_of_undying');
    if (i !== undefined) {
      this.inv.slots[i] = null;
      this.health = 1;
      this.deathTime = 0;
      this.dead = false;
      this.clearEffects();
      this.addEffect('regeneration', 1, 900);
      this.addEffect('absorption', 1, 100);
      this.addEffect('fire_resistance', 0, 800);
      const g = this.game;
      for (let k = 0; k < 60; k++) g.particles.spawn('crit', this.pos[0] + (Math.random() - 0.5), this.pos[1] + Math.random() * 2, this.pos[2] + (Math.random() - 0.5), (Math.random() - 0.5) * 0.6, Math.random() * 0.6, (Math.random() - 0.5) * 0.6, {
        col: [Math.random() < 0.5 ? 255 : 120, 220, 60]
      });
      Sound.ev('item.totem.use', this.pos, 1, 1);
      g.totemShow = {
        id: ITEM_KEY.totem_of_undying,
        t: performance.now()
      };
      return;
    }
  }
  _playerDie.call(this, src);
};

// ---- the elytra: glide (jump in the air), steer with the view; fireworks push ----
Player.prototype.canGlide = function () {
  const c = this.inv.slots[37];
  return keyOfStack(c) === 'elytra' && (c.dmg || 0) < ITEMS[c.id].durability - 1 && !this.onGround && !this.inWater && !this.inLava && !this.flying && !this.onLadder();
};
Player.prototype.glideTravel = function () {
  const v = this.vel,
    d = this.game.lookDir(),
    pitch = -Math.asin(clamp(d[1], -1, 1));
  const hl = Math.hypot(d[0], d[2]),
    hv = Math.hypot(v[0], v[2]);
  const grav = this.hasEffect && this.hasEffect('slow_falling') && v[1] <= 0 ? 0.01 : 0.08;
  const cp = Math.cos(pitch) ** 2;
  v[1] += grav * (-1 + cp * 0.75);
  if (v[1] < 0 && hl > 0) {
    const k = v[1] * -0.1 * cp;
    v[0] += d[0] * k / hl;
    v[1] += k;
    v[2] += d[2] * k / hl;
  }
  if (pitch < 0 && hl > 0) {
    const k = hv * -Math.sin(pitch) * 0.04;
    v[0] -= d[0] * k / hl;
    v[1] += k * 3.2;
    v[2] -= d[2] * k / hl;
  }
  if (hl > 0) {
    v[0] += (d[0] / hl * hv - v[0]) * 0.1;
    v[2] += (d[2] / hl * hv - v[2]) * 0.1;
  }
  if (this.boostT > 0) {
    for (let i = 0; i < 3; i++) v[i] += d[i] * 0.1 + (d[i] * 1.5 - v[i]) * 0.5;
    if (this.game.tickCount % 2) this.game.particles.spawn('smoke', this.pos[0], this.pos[1], this.pos[2], -v[0] * 0.3, -v[1] * 0.3, -v[2] * 0.3);
  }
  v[0] *= 0.99;
  v[1] *= 0.98;
  v[2] *= 0.99;
  const before = Math.hypot(v[0], v[2]);
  this.move(v[0], v[1], v[2]);
  // flying into a wall hurts
  if (this.collidedH) {
    const after = Math.hypot(this.vel[0], this.vel[2]),
      f = (before - after) * 10 - 3;
    if (f > 0) this.hurt(f, {
      type: 'fly_into_wall'
    });
  }
  this.fallDist = this.vel[1] < -0.5 ? this.fallDist : 1;
  // the elytra wears a point a second
  const c = this.inv.slots[37];
  if (++this.glideT % 20 === 0 && c && !this.creative && !unbreakingSkips(c, true)) c.dmg = (c.dmg || 0) + 1;
  if (this.onGround || !this.canGlide()) this.gliding = false;
};
const _travel = Player.prototype.travel;
Player.prototype.travel = function (fwd, strafe, speed, jump) {
  if (this.gliding && this.canGlide()) return this.glideTravel();
  this.gliding = false;
  if (this.riptideT > 0) {
    this.riptideT--;
  }
  return _travel.call(this, fwd, strafe, speed, jump);
};
// a rocket's push lasts its flight, gliding or not (vanilla FireworkRocketEntity: its lifetime runs on, it pushes only
// while the player glides). It counted down only while gliding: landed, the rest waited for the next glide - "不放烟花
// 也能长距离加速滑翔", feedback 11-08
const _eqTick = Player.prototype.tick;
Player.prototype.tick = function (input) {
  _eqTick.call(this, input);
  if (this.boostT > 0) this.boostT--;
};
// jump pressed in the air: start gliding
Game.prototype.tryGlide = function () {
  const p = this.player;
  if (!p.gliding && !p.flying && p.vel[1] < 0.2 && p.canGlide()) {
    p.gliding = true;
    p.glideT = 0;
    p.glideFlip = /^(Dinnerbone|Grumm)$/.test(p.inv.slots[37].name || '');
    // on a server: tell it (START_FALL_FLYING) - only a player it knows is gliding gets a rocket's boost
    if (this.net) this.net.send({
      t: 'glide'
    });
    return true;
  }
  return false;
};

// ---- in first person: the shield, trident and crossbow as vanilla draws them, and whatever is in the offhand ----
const _drawHand = Game.prototype.drawHand;
// a block-entity block whose item has no model of its own (banners, chests, heads ...): drawn with drawBEItem
Game.prototype.isBEItem = function (st) {
  const d = st && ITEMS[st.id],
    b = d && d.block !== undefined ? BLOCKS[d.block] : null;
  if (!(b && b.beRender && !b.bed)) return false;
  const vim = this.renderer.itemModel(st.id);
  return !(vim && vim.mesh);
};
Game.prototype.drawHand = function (a, env) {
  const p = this.player,
    held = p.inv.held,
    k = keyOfStack(held),
    off = p.inv.slots[OFF];
  if (p.usingItem === ITEM_KEY.spyglass) return; // vanilla: no hands while looking through a spyglass
  const special = k === 'shield' || k === 'trident' || k === 'crossbow' || k === 'spyglass' || isSpear(k) || this.isBEItem(held);
  // (with the shader pack the depth is kept: post reads the world's from it, the hand goes in front by its depth range -
  // clearing it here fogged the whole world white while a spear, trident, shield or crossbow was held)
  if (!special) _drawHand.call(this, a, env);else if (!this.renderer.fxOn) this.renderer.gl.clear(this.renderer.gl.DEPTH_BUFFER_BIT);
  if (special) this.drawHandStack(held, false, a, env);
  if (off) this.drawHandStack(off, true, a, env);
};
const HAND_CAM = [0, 0, 0]; // (the hand's camera: at the origin of its own projection; only read)
Game.prototype.drawHandStack = function (st, left, a, env) {
  var _p$oHandH, _p$handH;
  const r = this.renderer,
    p = this.player,
    D = Math.PI / 180,
    PI = Math.PI,
    s = left ? -1 : 1;
  // (both matrices from the renderer's pool for this frame: render.js mat)
  const proj = r.mat();
  M4.perspective(proj, 70 * D, r.canvas.width / r.canvas.height, 0.05, 10);
  const savedVP = r.vp,
    savedCam = r.camPos;
  r.vp = proj;
  r.camPos = HAND_CAM;
  const m = r.mat(),
    k = keyOfStack(st),
    def = ITEMS[st.id];
  if (this.settings.bobbing) {
    const bob = lerp(p.prevBob, p.bob, a) * PI * 0.6,
      amt = lerp(p.prevBobAmt || 0, p.bobAmt, a);
    M4.translate(m, Math.sin(bob) * amt * 0.5, -Math.abs(Math.cos(bob) * amt), 0);
  }
  const eq = left ? 0 : 1 - lerp((_p$oHandH = p.oHandH) !== null && _p$oHandH !== void 0 ? _p$oHandH : 1, (_p$handH = p.handH) !== null && _p$handH !== void 0 ? _p$handH : 1, a);
  const using = p.usingItem === st.id && p.useHand === 'off' === left;
  const sw = p.swingHand === 'off' === left && p.swingT > 0 ? clamp((6 - p.swingT + a) / 6, 0, 1) : 0;
  const useT = p.useT + a;
  const armT = () => M4.translate(m, s * 0.56, -0.52 - eq * 0.6, -0.72);
  if (isSpear(k)) {
    // a spear (SpearAnimations.firstPersonUse / firstPersonAttack): couched - raised, turned to lie across the view
    // and pointed ahead, swaying and lowered as its windows close - or stabbed: drawn back, thrust level, recovered
    if (using) {
      var _p$spearKickT;
      M4.translate(m, s * 0.56, -0.52, -0.72);
      const u = spearUse(spearKW(k), useT);
      M4.translate(m, s * (u.raise * 0.15 - u.re * 0.05 - u.sway * 0.1 + u.slow * 0.005), -u.raise * 0.075 + u.rm * 0.075 + u.fast * 0.01, u.rs * 0.05 - u.re * 0.05 + u.slow * 0.005);
      rotAround(m, M4.rotX, (-65 * EASE.inOutBack(u.raise) - 35 * u.lower + 100 * u.back - 0.5 * u.fast) * D, 0, 0.1, 0);
      rotAround(m, M4.rotY, -s * (-90 * prog(u.raise, 0.5, 0.55) + 90 * u.sway + 2 * u.slow) * D, s * 0.15, 0, 0);
      M4.translate(m, 0, -spearKick(this.tickCount - ((_p$spearKickT = p.spearKickT) !== null && _p$spearKickT !== void 0 ? _p$spearKickT : -1e9) + a), 0);
    } else {
      armT();
      const t = stabBeats(left ? 0 : attackTime(p, a));
      M4.translate(m, s * 0.1 * (t.a - t.b), -0.075 * (t.a - t.c), 0.65 * (t.a - t.b));
      M4.rotX(m, -70 * (t.a - t.c) * D);
      M4.translate(m, 0, 0, -0.25 * (t.c - t.b));
    }
  } else if (using && k === 'trident') {
    // vanilla's spear (trident) aim: raised back over the shoulder
    armT();
    M4.translate(m, s * -0.5, 0.7, 0.1);
    M4.rotX(m, -55 * D);
    M4.rotY(m, s * 35.3 * D);
    M4.rotZ(m, s * -9.785 * D);
    const f = Math.min(1, useT / 10);
    if (f > 0.1) M4.translate(m, 0, Math.sin((useT - 0.1) * 1.3) * (f - 0.1) * 0.004, 0);
    M4.translate(m, 0, 0, f * 0.2);
    M4.scale(m, 1, 1, 1 + f * 0.2);
    M4.rotY(m, -s * 45 * D);
  } else if (using && k === 'crossbow') {
    armT();
    M4.translate(m, s * -0.4785682, -0.094387, 0.05731531);
    M4.rotX(m, -11.935 * D);
    M4.rotY(m, s * 65.3 * D);
    M4.rotZ(m, s * -9.785 * D);
    const f = Math.min(1, useT / Math.max(1, crossbowCharge(st)));
    if (f > 0.1) M4.translate(m, 0, Math.sin((useT - 0.1) * 1.3) * (f - 0.1) * 0.004, 0);
    M4.translate(m, 0, 0, f * 0.04);
    M4.scale(m, 1, 1, 1 + f * 0.2);
    M4.rotY(m, -s * 45 * D);
  } else if (using && k === 'shield') armT();else if (using && k === 'bow') {
    // the bow drawn and the food eaten on this side (as game.js drawHand does them for the main hand)
    armT();
    M4.translate(m, s * -0.2785682, 0.18344387, 0.15731531);
    M4.rotX(m, -13.935 * D);
    M4.rotY(m, s * 35.3 * D);
    M4.rotZ(m, s * -9.785 * D);
    let f = useT / 20;
    f = (f * f + f * 2) / 3;
    if (f > 1) f = 1;
    if (f > 0.1) M4.translate(m, 0, Math.sin((useT - 0.1) * 1.3) * (f - 0.1) * 0.004, 0);
    M4.translate(m, 0, 0, f * 0.04);
    M4.scale(m, 1, 1, 1 + f * 0.2);
    M4.rotY(m, -s * 45 * D);
  } else if (using && (def.food || /^(potion|milk_bucket|honey_bottle|ominous_bottle)$/.test(k))) {
    const dur = k === 'honey_bottle' ? 40 : 32,
      rest = dur - useT + 1,
      f1 = rest / dur;
    if (f1 < 0.8) M4.translate(m, 0, Math.abs(Math.cos(rest / 4 * PI) * 0.1), 0);
    const f3 = 1 - Math.pow(Math.max(0, f1), 27);
    M4.translate(m, s * f3 * 0.6, f3 * -0.5, 0);
    M4.rotY(m, s * f3 * 90 * D);
    M4.rotX(m, f3 * 10 * D);
    M4.rotZ(m, s * f3 * 30 * D);
    armT();
  } else {
    const f1 = Math.sqrt(sw);
    M4.translate(m, s * -0.4 * Math.sin(f1 * PI), 0.2 * Math.sin(f1 * PI * 2), -0.2 * Math.sin(sw * PI));
    armT();
    const f = Math.sin(sw * sw * PI);
    M4.rotY(m, s * (45 + f * -20) * D);
    M4.rotZ(m, s * f * -20 * D * Math.sin(f1 * PI));
    M4.rotX(m, Math.sin(f1 * PI) * -80 * D);
    M4.rotY(m, s * -45 * D);
    if (k === 'crossbow' && st.charged && st.charged.length && sw < 0.001) {
      M4.translate(m, s * -0.641864, 0, 0);
      M4.rotY(m, s * 10 * D);
    }
  }
  const lt = p.lightAt(),
    env2 = {
      ...env,
      fogNear: 1e8,
      fogFar: 2e8
    },
    ctx = left ? 'firstperson_lefthand' : 'firstperson_righthand';
  r.gl.disable(r.gl.CULL_FACE);
  // (匠魂's javelin borrows the trident's key - its aim above - but is drawn as itself, not the trident's model)
  if (k === 'shield' || k === 'trident' && !def.tcTool) {
    r.initEquipModels();
    const disp = DISPLAY[k === 'shield' ? using ? 'shield_blocking' : 'shield' : 'trident'];
    applyDisplay(m, disp[ctx] || disp.firstperson_righthand, left);
    // the special renderers draw their model flipped (y down to y up, z turned) from the item's corner
    M4.translate(m, -0.5, -0.5, -0.5);
    M4.scale(m, 1, 1, -1);
    r.drawModel(k === 'shield' ? 'eq_shield' : 'eq_trident', k === 'shield' ? typeof shieldTex === 'function' ? shieldTex(r, st) : r.beTex('shield_base') : r.beTex('trident'), m, null, lt, env2, {
      vp: proj,
      glint: glintOf(st) && 'entity'
    });
  } else {
    const vim = r.itemModel(st.id),
      b = def.block !== undefined ? BLOCKS[def.block] : null;
    const flat = vim ? vim.gen || !b && !vim.mesh : !b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door;
    const disp = vim && vim.model && vim.model.display;
    if (flat) {
      // (no model - a mod's tool: item/handheld's left hand, which isn't the right hand's mirrored)
      const hh = left && (def.tool || def.attack || def.handheld);
      applyDisplay(m, disp && (disp[ctx] || disp.firstperson_righthand) || {
        r: hh ? [0, 90, -25] : [0, -90, 25],
        t: [1.13, 3.2, 1.13],
        s: [0.68, 0.68, 0.68]
      }, left);
      M4.translate(m, -0.5, -0.5, 0);
      const stTex = itemStateTex(st, p);
      this.drawLayers(stTex ? [[T(stTex), null]] : this.itemLayers(st, def, vim, b), m, env2, lt, glintOf(st));
    } else {
      // a model whose display has no first-person transform is drawn untransformed in vanilla (the spyglass)
      applyDisplay(m, disp ? disp[ctx] || disp.firstperson_righthand || {
        r: [0, 0, 0],
        t: [0, 0, 0],
        s: [1, 1, 1]
      } : {
        r: [0, left ? 225 : 45, 0],
        s: [0.4, 0.4, 0.4]
      }, left);
      // (a bed: both halves, renderer.itemModel - head at z 0, foot at z 1 like vanilla's composite item, from -0.5 too)
      M4.translate(m, -0.5, -0.5, -0.5);
      if (vim && vim.mesh) r.drawMesh(vim.mesh, m, env2, lt, {
        glint: glintOf(st) && 'item'
      });else if (this.isBEItem(st)) {
        this.drawBEItem(b, m, lt, env2, proj);
        r.gl.disable(r.gl.CULL_FACE);
      } else r.drawMesh(this.blockMesh(def.block, b.facing ? 4 : 0), m, env2, lt, {
        glint: glintOf(st) && 'item'
      });
    }
  }
  r.gl.enable(r.gl.CULL_FACE);
  r.vp = savedVP;
  r.camPos = savedCam;
};

// a spear in either hand (ArmPose.SPEAR, SpearAnimations.thirdPersonHandUse): the arm follows the head, pointed a
// little low (raised 55 degrees more lying down: gliding, swimming); couched it is raised, sways and drops as the
// windows close; the stab (thirdPersonAttackHand) drives the main arm back, out and up
function spearArms(P, p, a, lying) {
  const D = Math.PI / 180,
    bend = p.sneaking && !p.flying ? -0.4 : 0;
  for (const [hand, a2, sd] of [['main', 'rarm', 1], ['off', 'larm', -1]]) {
    const hs = hand === 'main' ? p.inv.held : p.inv.slots[OFF];
    if (!isSpear(keyOfStack(hs))) continue;
    const Q = P[a2] = {
      ...P[a2]
    };
    Q.ry = clamp(-0.1 * sd + (P.head.ry || 0), -60 * D, 60 * D);
    Q.rx = clamp(Math.PI / 2 + P.head.rx - 0.8 + (lying ? 0.9599311 : 0), -30 * D, 120 * D) + bend;
    if (p.usingItem === hs.id && p.useHand === hand) {
      const u = spearUse(spearKW(keyOfStack(hs)), p.useT + a);
      Q.ry += -sd * u.fast * D * u.I;
      Q.rz = (Q.rz || 0) - sd * u.slow * D * u.I * 0.5;
      Q.rx -= D * (-40 * u.rs + 30 * u.rm - 20 * u.re + 20 * u.lower + 10 * u.back + 0.6 * u.slow * u.I);
    }
    if (hand === 'main' && p.swingStab && p.swingT > 0) {
      const t = stabBeats(attackTime(p, a));
      Q.rx -= (90 * t.a - 120 * t.q + 30 * t.c) * D;
    }
  }
}
// ---- on the player model: arm poses for blocking, aiming a trident or crossbow; the offhand item ----
const _playerPose = Game.prototype.playerPose;
Game.prototype.playerPose = function (a) {
  const P = _playerPose.call(this, a),
    p = this.player;
  if (p.gliding && !p.glideFlip) {
    // vanilla fall flying: limbs held still along the body, the head lifted to look ahead
    P.rarm = {
      rx: 0,
      rz: 0.1
    };
    P.larm = {
      rx: 0,
      rz: -0.1
    };
    P.rleg = {
      rx: 0,
      rz: 0.05
    };
    P.lleg = {
      rx: 0,
      rz: -0.05
    };
    P.head.rx = Math.PI / 4;
    spearArms(P, p, a, true);
    return P;
  }
  if (p.pose === 'swim') {
    spearArms(P, p, a, true);
    return P;
  }
  const st = p.usingItem ? p.useHand === 'off' ? p.inv.slots[OFF] : p.inv.held : null,
    k = keyOfStack(st),
    left = p.useHand === 'off';
  const arm = left ? 'larm' : 'rarm',
    side = left ? -1 : 1,
    head = p.pitch;
  if (k === 'shield') {
    P[arm].rx = P[arm].rx * 0.5 + 0.9424779;
    P[arm].ry = side * -Math.PI / 6;
  } else if (k === 'trident') {
    P[arm].rx = P[arm].rx * 0.5 + Math.PI;
    P[arm].ry = 0;
  } else if (k === 'crossbow') {
    P.rarm.ry = -0.8;
    P.rarm.rx = 0.97079635;
    P.larm.rx = 0.97079635;
    P.larm.ry = 0.85 * Math.min(1, p.useT / Math.max(1, crossbowCharge(st)));
  } else if (keyOfStack(p.inv.held) === 'crossbow' && p.inv.held.charged && p.inv.held.charged.length) {
    P.rarm.ry = -0.3;
    P.larm.ry = 0.6;
    P.rarm.rx = Math.PI / 2 + head - 0.1;
    P.larm.rx = 1.5 + head;
  } else if (k === 'bow') {
    P.rarm.ry = -0.1;
    P.larm.ry = 0.5;
    P.rarm.rx = Math.PI / 2 + head;
    P.larm.rx = Math.PI / 2 + head;
  }
  // vanilla ArmPose.SPYGLASS: the hand up at the eye, following the head
  else if (k === 'spyglass') {
    P[arm].rx = -clamp(-head - 1.9198622 - (p.sneaking ? 0.2617994 : 0), -2.4, 3.3);
    P[arm].ry = side * -0.2617994;
  }
  if (p.inv.slots[OFF] && !(p.usingItem && left)) P.larm.rx = (P.larm.rx || 0) + Math.PI / 10;
  spearArms(P, p, a, false);
  return P;
};
// the elytra on the player's back: folded, spread out while gliding (vanilla ElytraModel.setupAnim)
Game.prototype.drawWings = function (e, m, lt, env, overlay, vp) {
  const c = e.inv ? e.inv.slots[37] : (e.armorItems || [])[1]; // (another player's: its chest slot)
  if (keyOfStack(c) !== 'elytra') return;
  const r = this.renderer;
  r.initEquipModels();
  let xr = 0.2617994,
    zr = -0.2617994;
  if (e.sneaking) {
    xr = 0.6981317;
    zr = -Math.PI / 4;
  }
  if (e.gliding) {
    const v = e.vel,
      l = Math.hypot(v[0], v[1], v[2]) || 1,
      f = v[1] < 0 ? 1 - Math.pow(-v[1] / l, 1.5) : 1;
    xr = f * 0.34906584 + (1 - f) * xr;
    zr = f * -Math.PI / 2 + (1 - f) * zr;
  }
  const gl = r.gl,
    cull = gl.isEnabled(gl.CULL_FACE);
  gl.disable(gl.CULL_FACE); // both sides of the wings show
  r.drawModel('eq_elytra', r.beTex('elytra_wings'), m, {
    lw: {
      rx: -xr,
      rz: zr,
      zx: true
    },
    rw: {
      rx: -xr,
      rz: -zr,
      zx: true
    }
  }, lt, env, {
    overlay,
    vp,
    glint: glintOf(c) && 'armor'
  });
  if (cull) gl.enable(gl.CULL_FACE);
};
// held items on a humanoid model (the player, other players, mobs): vanilla's ItemInHandLayer - from the hand,
// turned -90 about x and 180 about y, 1/16 out and 0.625 down the arm - then the item model's own third-person
// transform. This game's models are vanilla's turned 180 degrees about z (x and y flipped), and its arms turn about
// the arm's middle (vanilla: 1 pixel nearer the body), so the hand's space is first turned back to vanilla's.
const TP_DEFAULT = {
  generated: {
    r: [0, 0, 0],
    t: [0, 3, 1],
    s: [0.55, 0.55, 0.55]
  },
  handheld: {
    r: [0, -90, 55],
    t: [0, 4, 0.5],
    s: [0.85, 0.85, 0.85]
  },
  block: {
    r: [75, 45, 0],
    t: [0, 2.5, 0],
    s: [0.375, 0.375, 0.375]
  },
  handheld_left: {
    r: [0, 90, -55],
    t: [0, 4, 0.5],
    s: [0.85, 0.85, 0.85]
  } // (item/handheld's own left hand)
};
Game.prototype.heldAttach = function (e, model, main, off, lt, env) {
  if (!main && !off) return null;
  const mdl = this.renderer.models[model];
  if (!mdl) return null;
  const pivot = n => {
    const p = mdl.parts.find(q => q.name === n);
    return p ? Math.abs(p.pivot[0]) : null;
  };
  const out = {};
  // a spyglass being looked through is drawn at the eye, not in the hand
  const scoping = (st, left) => st && e.usingItem === st.id && e.useHand === 'off' === left && keyOfStack(st) === 'spyglass' && !(e.swingT > 0);
  if (scoping(main, false)) out.head = hm => this.drawSpyglassAtEye(hm, main, false, lt, env);else if (main && pivot('rarm') !== null) out.rarm = am => this.drawHeldItem(am, main, false, lt, env, e, -(pivot('rarm') - 5) / 16);
  if (scoping(off, true)) out.head = hm => this.drawSpyglassAtEye(hm, off, true, lt, env);else if (off && pivot('larm') !== null) out.larm = am => this.drawHeldItem(am, off, true, lt, env, e, (pivot('larm') - 5) / 16);
  return out;
};
// vanilla ItemInHandLayer.renderArmWithSpyglass: from the head (back in vanilla's space), the hat position
// (CustomHeadLayer.translateToHead), 2.5 pixels to the side and 1 up, then the item's 'head' display transform
Game.prototype.drawSpyglassAtEye = function (hm, st, left, lt, env) {
  const r = this.renderer,
    vim = r.itemModel(st.id),
    d = vim && vim.model && vim.model.display && vim.model.display.head;
  if (!(vim && vim.mesh && d)) return;
  M4.rotZ(hm, Math.PI);
  M4.translate(hm, 0, -0.25, 0);
  M4.rotY(hm, Math.PI);
  M4.scale(hm, 0.625, -0.625, -0.625);
  M4.translate(hm, (left ? -2.5 : 2.5) / 16, -0.0625, 0);
  applyDisplay(hm, d, left);
  M4.translate(hm, -0.5, -0.5, -0.5);
  r.drawMesh(vim.mesh, hm, env, lt);
};
Game.prototype.drawHeldItem = function (am, st, left, lt, env, e, dx) {
  const r = this.renderer,
    k = keyOfStack(st),
    def = ITEMS[st.id];
  if (!def) return;
  const using = !!e.usingItem && e.usingItem === st.id && e.useHand === 'off' === left;
  // dx null: am is already a vanilla model's arm (emodel.js), so no conversion into vanilla space
  if (dx !== null) {
    M4.translate(am, dx, 0, 0);
    M4.rotZ(am, Math.PI);
  }
  M4.rotX(am, -Math.PI / 2);
  M4.rotY(am, Math.PI);
  M4.translate(am, (left ? -1 : 1) / 16, 0.125, -0.625);
  if (isSpear(k)) this.spearInHand(am, st, left, e, using);
  const ctx = left ? 'thirdperson_lefthand' : 'thirdperson_righthand';
  if (k === 'shield' || k === 'trident' && !def.tcTool) {
    r.initEquipModels();
    const disp = DISPLAY[k === 'shield' ? using ? 'shield_blocking' : 'shield' : using ? 'trident_throwing' : 'trident'];
    applyDisplay(am, disp[ctx] || disp.thirdperson_righthand, left);
    M4.translate(am, -0.5, -0.5, -0.5);
    M4.scale(am, 1, 1, -1);
    r.drawModel(k === 'shield' ? 'eq_shield' : 'eq_trident', k === 'shield' ? typeof shieldTex === 'function' ? shieldTex(r, st) : r.beTex('shield_base') : r.beTex('trident'), am, null, lt, env, {
      glint: glintOf(st) && 'entity'
    });
    return;
  }
  const b = def.block !== undefined ? BLOCKS[def.block] : null,
    vim = r.itemModel(st.id);
  const flat = vim ? vim.gen || !b && !vim.mesh : !b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door;
  const disp = vim && vim.model && vim.model.display;
  const d = disp && (disp[ctx] || disp.thirdperson_righthand) || (flat ? def.tool || def.attack || def.handheld ? left ? TP_DEFAULT.handheld_left : TP_DEFAULT.handheld : TP_DEFAULT.generated : TP_DEFAULT.block);
  applyDisplay(am, d, left);
  if (flat) {
    M4.translate(am, -0.5, -0.5, 0);
    const stTex = e === this.player ? itemStateTex(st, e) : null;
    this.drawLayers(stTex ? [[T(stTex), null]] : this.itemLayers(st, def, vim, b), am, env, lt, glintOf(st));
  } else {
    M4.translate(am, -0.5, -0.5, -0.5);
    if (vim && vim.mesh) r.drawMesh(vim.mesh, am, env, lt, {
      glint: glintOf(st) && 'item'
    });else if (this.isBEItem(st)) this.drawBEItem(b, am, lt, env);else r.drawMesh(this.blockMesh(def.block, b.facing ? 4 : 0), am, env, lt, {
      glint: glintOf(st) && 'item'
    });
  }
};

// SpearAnimations.thirdPersonAttackItem / thirdPersonUseItem: the spear tipped and pushed along the arm by the stab;
// couched, levelled ahead (turned across the hand), carried forward, swayed and kicked back by a hit
Game.prototype.spearInHand = function (am, st, left, e, using) {
  var _e$spearKickT;
  const a = this.frameA || 0,
    D = Math.PI / 180,
    kw = spearKW(keyOfStack(st)),
    sd = left ? -1 : 1;
  const t = stabBeats(!left && e.swingStab ? attackTime(e, a) : 0);
  if (t.q - t.c) {
    rotAround(am, M4.rotX, -70 * (t.q - t.c) * D, 0, -0.125, 0.125);
    M4.translate(am, 0, kw.forward * (t.q - t.c), 0);
  }
  if (!using) return;
  const u = spearUse(kw, (e.useT || 0) + a),
    r = 1 - EASE.outBack(1 - u.raise),
    hf = e === this.player ? spearKick(this.tickCount - ((_e$spearKickT = e.spearKickT) !== null && _e$spearKickT !== void 0 ? _e$spearKickT : -1e9) + a) : 0;
  M4.translate(am, 0, -hf * 0.4, -kw.forward * (r - u.back) + hf);
  rotAround(am, M4.rotX, -(70 * (u.raise - u.back) - 40 * (t.q - t.c)) * D, 0, -0.03125, 0.125);
  rotAround(am, M4.rotY, sd * 90 * (u.raise - u.sway + 3 * t.c + t.q) * D, 0, 0, 0.125);
};

// ---- icons that move: the compass (toward the world spawn), recovery compass (last death), clock (time of day);
// in the Nether and the End they spin (vanilla's compass / time item properties) ----
function dynamicIconTex(st, p) {
  const k = keyOfStack(st),
    g = p && p.game;
  if (!g || !g.world || !(k === 'compass' || k === 'recovery_compass' || k === 'clock')) return null;
  const now = performance.now(),
    spin = g.dim !== 'overworld';
  if (k === 'clock') {
    // (vanilla's time property: the sun's angle from the time of day - world.time counts ticks from 0 each session)
    const t = spin ? now / 1000 * 0.37 % 1 : g.celestial();
    return 'i_clock_' + String(Math.round(t * 64) % 64).padStart(2, '0');
  }
  const target = k === 'compass' ? g.worldSpawn || p.spawn : g.lastDeath && g.lastDeath.dim === g.dim ? g.lastDeath.pos : null;
  let v;
  if (spin || !target) v = now / 1000 * 0.53 % 1;else {
    const vy = ((180 - p.yaw * 180 / Math.PI) / 360 % 1 + 1) % 1;
    const ang = Math.atan2(target[2] + 0.5 - p.pos[2], target[0] + 0.5 - p.pos[0]) / (2 * Math.PI);
    v = ((0.5 - (vy - 0.25 - ang)) % 1 + 1) % 1;
  }
  return 'i_' + k + '_' + String((16 + Math.round(v * 32)) % 32).padStart(2, '0');
}
const _equipDeath = Game.prototype.onPlayerDeath;
Game.prototype.onPlayerDeath = function (src) {
  this.lastDeath = {
    dim: this.dim,
    pos: this.player.pos.map(Math.floor)
  };
  return _equipDeath.call(this, src);
};
// ---- the use button with two hands (vanilla Minecraft.startUseItem): the main hand first - the aimed entity, the
// aimed block, then the item itself - and the other hand only when that did nothing. Only a block or torch (and a
// shield) of the other hand were ever tried, so its food, bow, crossbow, spear, wind charge, firework or potion did
// nothing ("副手的东西不能用"), and a shield went up before a hoe could till ("拿着盾不能锄地") ----
// fn with the other hand's stack in the selected slot, so every use reads it as the held item (what it used up stays
// used up, a bowl or empty bucket left goes back to the other hand); a use it starts is the other hand's
Game.prototype.withOffhand = function (fn) {
  const p = this.player,
    inv = p.inv,
    sel = inv.sel,
    main = inv.slots[sel];
  inv.slots[sel] = inv.slots[OFF] || null;
  inv.slots[OFF] = main || null;
  if (p.useHand === 'off') p.useHand = 'main';
  // (and the other hand is the one that swings - swingHand: the main hand did, 11-07 feedback)
  p.offSwing = true;
  try {
    return fn();
  } finally {
    p.offSwing = false;
    const left = inv.slots[sel];
    inv.slots[sel] = inv.slots[OFF] || null;
    inv.slots[OFF] = left || null;
    if (p.usingItem && p.useHand === 'main') p.useHand = 'off';
  }
};
Game.prototype.useHands = function () {
  const p = this.player,
    inv = p.inv;
  // what a use changes: a held use, a swing, a screen, the hands' stacks, a new entity (thrown, placed), a boost
  const sig = () => {
    const h = inv.slots[inv.sel],
      o = inv.slots[OFF];
    return [p.usingItem, p.swingN, this.ui.screen, h, h && h.count, h && h.dmg, o, o && o.count, this.entities.length, p.boostT, p.vehicle];
  };
  p.useHand = 'main';
  const before = sig(),
    hd = before[3] && ITEMS[before[3].id];
  this.use();
  if (!inv.slots[OFF] || sig().some((v, i) => v !== before[i])) return;
  // a block the main hand could not put there (someone in the way, no room, no support) failed, it did not pass
  // (vanilla BlockItem.useOn FAIL): the other hand's torch went down under the feet while pillaring
  if (hd && (hd.block !== undefined || hd.places) && this.target && !this.targetEntity) return;
  // (at an entity the other hand has no block to work on)
  const t = this.target;
  if (this.targetEntity) this.target = null;
  try {
    this.withOffhand(() => this.use());
  } finally {
    this.target = t;
  }
};
