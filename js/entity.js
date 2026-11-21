
'use strict';

// ---------------------------------------------------------------------------
// Entities, physics, mobs, particles, explosions
// ---------------------------------------------------------------------------
// World.getBlock / isWaterlogged for a column whose chunk was looked up once (c: undefined when not loaded) - the
// same answers without a map lookup for every block: the entity tick asked ~32 blocks a mob a tick, most of them in
// the column or two it stands in (2026-11-03: ~24 ns a getBlock, ~7 from the chunk in hand)
const chunkOf = (w, x, z) => w.chunks.get(ckey(x >> 4, z >> 4));
function cellB(w, c, x, y, z) {
  return y < 0 ? w.dim === 'end' ? 0 : 6 : y >= HEIGHT ? 0 : c ? c.getB(y << 8 | (z & 15) << 4 | x & 15) : 0;
}
function cellWet(c, x, y, z) {
  return y >= 0 && y < HEIGHT && !!(c && c.wl && c.wl.has(y << 8 | (z & 15) << 4 | x & 15));
}
// World.getBlock with the chunk of column (fx, fz) in hand: from it for a block in the same chunk, else looked up
function blockBy(w, c, fx, fz, x, y, z) {
  return (x ^ fx | z ^ fz) >> 4 ? w.getBlock(x, y, z) : cellB(w, c, x, y, z);
}
// The collision boxes of the blocks in a region (a wall for a column not loaded) into out. The box arrays are out's
// own (out.pool), filled again by its next call: each move made 10-30 new arrays and copied the list - with ~100
// mobs about a third of the entity tick went to allocating and to the map lookups (profiled 2026-11-03). ent: the
// entity they are for, if any (powder snow holds up only some - collide(m, ent, y))
// is the block at x, y, z a full solid cube to collide with (vanilla BlockState.isCollisionShapeFullBlock)
const _fullBoxes = [];
function fullCollisionAt(world, x, y, z) {
  blockBoxes(world, x + 0.01, y + 0.01, z + 0.01, x + 0.99, y + 0.99, z + 0.99, _fullBoxes, null);
  for (const b of _fullBoxes) if (b[0] <= x + 1e-6 && b[1] <= y + 1e-6 && b[2] <= z + 1e-6 && b[3] >= x + 1 - 1e-6 && b[4] >= y + 1 - 1e-6 && b[5] >= z + 1 - 1e-6) return true;
  return false;
}
function blockBoxes(world, x0, y0, z0, x1, y1, z1, out, ent) {
  const pool = out.pool || (out.pool = []);
  let n = 0;
  const ix0 = Math.floor(x0),
    iy0 = Math.floor(y0) - 1,
    iz0 = Math.floor(z0);
  const ix1 = Math.floor(x1),
    iy1 = Math.floor(y1),
    iz1 = Math.floor(z1);
  for (let x = ix0; x <= ix1; x++) for (let z = iz0; z <= iz1; z++) {
    const c = chunkOf(world, x, z);
    if (!c) {
      n = boxPut(out, pool, n, x, -1e3, z, x + 1, 1e3, z + 1);
      continue;
    }
    for (let y = iy0; y <= iy1; y++) {
      const id = cellB(world, c, x, y, z);
      if (!id) continue;
      const b = BLOCKS[id];
      // (a block this page doesn't know - a mod's, the world opened without that mod - 11-13: it threw here every tick)
      if (!b || !b.solid && !b.collide) continue; // (one that isn't solid with a collide still collides - blocks.js)
      if (b.shape === SH_BOXES || b.shape === SH_MODEL) {
        // (the meta from the chunk in hand: World.getMeta looked the chunk up again for every stair, slab, door ...)
        const m = b.fence ? world.fenceMeta(x, y, z, b) : y >= 0 && y < HEIGHT ? c.getM(y << 8 | (z & 15) << 4 | x & 15) : 0;
        for (const bx of b.collide ? b.collide(m, ent, y) : b.boxes(m)) n = boxPut(out, pool, n, x + bx[0] / 16, y + bx[1] / 16, z + bx[2] / 16, x + bx[3] / 16, y + bx[4] / 16, z + bx[5] / 16);
      } else if (b.shape === SH_CACTUS) n = boxPut(out, pool, n, x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 15 / 16, z + 15 / 16); // (vanilla: 15 high - what lands on it is in it)
      else n = boxPut(out, pool, n, x, y, z, x + 1, y + 1, z + 1);
    }
  }
  out.length = n;
  return out;
}
// one box into out at n from out's pool (no new array once the pool has grown; no closure made for each call)
function boxPut(out, pool, n, a0, a1, a2, a3, a4, a5) {
  const a = pool[n] || (pool[n] = [0, 0, 0, 0, 0, 0]);
  a[0] = a0;
  a[1] = a1;
  a[2] = a2;
  a[3] = a3;
  a[4] = a4;
  a[5] = a5;
  out[n] = a;
  return n + 1;
}
const _boxes = [],
  _moveBoxes = [],
  _stepBoxes = [],
  _sightBoxes = [],
  _stepHs = [],
  _stepBox = [0, 0, 0, 0, 0, 0];
// ---- where one can stand (vanilla BlockGetter.getBlockFloorHeight, DismountHelper): out of a bed, off a mount ----
// the top of block x,y,z's collision shape over its bottom: null for none, Infinity where the chunk isn't here.
// climb: ladders, vines ... count as none (DismountHelper.nonClimbableShape)
const _floorBoxes = [];
function cellTop(w, x, y, z, climb) {
  if (!w.isLoaded(x, z)) return Infinity;
  const b = BLOCKS[w.getBlock(x, y, z)];
  if (!b || !b.solid || climb && b.climbable) return null;
  blockBoxes(w, x + 1e-3, y + 1e-3, z + 1e-3, x + 1 - 1e-3, y + 1 - 1e-3, z + 1 - 1e-3, _floorBoxes);
  let top = null;
  for (const bx of _floorBoxes) if (bx[1] >= y - 1e-7 && bx[1] < y + 1 - 1e-7 && (top === null || bx[4] - y > top)) top = bx[4] - y;
  return top;
}
// how high over block x,y,z's bottom one stands in it: its own top, or for an empty one the top of a full-height block
// under it less 1; NaN where that is no floor (DismountHelper.isBlockFloorValid: below 1 - not in a full block)
function blockFloor(w, x, y, z, climb) {
  let f = cellTop(w, x, y, z, climb);
  if (f === null) {
    const b = cellTop(w, x, y - 1, z, climb);
    f = b !== null && b >= 1 ? b - 1 : NaN;
  }
  return f < 1 ? f : NaN;
}
// a player's box (standing, crouching or swimming height h) at x,y,z clear of blocks
function standsFree(e, x, y, z, h) {
  const r = PLAYER_W / 2;
  return !e.collides([x - r, y, z - r, x + r, y + h, z + r]);
}
// vanilla EntityType.isBlockDangerous for a player: burning blocks, wither roses, berry bushes, cacti, powder snow
function dangerBlock(w, x, y, z) {
  const id = w.getBlock(x, y, z),
    b = BLOCKS[id];
  if (!b) return false;
  if (/^(fire|soul_fire|lava|magma_block|lava_cauldron|wither_rose|sweet_berry_bush|cactus|powder_snow)$/.test(b.key)) return true;
  return /campfire$/.test(b.key) && !(typeof Features !== 'undefined' && Features.propOf(id, w.getMeta(x, y, z), 'lit') === 'false');
}
// vanilla DismountHelper.findSafeDismountLocation for a player: standing in block x,y,z (on its floor, room for the
// standing box, not in an end portal); danger: not on or in a dangerous block. null where not
function safeStandAt(e, x, y, z, danger) {
  const w = e.world;
  if (danger && dangerBlock(w, x, y, z)) return null;
  const f = blockFloor(w, x, y, z, true);
  if (!(f < 1)) return null;
  if (danger && f <= 0 && dangerBlock(w, x, y - 1, z)) return null;
  if (!standsFree(e, x + 0.5, y + f, z + 0.5, PLAYER_H.stand)) return null;
  const portal = yy => {
    const b = BLOCKS[w.getBlock(x, yy, z)];
    return !!b && /^end_(portal|gateway)$/.test(b.key);
  };
  return portal(y) || portal(y + 1) ? null : [x + 0.5, y + f, z + 0.5];
}
class Entity {
  constructor(game, x, y, z, w, h) {
    this.game = game;
    this.world = game.world;
    this.pos = [x, y, z];
    this.prev = [x, y, z];
    this.vel = [0, 0, 0];
    this.w = w;
    this.h = h;
    this.yaw = 0;
    this.pitch = 0;
    this.prevYaw = 0;
    this.onGround = false;
    this.collidedH = false;
    this.inWater = false;
    this.inLava = false;
    this.eyeInWater = false;
    this.dead = false;
    this.age = 0;
    this.fallDist = 0;
    this.stepHeight = 0;
    this.id = Entity.nextId++;
  }
  box() {
    const w = this.w / 2;
    return [this.pos[0] - w, this.pos[1], this.pos[2] - w, this.pos[0] + w, this.pos[1] + this.h, this.pos[2] + w];
  }
  savePrev() {
    this.prev[0] = this.pos[0];
    this.prev[1] = this.pos[1];
    this.prev[2] = this.pos[2];
    this.prevYaw = this.yaw;
    this.prevBodyYaw = this.bodyYaw;
  }
  ipos(a) {
    return [lerp(this.prev[0], this.pos[0], a), lerp(this.prev[1], this.pos[1], a), lerp(this.prev[2], this.pos[2], a)];
  }
  collides(bb) {
    blockBoxes(this.world, bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], _boxes, this);
    for (const b of _boxes) if (bb[0] < b[3] && bb[3] > b[0] && bb[1] < b[4] && bb[4] > b[1] && bb[2] < b[5] && bb[5] > b[2]) return true;
    return false;
  }
  static clip(bb, boxes, d, axis) {
    const a = axis,
      o1 = (axis + 1) % 3,
      o2 = (axis + 2) % 3;
    for (const b of boxes) {
      if (bb[o1] >= b[o1 + 3] || bb[o1 + 3] <= b[o1] || bb[o2] >= b[o2 + 3] || bb[o2 + 3] <= b[o2]) continue;
      if (d > 0 && bb[a + 3] <= b[a] + 1e-7) {
        const m = b[a] - bb[a + 3];
        if (m < d) d = m;
      } else if (d < 0 && bb[a] >= b[a + 3] - 1e-7) {
        const m = b[a + 3] - bb[a];
        if (m > d) d = m;
      }
    }
    return d;
  }
  move(dx, dy, dz) {
    if (this.noClip) {
      this.pos[0] += dx;
      this.pos[1] += dy;
      this.pos[2] += dz;
      return;
    }
    // stuck in a block last tick (vanilla makeStuckInBlock: a sweet berry bush): this move slowed by its factors, the
    // speed gone
    const st = this.stuckIn;
    if (st) {
      this.stuckIn = null;
      dx *= st[0];
      dy *= st[1];
      dz *= st[2];
      if (this.vel) this.vel[0] = this.vel[1] = this.vel[2] = 0;
    }
    // sneaking: don't walk off edges
    if (this.sneakEdge && this.onGround && !this.flying) {
      const step = 0.05,
        dx0 = dx,
        dz0 = dz;
      const test = (ddx, ddz) => {
        const b = this.box();
        return this.collides([b[0] + ddx, b[1] - 0.6, b[2] + ddz, b[3] + ddx, b[1], b[5] + ddz]);
      };
      while (dx !== 0 && !test(dx, 0)) {
        if (Math.abs(dx) < step) dx = 0;else dx -= Math.sign(dx) * step;
      }
      while (dz !== 0 && !test(0, dz)) {
        if (Math.abs(dz) < step) dz = 0;else dz -= Math.sign(dz) * step;
      }
      while (dx !== 0 && dz !== 0 && !test(dx, dz)) {
        if (Math.abs(dx) < step) dx = 0;else dx -= Math.sign(dx) * step;
        if (Math.abs(dz) < step) dz = 0;else dz -= Math.sign(dz) * step;
      }
      // (held back at the edge: no speed kept that way - pushing against an edge built some up, and letting go of
      // sneak then carried the player over it)
      if (this.vel) {
        if (dx !== dx0) this.vel[0] = 0;
        if (dz !== dz0) this.vel[2] = 0;
      }
    }
    const ox = dx,
      oy = dy,
      oz = dz;
    const bb = this.box();
    const boxes = blockBoxes(this.world, Math.min(bb[0], bb[0] + dx) - 0.01, Math.min(bb[1], bb[1] + dy) - 0.01, Math.min(bb[2], bb[2] + dz) - 0.01, Math.max(bb[3], bb[3] + dx) + 0.01, Math.max(bb[4], bb[4] + dy) + 0.01, Math.max(bb[5], bb[5] + dz) + 0.01, _moveBoxes, this);
    // boats and minecarts are solid to the player, as vanilla (canBeCollidedWith): one can stand on one - it went through them into
    // the water, "船没有碰撞箱，站上去会沉下去" (feedback 2026-11-01/02). Not to its own rider; a box already overlapped
    // doesn't hold anyone back (clip only stops what comes from outside)
    const nBlock = boxes.length;
    // An adult happy ghast is solid to a player at or above its top (HappyGhast.canBeCollidedWith): one can stand on it
    if (this.game && this === this.game.player && !this.vehicle && typeof Boat !== 'undefined') for (const e of this.game.entities) if (!e.dead && Math.abs(e.pos[0] - bb[0]) < 4 && Math.abs(e.pos[2] - bb[2]) < 4) {
      if ((e instanceof Boat || typeof Minecart !== 'undefined' && e instanceof Minecart) && Math.abs(e.pos[1] - bb[1]) < 4) boxes.push(e.box());else if (typeof HappyGhast !== 'undefined' && e instanceof HappyGhast && !e.baby && e.deathTime === 0 && bb[1] >= e.pos[1] + e.h - 1e-5 && bb[1] - e.pos[1] - e.h < 4) boxes.push(e.box());
    }
    dy = Entity.clip(bb, boxes, dy, 1);
    bb[1] += dy;
    bb[4] += dy;
    dx = Entity.clip(bb, boxes, dx, 0);
    bb[0] += dx;
    bb[3] += dx;
    dz = Entity.clip(bb, boxes, dz, 2);
    bb[2] += dz;
    bb[5] += dz;
    const landed = oy !== dy && oy < 0,
      grounded = this.onGround || landed;
    if (this.stepHeight > 0 && grounded && (dx !== ox || dz !== oz)) {
      // vanilla Entity.collide: from the landed box, try each height a nearby box's bottom or top is at (up to the
      // step height, lowest first) and take the first that gets further. It rose the whole 0.6 first, and from a dirt
      // path or farmland (15/16) into a two-high doorway that put the head into the lintel - nothing stepped up
      const g = this.box();
      if (landed) {
        g[1] += dy;
        g[4] += dy;
      }
      const b2 = blockBoxes(this.world, Math.min(g[0], g[0] + ox) - 0.01, g[1] - 0.01, Math.min(g[2], g[2] + oz) - 0.01, Math.max(g[3], g[3] + ox) + 0.01, g[4] + this.stepHeight + 0.01, Math.max(g[5], g[5] + oz) + 0.01, _stepBoxes, this);
      for (let i = nBlock; i < boxes.length; i++) b2.push(boxes[i]);
      const hs = _stepHs;
      hs.length = 0;
      for (const b of b2) for (let k = 1; k <= 4; k += 3) {
        const h = b[k] - g[1];
        if (h > 1e-7 && h <= this.stepHeight + 1e-7 && !hs.includes(h)) hs.push(h);
      }
      hs.sort((p, q) => p - q);
      const sb = _stepBox;
      for (const h of hs) {
        for (let i = 0; i < 6; i++) sb[i] = g[i];
        const sy = Entity.clip(sb, b2, h, 1);
        sb[1] += sy;
        sb[4] += sy;
        const sx = Entity.clip(sb, b2, ox, 0);
        sb[0] += sx;
        sb[3] += sx;
        const sz = Entity.clip(sb, b2, oz, 2);
        sb[2] += sz;
        sb[5] += sz;
        if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-6) {
          dy = sb[1] - bb[1] + dy;
          for (let i = 0; i < 6; i++) bb[i] = sb[i];
          dx = sx;
          dz = sz;
          this.stepped = true;
          break;
        }
      }
    }
    this.collidedH = Math.abs(dx - ox) > 1e-6 || Math.abs(dz - oz) > 1e-6;
    this.onGround = oy < 0 && Math.abs(dy - oy) > 1e-7 || this.stepped && oy <= 0 && this.onGround;
    this.stepped = false;
    const vy = this.vel[1];
    if (Math.abs(dy - oy) > 1e-7) {
      // landing on a bed bounces back up (vanilla Entity.restituteMovementAfterCollisions, the bed's bounceRestitution
      // 0.75, 0.8 of that for what isn't alive): not when falling slower than its gravity, nor a sneaking player; the
      // gravity of the part of the tick not moved is given back, the air drag taken for the part moved
      const v1 = this.vel[1],
        g = this instanceof Living ? v1 <= 0 && this.effects && this.hasEffect('slow_falling') ? 0.01 : 0.08 : 0.04;
      const bed = oy < 0 && -v1 >= g && !this.sneaking && BLOCKS[this.world.getBlock(Math.floor((bb[0] + bb[3]) / 2), Math.floor(bb[1] - 0.2), Math.floor((bb[2] + bb[5]) / 2))];
      const k = bed && bed.bed ? clamp(dy / oy, 0, 1) : 0;
      this.vel[1] = bed && bed.bed ? (k * g - v1) * (1 - 0.02 * k) * 0.75 * (this instanceof Living ? 1 : 0.8) : 0;
    }
    if (Math.abs(dx - ox) > 1e-7) this.vel[0] = 0;
    if (Math.abs(dz - oz) > 1e-7) this.vel[2] = 0;
    this.pos[0] = (bb[0] + bb[3]) / 2;
    this.pos[1] = bb[1];
    this.pos[2] = (bb[2] + bb[5]) / 2;
    // fall distance
    if (this.onGround) {
      if (this.fallDist > 0) this.onLand(this.fallDist);
      this.fallDist = 0;
    } else if (dy < 0) this.fallDist -= dy;
    // landed on a bouncy block (slime) falling at least a tick's gravity, not sneaking: thrown back up (vanilla
    // Entity.restituteMovementAfterCollisions - the part of the tick's gravity left after the hit made up for; things
    // that aren't alive keep 0.8 of it)
    if (oy < 0 && dy !== oy && dy <= 0 && vy < 0 && !this.sneaking && !this.sneakHeld) {
      const g = this instanceof Living ? this.effects && this.hasEffect('slow_falling') ? 0.01 : 0.08 : 0.04;
      const ub = -vy >= g && BLOCKS[this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]))];
      if (ub && ub.bounce) {
        const f = dy / vy,
          r = ub.bounce * (this instanceof Living ? 1 : 0.8);
        this.vel[1] = (f * g - vy) * (1 + (0.98 - 1) * f) * r;
      }
    }
  }
  onLand(d) {}

  // in a bubble column (World.bubbleColumnAt): pushed up over soul sand, pulled down over magma, like vanilla's
  // Entity.onInsideBubbleColumn - and in its top block (air above) onAboveBubbleColumn, which throws things out
  bubbleColumn() {
    const w = this.world,
      x = Math.floor(this.pos[0]),
      z = Math.floor(this.pos[2]),
      y = Math.floor(this.pos[1] + 0.1);
    const c = w.bubbleColumnAt(x, y, z);
    if (!c) return;
    const v = this.vel,
      top = w.getBlock(x, y + 1, z) === AIR;
    if (top) v[1] = c < 0 ? Math.max(-0.9, v[1] - 0.03) : Math.min(1.8, v[1] + 0.1);else {
      v[1] = c < 0 ? Math.max(-0.3, v[1] - 0.03) : Math.min(0.7, v[1] + 0.06);
      this.fallDist = 0;
    }
  }
  updateFluids() {
    const b = this.box();
    this.inWater = false;
    this.inLava = false;
    const x0 = Math.floor(b[0] + 0.001),
      x1 = Math.floor(b[3] - 0.001),
      y0 = Math.floor(b[1] + 0.001),
      y1 = Math.floor(b[4] - 0.001),
      z0 = Math.floor(b[2] + 0.001),
      z1 = Math.floor(b[5] - 0.001);
    const w = this.world,
      px = Math.floor(this.pos[0]),
      pz = Math.floor(this.pos[2]);
    let cp = null; // (the chunk of its own column, for the eyes: from the loop, which goes through that column)
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const c = chunkOf(w, x, z);
      if (x === px && z === pz) cp = c || 0;
      for (let y = y0; y <= y1; y++) {
        const id = cellB(w, c, x, y, z);
        if (id === WATER || WLOG[id] || id && cellWet(c, x, y, z)) {
          this.inWater = true;
          this.fallDist = 0;
        } else if (id === LAVA || FLUID_MOD[id] === 2) this.inLava = true;else if (FLUID_MOD[id] === 1) {
          this.inWater = true;
          this.fallDist = 0;
        } // (a mod's water-like fluid)
      }
    }
    if (cp === null) cp = chunkOf(w, px, pz);
    // (World.waterAt by the chunk in hand)
    const ey = this.pos[1] + (this.eyeH || this.h * 0.85),
      eyb = Math.floor(ey),
      eid = cellB(w, cp, px, eyb, pz);
    this.eyeInWater = !!(eid === WATER || WLOG[eid] || eid && cellWet(cp, px, eyb, pz)) && ey < eyb + 0.9;
    // (the type's pattern only for one in a fluid: it ran for every entity every tick)
    if (this.vel && !this.remote && (this.inWater || this.inLava) && this.fluidPushed()) {
      if (this.inWater) this.fluidPush(WATER, 0.014, b, x0, x1, y0, y1, z0, z1);
      if (this.inLava) this.fluidPush(LAVA, this.world.dim === 'nether' ? 0.007 : 0.0023333333333333335, b, x0, x1, y0, y1, z0, z1);
    }
  }
  // the current carries things along (Entity.updateFluidHeightAndDoFluidPushing): the flow of the cells it is in,
  // averaged (weaker in the shallows), straight along it for anything but a player, at least 0.0045 a tick from
  // standing; not fish, boats, or a flying player
  // how deep in water its feet are (vanilla getFluidHeight(WATER))
  waterDepth() {
    const w = this.world,
      x = Math.floor(this.pos[0]),
      z = Math.floor(this.pos[2]),
      y0 = Math.floor(this.pos[1]);
    let d = 0;
    for (let y = y0; y <= y0 + 1; y++) {
      const a = w.fluidAmount(WATER, x, y, z);
      if (a <= 0) break;
      d = Math.max(d, y + (w.fluidAmount(WATER, x, y + 1, z) > 0 ? 1 : a / 9) - this.pos[1]);
    }
    return d;
  }
  fluidPushed() {
    return !this.flying && !/^(cod|salmon|pufferfish|tropical_fish|squid|glow_squid|dolphin|tadpole|boat|chest_boat)/.test(this.type || '');
  }
  fluidPush(id, scale, b, x0, x1, y0, y1, z0, z1) {
    const w = this.world;
    let vx = 0,
      vy = 0,
      vz = 0,
      k = 0,
      d0 = 0;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const a = w.fluidAmount(id, x, y, z);
      if (a <= 0) continue;
      const top = y + (w.fluidAmount(id, x, y + 1, z) > 0 ? 1 : a / 9);
      if (top < b[1]) continue;
      d0 = Math.max(top - b[1], d0);
      const f = w.fluidFlow(id, x, y, z),
        s = d0 < 0.4 ? d0 : 1;
      vx += f[0] * s;
      vy += f[1] * s;
      vz += f[2] * s;
      k++;
    }
    let L = Math.hypot(vx, vy, vz);
    if (!(L > 0)) return;
    if (k > 0) {
      vx /= k;
      vy /= k;
      vz /= k;
      L /= k;
    }
    if (this !== this.game.player) {
      vx /= L;
      vy /= L;
      vz /= L;
      L = 1;
    }
    vx *= scale;
    vy *= scale;
    vz *= scale;
    L *= scale;
    const v = this.vel;
    if (Math.abs(v[0]) < 0.003 && Math.abs(v[2]) < 0.003 && L < 0.0045) {
      const m = 0.0045 / L;
      vx *= m;
      vy *= m;
      vz *= m;
    }
    v[0] += vx;
    v[1] += vy;
    v[2] += vz;
  }
  lightAt() {
    const l = this.world.getLight(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.h * 0.5), Math.floor(this.pos[2]));
    return [(l >> 4) / 15, (l & 15) / 15];
  }
  // (the root of the sum, not Math.hypot: ~7 ns against ~17, the same distance to the last bit or so - every mob asks
  // it many times a tick, 3% of the game tick with ~120 mobs, 2026-11-04)
  distTo(e) {
    const dx = this.pos[0] - e.pos[0],
      dy = this.pos[1] - e.pos[1],
      dz = this.pos[2] - e.pos[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
Entity.nextId = 1;

// ---------------------------------------------------------------------------
// Living entities
// ---------------------------------------------------------------------------
const speedFactorOf = b => b && b.slow && b.key !== 'cobweb' ? b.slow : 0;
// a block's jump factor (vanilla getBlockJumpFactor: the one at the feet if it has one, else the one under them; honey 0.5)
const jumpFactorOf = e => {
  const w = e.world,
    x = Math.floor(e.pos[0]),
    z = Math.floor(e.pos[2]),
    f = BLOCKS[w.getBlock(x, Math.floor(e.pos[1]), z)];
  return f && f.jumpFactor ? f.jumpFactor : (BLOCKS[w.getBlock(x, Math.floor(e.pos[1] - 0.5), z)] || {}).jumpFactor || 1;
};
const BERRY_STUCK = [0.8, 0.75, 0.8]; // (vanilla SweetBerryBushBlock.entityInside: makeStuckInBlock)
class Living extends Entity {
  constructor(game, x, y, z, w, h, hp) {
    super(game, x, y, z, w, h);
    this.health = hp;
    this.maxHealth = hp;
    this.hurtTime = 0;
    this.invuln = 0;
    this.deathTime = 0;
    this.fire = 0;
    this.air = 300;
    this.limbSwing = 0;
    this.limbAmt = 0;
    this.bodyYaw = 0;
    this.headYaw = 0;
    this.stepHeight = 0.6;
    this.slowFall = false;
  }
  hurt(amount, source) {
    var _source$knock;
    if (this.dead || this.deathTime > 0) return false;
    if (this.fireproof && source && (source.type === 'fire' || source.type === 'lava')) return false;
    if (this.invuln > 10 && amount <= this.lastDamage) return false;
    const actual = this.invuln > 10 ? amount - this.lastDamage : amount;
    this.lastDamage = amount;
    this.invuln = 20;
    this.hurtTime = 10;
    this.health -= this.reduceDamage ? this.reduceDamage(actual, source) : actual;
    // (no knockback at all - the hop too - when it is all resisted: the warden hopped at every hit, feedback 2026-11-01)
    if (source && source.knockFrom && ((_source$knock = source.knock) !== null && _source$knock !== void 0 ? _source$knock : 0.4) > 0) {
      var _source$knock2;
      const dx = this.pos[0] - source.knockFrom[0],
        dz = this.pos[2] - source.knockFrom[2];
      const d = Math.hypot(dx, dz) || 1,
        k = (_source$knock2 = source.knock) !== null && _source$knock2 !== void 0 ? _source$knock2 : 0.4;
      this.vel[0] = this.vel[0] / 2 + dx / d * k;
      this.vel[2] = this.vel[2] / 2 + dz / d * k;
      if (this.onGround) this.vel[1] = Math.min(0.4, this.vel[1] / 2 + 0.36);
    }
    this.onHurt(source);
    if (this.health <= 0) {
      this.health = 0;
      this.die(source);
    }
    return true;
  }
  onHurt() {}
  die() {
    this.deathTime = 1;
  }
  baseTick() {
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    if (this.impulseGrace > 0) this.impulseGrace--;
    this.updateFluids();
    if (this.inWater) this.bubbleColumn();
    if (this.inLava && !this.fireproof) {
      this.hurt(4, {
        type: 'lava'
      });
      this.fire = 300;
    }
    // (the chunk of its own column, looked up once for the blocks below that are in it - see blockBy)
    const w = this.world,
      fx = Math.floor(this.pos[0]),
      fz = Math.floor(this.pos[2]),
      c0 = chunkOf(w, fx, fz);
    {
      const b0 = this.box();
      this.inWeb = false;
      let berry = 0,
        honey = false;
      const y0 = Math.floor(b0[1]),
        y1 = Math.floor(b0[4] - 0.001);
      for (let x = Math.floor(b0[0]); x <= Math.floor(b0[3] - 0.001); x++) for (let z = Math.floor(b0[2]); z <= Math.floor(b0[5] - 0.001); z++) {
        const c = (x ^ fx | z ^ fz) >> 4 ? chunkOf(w, x, z) : c0;
        for (let y = y0; y <= y1; y++) {
          const id = cellB(w, c, x, y, z);
          if (id === 177) this.inWeb = true;else if ((id === 171 || id && id === BID.soul_fire) && !this.fireproof) {
            if (this.fire < 160) this.fire = 160;
            if (this.age % 10 === 0) this.hurt(id === 171 ? 1 : 2, {
              type: 'fire'
            });
          } else if (id === BID.sweet_berry_bush) berry = Math.max(berry, Features.propOf(id, w.getMeta(x, y, z), 'age') !== '0' ? 2 : 1);
          // sliding down a honey block's side (HoneyBlock.isSlidingDown: in the air, falling, beside it - not on top)
          else if (id === BID.honey_block && !this.onGround && this.pos[1] <= y + 0.9375 - 1e-7 && this.vel[1] / 0.98 + 0.08 < -0.08) {
            const o = 0.4375 + this.w / 2;
            if (Math.abs(x + 0.5 - this.pos[0]) + 1e-7 > o || Math.abs(z + 0.5 - this.pos[2]) + 1e-7 > o) honey = true;
          }
        }
      }
      // a sweet berry bush (vanilla entityInside) holds back whoever is in it - not foxes and bees - and one past its
      // first stage pricks them if they moved last tick (this tick's start against the last's: the player's prev is
      // set just before this, so it never hurt a player - players' feedback 2026-10-31/11-07)
      const lp = this.lastTickPos || (this.lastTickPos = [this.pos[0], this.pos[1], this.pos[2]]);
      // (nothing for a noClip one - spectator, vex, dragon: vanilla isAffectedByBlocks)
      if (berry && this.type !== 'fox' && this.type !== 'bee' && !this.noClip) {
        // (not a flying player: vanilla Player.makeStuckInBlock does nothing then)
        if (!this.flying) {
          this.stuckIn = BERRY_STUCK;
          this.fallDist = 0;
        }
        if (berry === 2 && (Math.abs(this.pos[0] - lp[0]) >= 0.003 || Math.abs(this.pos[2] - lp[2]) >= 0.003)) this.hurt(1, {
          type: 'berry'
        });
      }
      lp[0] = this.pos[0];
      lp[1] = this.pos[1];
      lp[2] = this.pos[2];
      // HoneyBlock.doSlideMovement: down at 0.05 a tick (before gravity), slower sideways when it came in fast
      if (honey) {
        const v = this.vel,
          od = v[1] / 0.98 + 0.08;
        if (od < -0.13) {
          const k = -0.05 / od;
          v[0] *= k;
          v[2] *= k;
        }
        v[1] = (-0.05 - 0.08) * 0.98;
        this.fallDist = 0;
        if (Math.random() < 0.2) Sound.ev('block.honey_block.slide', this.pos, 1, 1);
      }
    }
    // (vanilla tryResetCurrentImpulseContext: a wind charge's impulse is over once its grace has run out and it stands,
    // swims, climbs, glides or is caught in a cobweb - not only at its next landing)
    if (this.impulseY != null && !(this.impulseGrace > 0) && (this.onGround || this.inWater || this.inLava || this.inWeb || this.gliding || this.onLadder(c0, fx, fz))) this.impulseY = null;
    if (this.fireproof) this.fire = 0;
    if (this.fire > 0) {
      this.fire--;
      if (this.inWater) this.fire = 0;else if (this.fire % 20 === 0) this.hurt(1, {
        type: 'fire'
      });
      if (Math.random() < 0.3) this.game.particles.spawn('flame', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + Math.random() * this.h, this.pos[2] + (Math.random() - 0.5) * this.w, 0, 0.02, 0);
    }
    // (the eyes in a bubble column breathe, as vanilla - "气泡柱没氧气", feedback 2026-11-01/02)
    const bubbles = this.eyeInWater && this.world.bubbleColumnAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + (typeof this.eye === 'function' ? this.eye() : this.h * 0.85)), Math.floor(this.pos[2]));
    if (this.eyeInWater && !this.waterBreather && !bubbles) {
      const resp = this.inv ? armorEnch(this, 'respiration', [39]) : 0;
      if (!resp || Math.random() < 1 / (resp + 1)) this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.hurt(2, {
          type: 'drown'
        });
      }
    } else this.air = Math.min(300, this.air + 4);
    // contact damage (cactus, magma): the four sides of the box, 0.3 up (no arrays made for it each tick). (Its position
    // read again: a hurt above may have moved it - blockBy looks up another chunk then)
    {
      const hw = this.w / 2,
        px = this.pos[0],
        pz = this.pos[2],
        cy = Math.floor(this.pos[1] + 0.3);
      if (blockBy(w, c0, fx, fz, Math.floor(px - hw - 0.01), cy, Math.floor(pz)) === 37 || blockBy(w, c0, fx, fz, Math.floor(px + hw + 0.01), cy, Math.floor(pz)) === 37 || blockBy(w, c0, fx, fz, Math.floor(px), cy, Math.floor(pz - hw - 0.01)) === 37 || blockBy(w, c0, fx, fz, Math.floor(px), cy, Math.floor(pz + hw + 0.01)) === 37 || blockBy(w, c0, fx, fz, Math.floor(px), Math.floor(this.pos[1]), Math.floor(pz)) === 37) this.hurt(1, {
        type: 'cactus'
      }); // (or standing on its top)
    }
    if (this.onGround && blockBy(w, c0, fx, fz, Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.1), Math.floor(this.pos[2])) === 103 && !this.sneaking) this.hurt(1, {
      type: 'hotFloor'
    });
    if (this.pos[1] < -40) this.hurt(4, {
      type: 'void'
    });
  }
  onLand(d) {
    if (this.slowFall) return;
    // thrown up by a wind charge (vanilla causeFallDamage with currentImpulseImpactPos): only the fall below where the
    // burst caught it counts - the fall from the top of the jump hurt
    if (this.impulseY != null) {
      d = Math.min(d, this.impulseY - this.pos[1]);
      if (d <= 0 || !(this.impulseGrace > 0)) this.impulseY = null;
    }
    const id = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]));
    // farmland trampled (vanilla FarmlandBlock.fallOn): a fall of d turns it to dirt one time in d - 0.5 under a player,
    // or a mob of 0.8 x 0.8 x 0.8 or more while mob_griefing is on; what grew on it pops off. There was none
    if (id === 63 && !this.game.net && !this.remote && Math.random() < d - 0.5 && this.w * this.w * this.h > 0.512 && (this instanceof Player || !this.game.rule || this.game.rule('mob_griefing') !== false)) {
      const fx = Math.floor(this.pos[0]),
        fy = Math.floor(this.pos[1] - 0.2),
        fz = Math.floor(this.pos[2]);
      this.world.setBlock(fx, fy, fz, 3, 0);
      // (pushed up out of the full block, as pushEntitiesUp)
      for (const e of [this.game.player, ...this.game.entities]) if (e && e.pos[1] >= fy + 0.5 && e.pos[1] < fy + 1 && Math.abs(e.pos[0] - fx - 0.5) < 0.5 + e.w / 2 && Math.abs(e.pos[2] - fz - 0.5) < 0.5 + e.w / 2) {
        e.pos[1] = fy + 1;
        if (e.prev) e.prev[1] = Math.max(e.prev[1], fy + 1);
      }
      if (this.game.flushMesh) this.game.flushMesh();
    }
    if (d > 1.5 && id && BLOCKS[id].shape !== SH_LIQUID) {
      const n = Math.min(30, Math.floor(d * 3));
      for (let i = 0; i < n; i++) this.game.particles.spawn('block', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + 0.1, this.pos[2] + (Math.random() - 0.5) * this.w, (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.1, (Math.random() - 0.5) * 0.3, {
        id,
        meta: 0,
        tint: this.game.blockTintAt(Math.floor(this.pos[0]), Math.floor(this.pos[2]), id, 0)
      });
      if (d > 3) Sound.block('step', BLOCKS[id].sound, this.pos);
    }
    const jb = this.effects ? this.effectAmp('jump_boost') + 1 : 0;
    if (id && BLOCKS[id].bed) d *= 0.5; // (vanilla BedBlock.fallOn: half the fall)
    // the water looked at again first (vanilla LivingEntity.checkFallDamage): a fall that went into shallow or flowing
    // water and reached its floor in the same tick still had the dry state of the tick before - it hurt
    if (!this.inWater && d > 3.0 + jb) this.updateFluids();
    // a stalagmite's tip: the fall counts 2.5 blocks more, twice over (PointedDripstoneBlock.fallOn - it did nothing)
    const fm = id && BLOCKS[id].key === 'pointed_dripstone' && typeof Features !== 'undefined' ? this.world.getMeta(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2])) : -1;
    const spike = fm >= 0 && Features.propOf(id, fm, 'thickness') === 'tip' && Features.propOf(id, fm, 'vertical_direction') === 'up';
    // the block's share of the damage (vanilla fallOn): honey a fifth; slime and powder snow none
    const B = BLOCKS[id],
      mul = !B ? 1 : B.key === 'honey_block' ? 0.2 : B.bounce || B.key === 'powder_snow' ? 0 : 1;
    const dmg = spike ? Math.floor((d - 0.5 - jb) * 2 + 1e-6) : Math.ceil((d - 3 - jb) * mul);
    if ((spike || d > 3.0 + jb) && dmg > 0 && !this.inWater && id !== 87 && mul > 0) {
      this.impulseY = null;
      this.hurt(dmg, {
        type: 'fall'
      });
      // vanilla causeFallDamage: the small / big fall sound (a player's own), then the landing block's fall sound -
      // it was the block's break sound (players' feedback 2026-10-31)
      Sound.ev((this === this.game.player ? 'entity.player.' : 'entity.generic.') + (dmg > 4 ? 'big_fall' : 'small_fall'), this.pos, 1, 1);
      if (BLOCKS[id]) Sound.block('fall', BLOCKS[id].sound, this.pos);
    }
  }
  // MC-like movement physics; fwd/strafe in [-1,1] relative to yaw
  travel(fwd, strafe, speed, jump) {
    const v = this.vel;
    if (this.inWeb) {
      v[0] *= 0.25;
      v[2] *= 0.25;
      v[1] *= 0.05;
      this.fallDist = 0;
    }
    if (this.inWater || this.inLava) {
      // vanilla: water drag 0.8 (0.9 while sprinting), vertical drag 0.8, sinking 0.005/tick;
      // lava drag 0.5 and gravity 0.02
      const water = this.inWater;
      let drag = water ? this.sprinting ? 0.9 : 0.8 : 0.5,
        acc = 0.02 * (this.waterSpeed || 1);
      // depth strider (water_movement_efficiency, half off the ground): drag and push move toward walking's
      if (water && this.waterEfficiency) {
        let h = this.waterEfficiency();
        if (!this.onGround) h *= 0.5;
        if (h > 0) {
          drag += (0.54600006 - drag) * h;
          acc += (speed - acc) * h;
        }
      }
      this.accel(fwd, strafe, acc);
      if (this.swimming && water) {
        // swimming: rise and dive along the view direction
        const ly = Math.sin(this.pitch),
          k = ly < -0.2 ? 0.085 : 0.06;
        const headWater = this.world.waterAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.9), Math.floor(this.pos[2]));
        if (ly <= 0 || jump || headWater) v[1] += (ly - v[1]) * k;
      } else if (jump) v[1] += 0.04;
      this.move(v[0], v[1], v[2]);
      if (water) {
        v[0] *= drag;
        v[1] *= 0.8;
        v[2] *= drag;
        if (!this.sprinting) v[1] = Math.abs(v[1] - 0.005) < 0.003 && v[1] <= 0 ? -0.003 : v[1] - 0.005;
      } else {
        v[0] *= drag;
        v[1] *= drag;
        v[2] *= drag;
        v[1] -= 0.02;
      }
      if (this.collidedH && jump) {
        const b = this.box();
        if (!this.collides([b[0] + v[0], b[1] + 0.6, b[2] + v[2], b[3] + v[0], b[4] + 0.6, b[5] + v[2]])) v[1] = 0.3;
      }
      return;
    }
    // (the four blocks asked below are in its column, before and after the move: its chunk looked up once - blockBy)
    const w = this.world,
      fx = Math.floor(this.pos[0]),
      fz = Math.floor(this.pos[2]),
      c0 = chunkOf(w, fx, fz);
    const below = cellB(w, c0, fx, Math.floor(this.pos[1] - 0.5), fz);
    const slip = this.onGround ? BLOCKS[below] ? BLOCKS[below].slip : 0.6 : 1;
    const fr = this.onGround ? slip * 0.91 : 0.91;
    const a = this.onGround ? speed * (0.21600002 / (slip * slip * slip)) : this.airSpeed || 0.02;
    this.accel(fwd, strafe, a);
    if (this.onLadder(c0, fx, fz)) {
      v[0] = clamp(v[0], -0.15, 0.15);
      v[2] = clamp(v[2], -0.15, 0.15);
      v[1] = Math.max(v[1], -0.15);
      if (this.sneaking && v[1] < 0) v[1] = 0;
      this.fallDist = 0;
    }
    this.move(v[0], v[1], v[2]);
    if (this.onLadder(c0, fx, fz) && (this.collidedH || jump)) v[1] = 0.2;
    // levitation lifts; slow falling falls with an eighth of the gravity (effects.js)
    const lev = this.effects ? this.effectAmp('levitation') : -1,
      slowFx = this.effects && this.hasEffect('slow_falling');
    if (lev >= 0) {
      v[1] += (0.05 * (lev + 1) - v[1]) * 0.2;
      this.fallDist = 0;
    } else {
      v[1] -= slowFx && v[1] <= 0 ? 0.01 : 0.08;
      v[1] *= 0.98;
    }
    if (slowFx) this.fallDist = 0;
    if (this.slowFall && v[1] < -0.1) {
      v[1] = -0.1;
      this.fallDist = 0;
    }
    v[0] *= fr;
    v[2] *= fr;
    // the block's speed factor (vanilla getBlockSpeedFactor: the one the feet are in if it has one, else the one under
    // them - once; soul sand 0.4), not with soul speed's movement efficiency
    if (this.onGround && !this.flying && !this.soulSpeedOn) {
      const feet = BLOCKS[blockBy(w, c0, fx, fz, Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.01), Math.floor(this.pos[2]))];
      const f = speedFactorOf(feet) || speedFactorOf(BLOCKS[below]); // (a cobweb slows by inWeb)
      if (f) {
        v[0] *= f;
        v[2] *= f;
      }
    }
    // walking on slime, not bouncing (SlimeBlock.stepOn): sticky, not when sneaking
    if (this.onGround && !this.sneaking && Math.abs(v[1]) < 0.1) {
      const on = BLOCKS[blockBy(w, c0, fx, fz, Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]))];
      if (on && on.bounce) {
        const s = 0.4 + Math.abs(v[1]) * 0.2;
        v[0] *= s;
        v[2] *= s;
      }
    }
  }
  accel(fwd, strafe, a) {
    let l = fwd * fwd + strafe * strafe;
    if (l < 1e-4) return;
    l = Math.sqrt(l);
    if (l < 1) l = 1;
    fwd *= a / l;
    strafe *= a / l;
    const s = Math.sin(this.yaw),
      c = Math.cos(this.yaw);
    this.vel[0] += -s * fwd + c * strafe;
    this.vel[2] += -c * fwd - s * strafe;
  }
  // (c, fx, fz: the chunk of a column in hand - travel's - for blockBy)
  onLadder(c, fx, fz) {
    const x = Math.floor(this.pos[0]),
      y = Math.floor(this.pos[1]),
      z = Math.floor(this.pos[2]);
    const id = fx === undefined ? this.world.getBlock(x, y, z) : blockBy(this.world, c, fx, fz, x, y, z);
    return id && BLOCKS[id].climbable;
  }
  animate() {
    const dx = this.pos[0] - this.prev[0],
      dz = this.pos[2] - this.prev[2];
    const sp = Math.min(1, Math.hypot(dx, dz) * 4);
    this.limbAmt += (sp - this.limbAmt) * 0.4;
    this.limbSwing += this.limbAmt;
  }
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
class Inventory {
  constructor() {
    this.slots = new Array(41).fill(null);
    this.sel = 0;
  } // 0-35, armour 36-39, offhand 40
  get held() {
    return this.slots[this.sel];
  }
  // (slots: a shift-click's own order - inventory slots only, never the offhand - for both passes)
  add(stack, slots) {
    if (!stack) return 0;
    // (an item this game doesn't have is not taken - whoever offered it drops it, and dropItem lets it go: one in the
    // inventory broke the hand, the hotbar and every use each tick, "interaction / render: reading 'tool' / 'block'",
    // telemetry 11-02/03)
    if (!ITEMS[stack.id] || !(stack.count > 0)) {
      const f = knownStack(stack, null, 'inventory');
      if (!f) return stack.count > 0 ? stack.count : 0;
      stack = f;
    }
    let n = stack.count;
    const ms = maxStack(stack.id);
    const order = slots || [];
    if (!slots) for (let i = 0; i < 36; i++) order.push(i);
    // onto a stack of it: the selected slot's, the offhand's, then the rest (vanilla getSlotWithRemainingSpace - picked
    // up torches went into the inventory past the offhand's)
    for (const i of slots ? order : [this.sel, 40, ...order]) {
      const s = this.slots[i];
      if (s && sameKind(s, stack) && s.count < ms && !ITEMS[s.id].durability) {
        const k = Math.min(n, ms - s.count);
        s.count += k;
        n -= k;
        if (!n) return 0;
      }
    }
    for (const i of order) {
      if (!this.slots[i]) {
        const k = Math.min(n, ms);
        this.slots[i] = {
          ...stack,
          count: k,
          dmg: stack.dmg || 0
        };
        n -= k;
        if (!n) return 0;
      }
    }
    return n;
  }
  count(id) {
    let n = 0;
    for (let i = 0; i < 36; i++) if (this.slots[i] && this.slots[i].id === id) n += this.slots[i].count;
    return n;
  }
  remove(id, n) {
    for (let i = 0; i < 36 && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(n, s.count);
        s.count -= k;
        n -= k;
        if (!s.count) this.slots[i] = null;
      }
    }
  }
  armorPoints() {
    let p = 0;
    for (let i = 36; i < 40; i++) {
      const s = this.slots[i];
      if (s && ITEMS[s.id].armor) p += ITEMS[s.id].armor.points;
    }
    return p;
  }
  armorToughness() {
    let t = 0;
    for (let i = 36; i < 40; i++) {
      const s = this.slots[i];
      if (s && ITEMS[s.id].armor) t += ITEMS[s.id].armor.tough || 0;
    }
    return t;
  }
  toJSON() {
    return {
      slots: this.slots,
      sel: this.sel
    };
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const PLAYER_W = Math.fround(0.6),
  PLAYER_H = {
    stand: Math.fround(1.8),
    crouch: Math.fround(1.5),
    swim: Math.fround(0.6)
  };
class Player extends Living {
  constructor(game, x, y, z) {
    // (vanilla's sizes are floats - 0.6F wide, 1.8F tall: half a width is 0.30000001192…, and a player pressed
    // against a wall stands where vanilla's would. With exactly 0.3 the box ended 1e-8 inside the wall by the
    // server's sums, and the server pulled the player back every tick - bug 3)
    super(game, x, y, z, PLAYER_W, PLAYER_H.stand, 20);
    this.eyeH = 1.62;
    this.inv = new Inventory();
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.foodTimer = 0;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.spawn = [x, y, z];
    this.bob = 0;
    this.prevBob = 0;
    this.bobAmt = 0;
    this.swingT = 0;
    this.useT = 0;
    this.xp = 0;
    this.distWalked = 0;
  }
  // LivingEntity.swing: restarts only when idle or past half of the 6-tick swing
  swing() {
    if (this.swingT <= 3) this.swingT = 6;
  }
  get creative() {
    return this.game.mode === 'creative' || this.game.mode === 'spectator';
  }
  get spectator() {
    return this.game.mode === 'spectator';
  }
  // (asleep: vanilla's sleeping pose has the eyes 0.2 up - they were a standing player's, in the block two above the
  // bed, and a block there choked the player awake: "睡觉扣血", "刚躺下就被弹起", feedback 11-03..11)
  eye() {
    return this.game && this.game.sleeping && this === this.game.player ? 0.2 : this.pose === 'swim' ? 0.4 : this.sneaking && !this.flying ? 1.27 : 1.62;
  }
  reduceDamage(a, src) {
    if (this.creative && src && src.type !== 'void') return 0;
    // protection enchantments (they also work on falls, fire and drowning): 4% per point, at most 80%
    const epf = protectionPoints(this, src);
    if (src && ['fall', 'drown', 'starve', 'void', 'fire'].includes(src.type)) return a * (1 - epf / 25);
    const armor = this.inv.armorPoints();
    if (armor) {
      const wear = Math.max(1, Math.floor(a / 4));
      for (let i = 36; i < 40; i++) {
        const s = this.inv.slots[i];
        if (!s || !ITEMS[s.id].durability) continue;
        let n = 0;
        for (let k = 0; k < wear; k++) if (!unbreakingSkips(s, true)) n++;
        s.dmg = (s.dmg || 0) + n;
        if (s.dmg >= ITEMS[s.id].durability) {
          this.inv.slots[i] = null;
          Sound.ev('entity.item.break', this.pos, 0.8, 0.8 + Math.random() * 0.4);
        }
      }
    }
    // vanilla's CombatRules: toughness keeps more of the armour against big hits
    const tough = this.inv.armorToughness(),
      eff = clamp(armor - 4 * a / (tough + 8), armor * 0.2, 20);
    return a * (1 - eff / 25) * (1 - epf / 25);
  }
  hurt(a, src) {
    if (this.spectator || this.creative && (!src || src.type !== 'void')) return false;
    if (this.game.gameOver) return false;
    // vanilla difficulty scaling for damage caused by mobs (melee, projectiles, explosions)
    if (src && src.attacker && src.attacker !== this && src.attacker.T) {
      const d = this.game.difficulty;
      if (d === 0) return false;
      if (d === 1) a = Math.min(a / 2 + 1, a);else if (d === 3) a = a * 3 / 2;
    }
    const r = super.hurt(a, src);
    if (r) {
      this.exhaust(0.1);
      Sound.hurt(null);
      this.game.onPlayerHurt(src);
    }
    const th = r && src && src.attacker && src.attacker !== this && src.type === 'mob' ? armorEnch(this, 'thorns') : 0;
    if (th && Math.random() < 0.15 * th) src.attacker.hurt(th > 10 ? th - 10 : 1 + Math.floor(Math.random() * 4), {
      type: 'thorns',
      attacker: this,
      knockFrom: this.pos
    });
    return r;
  }
  die(src) {
    super.die(src);
    this.game.onPlayerDeath(src);
  }
  exhaust(x) {
    if (!this.creative) this.exhaustion += x;
  }
  // the held item's upkeep: attack cool-down, how far the hand is lowered (also while riding)
  handsTick() {
    var _this$handH;
    if (this.xpDelay > 0) this.xpDelay--;
    // attack cool-down ticker (reset when switching items)
    const hid = this.inv.held ? this.inv.held.id : -1;
    if (hid !== this.lastHeldId) {
      this.lastHeldId = hid;
      this.attackT = 0;
    } else this.attackT = (this.attackT || 0) + 1;
    // vanilla ItemInHandRenderer: the hand follows the attack cool-down (f^3, at most 0.4 per tick), so after a
    // swing the weapon dips and rises again at the item's attack speed; a new item is swapped in once lowered
    const f = this.game.attackStrength(1);
    this.oHandH = (_this$handH = this.handH) !== null && _this$handH !== void 0 ? _this$handH : 1;
    if (this.handItem === undefined) this.handItem = hid;
    this.handH = this.oHandH + clamp((this.handItem === hid ? f * f * f : 0) - this.oHandH, -0.4, 0.4);
    if (this.handH < 0.1) this.handItem = hid;
  }
  // hunger, regeneration and the arm's swing (also while riding)
  hungerTick() {
    const cr = this.creative;
    // hunger (on a server its own: food, saturation and health come from it - counted here as well, the food bar
    // went down where the server keeps it full, a minigame's lobby and games, 11-07)
    if (!cr && !this.game.net) {
      // vanilla peaceful: regenerate health every second and food every half second
      if (this.game.difficulty === 0) {
        if (this.age % 20 === 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);
        if (this.age % 10 === 0 && this.food < 20) this.food++;
      }
      if (this.exhaustion >= 4) {
        this.exhaustion -= 4;
        if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);else this.food = Math.max(0, this.food - 1);
      }
      this.foodTimer++;
      if (this.food >= 18 && this.health < this.maxHealth) {
        if (this.foodTimer >= (this.saturation > 0 && this.food === 20 ? 10 : 80)) {
          this.health = Math.min(this.maxHealth, this.health + 1);
          this.exhaust(6);
          this.foodTimer = 0;
        }
      } else if (this.food <= 0) {
        if (this.foodTimer >= 80) {
          const d = this.game.difficulty;
          if (this.health > 10 || d === 3 || this.health > 1 && d === 2) this.hurt(1, {
            type: 'starve'
          });
          this.foodTimer = 0;
        }
      } else this.foodTimer = 0;
      // (not topped up below the world: the void hurts creative players too, and refilled every tick they never died -
      // players' feedback 2026-10-31)
    } else {
      this.food = 20;
      if (this.pos[1] >= -40) this.health = this.maxHealth;
      this.air = 300;
      this.fire = 0;
    }
    if (this.swingT > 0) this.swingT--;
  }
  tick(input) {
    this.savePrev();
    this.baseTick();
    if (this.deathTime > 0) {
      this.deathTime++;
      return;
    }
    const cr = this.creative;
    if (!cr && this.flying) this.flying = false;
    // (shift held, also while flying - no crouch pose then: vanilla isShiftKeyDown keeps slime from bouncing)
    this.sneakHeld = !!input.sneak;
    // vanilla swimming: start by sprinting with the eyes under water, keep it while sprinting in water
    const eyeWater = this.world.waterAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.eye()), Math.floor(this.pos[2]));
    if (this.flying) this.swimming = false;else if (this.swimming) this.swimming = this.sprinting && this.inWater;else this.swimming = this.sprinting && eyeWater && this.inWater && input.fwd > 0;
    // pose: swim (also used to crawl through 1-block gaps), crouch, stand
    // (a door closed on the player doesn't count: it put them into the crawling pose - "开关门被挤趴下", feedback
    // 2026-11-01/02; they walk out of it as before)
    const fits = h => {
      const oh = this.h;
      this.h = h;
      const bb = this.box();
      this.h = oh;
      blockBoxes(this.world, bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], _boxes);
      for (const b of _boxes) {
        if (!(bb[0] < b[3] && bb[3] > b[0] && bb[1] < b[4] && bb[4] > b[1] && bb[2] < b[5] && bb[5] > b[2])) continue;
        const d = BLOCKS[this.world.getBlock(Math.floor((b[0] + b[3]) / 2), Math.floor((b[1] + b[4]) / 2), Math.floor((b[2] + b[5]) / 2))];
        if (d && d.door) continue;
        return false;
      }
      return true;
    };
    let pose = 'stand';
    if (this.spectator) {
      this.flying = true;
      this.noClip = true;
      this.swimming = false;
    } else if (this.swimming) pose = 'swim';else if (this.gliding && !this.glideFlip) pose = 'swim'; // gliding: vanilla's fall-flying pose is the swimming one's size (0.6, eyes at 0.4)
    else if (input.sneak && !this.flying && fits(PLAYER_H.crouch)) pose = 'crouch';else if (!this.noClip && !fits(PLAYER_H.stand)) pose = fits(PLAYER_H.crouch) ? 'crouch' : 'swim';
    this.pose = pose;
    this.handsTick();
    // vanilla swimAmount: eases in/out by 0.09 per tick
    this.prevSwimAmt = this.swimAmt || 0;
    this.swimAmt = clamp(this.prevSwimAmt + (pose === 'swim' ? 0.09 : -0.09), 0, 1);
    this.crawling = pose === 'swim' && !this.swimming;
    this.sneaking = pose === 'crouch';
    this.sneakEdge = this.sneaking;
    this.h = PLAYER_H[pose];
    // sprinting
    const canSprint = cr || this.food > 6;
    if (input.sprint && input.fwd > 0 && canSprint && !this.sneaking && !this.crawling) this.sprinting = true;
    if (input.fwd <= 0 || this.collidedH && !this.swimming || !canSprint || this.sneaking || this.crawling) this.sprinting = false;
    // (movement speed 0.1, sprinting x1.3; soul speed adds to it - enchant.js)
    const sp = (0.1 + (this.speedBonus ? this.speedBonus() : 0)) * (this.sprinting ? 1.3 : 1) * effectSpeedFactor(this);
    let fwd = input.fwd * 0.98,
      str = input.strafe * 0.98;
    if (this.sneaking || this.crawling) {
      const k = this.sneakSpeed ? this.sneakSpeed() : 0.3;
      fwd *= k;
      str *= k;
    }
    if (this.useT > 0 && this.usingItem && !(ITEMS[this.usingItem] && /_spear$/.test(ITEMS[this.usingItem].key))) {
      fwd *= 0.2;
      str *= 0.2;
    }
    this.airSpeed = this.sprinting ? 0.026 : 0.02;
    this.slowFall = false;
    if (this.flying) {
      const v = this.vel;
      this.accel(fwd, str, this.sprinting ? 0.1 : 0.05);
      let ty = 0;
      if (input.jump) ty += 0.375;
      if (input.sneak) ty -= 0.375;
      v[1] += (ty - v[1]) * 0.4;
      this.move(v[0], v[1], v[2]);
      v[0] *= 0.91;
      v[2] *= 0.91;
      v[1] *= 0.6;
      if (this.onGround && input.sneak && !this.spectator) this.flying = false;
      this.fallDist = 0;
    } else {
      if (input.jump && this.onGround && !this.inWater && !this.inLava) {
        this.vel[1] = 0.42 * jumpFactorOf(this) + effectJumpBoost(this); // (honey: half)
        if (this.sprinting) {
          this.vel[0] += -Math.sin(this.yaw) * 0.2;
          this.vel[2] += -Math.cos(this.yaw) * 0.2;
          this.exhaust(0.2);
        } else this.exhaust(0.05);
        this.jumpT = 0;
      }
      const wasGround = this.onGround;
      this.travel(fwd, str, sp, input.jump);
      // auto-jump: walking into a one-block step with room above jumps on its own
      // (not again while already going up: the tick after one it fired once more - up 1.67 blocks, over fences and walls,
      // "人能跳过栅栏", feedback 2026-11-01/02)
      if (this.game.settings.autoJump && wasGround && this.vel[1] <= 0 && this.collidedH && (input.fwd || input.strafe) && !this.sneaking && !this.inWater) {
        const yaw = this.yaw,
          dx = -Math.sin(yaw) * input.fwd + Math.cos(yaw) * input.strafe,
          dz = -Math.cos(yaw) * input.fwd - Math.sin(yaw) * input.strafe;
        const l = Math.hypot(dx, dz) || 1,
          r = this.w / 2 + 0.3;
        // (the layer the step is on, from feet that may stand high in their block - a dirt path or farmland is 15/16:
        // the block below the step was taken for the step and nothing jumped, players' feedback 2026-10-31)
        const bx = Math.floor(this.pos[0] + dx / l * r),
          bz = Math.floor(this.pos[2] + dz / l * r),
          by = Math.floor(this.pos[1] + 0.5);
        const solid = y => {
          const b = BLOCKS[this.world.getBlock(bx, y, bz)];
          return b && b.solid;
        };
        // (only a step a jump clears - vanilla's auto-jump won't try a fence or wall, 1.5 high)
        blockBoxes(this.world, bx + 0.01, by + 0.01, bz + 0.01, bx + 0.99, by + 0.99, bz + 0.99, _boxes);
        let top = by;
        for (const b of _boxes) if (b[0] < bx + 1 && b[3] > bx && b[2] < bz + 1 && b[5] > bz) top = Math.max(top, b[4]);
        if (solid(by) && !solid(by + 1) && !solid(by + 2) && top <= by + 1.01) {
          this.vel[1] = 0.42 * jumpFactorOf(this);
          this.exhaust(0.05);
        }
      }
    }
    // walking distance & footsteps
    const dx = this.pos[0] - this.prev[0],
      dz = this.pos[2] - this.prev[2];
    if (this.sprinting && this.onGround && !this.inWater) {
      const bid = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]));
      if (bid && BLOCKS[bid].shape !== SH_LIQUID) this.game.particles.spawn('block', this.pos[0] + (Math.random() - 0.5) * 0.6, this.pos[1] + 0.1, this.pos[2] + (Math.random() - 0.5) * 0.6, -dx * 2, 0.15, -dz * 2, {
        id: bid,
        meta: this.world.getMeta(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2])),
        tint: this.game.blockTintAt(Math.floor(this.pos[0]), Math.floor(this.pos[2]), bid, this.world.getMeta(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2])))
      });
    }
    const dist = Math.hypot(dx, dz);
    if (this.onGround && !this.flying) {
      this.distWalked += dist;
      if (this.sprinting) this.exhaust(0.1 * dist);
      if (this.distWalked > 1.7 && !this.sneaking) {
        this.distWalked = 0;
        const id = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.2), Math.floor(this.pos[2]));
        if (id && BLOCKS[id]) Sound.block('step', BLOCKS[id].sound, [this.pos[0], this.pos[1], this.pos[2]]);
      }
    } else if (this.inWater) {
      // vanilla Entity.applyMovementEmissionAndPlaySound: 0.6 x the distance across (not up and down - bobbing at the
      // top counted, and every 1.2 blocks: too often), a swim sound each 1 of it (~1.7 blocks); waterSwimSound's volume
      this.swimDist = (this.swimDist || 0) + dist * 0.6;
      if (this.swimDist > 1) {
        this.swimDist = 0;
        const v = this.vel;
        Sound.ev('entity.player.swim', null, Math.min(1, Math.sqrt(v[0] * v[0] * 0.2 + v[1] * v[1] + v[2] * v[2] * 0.2) * 0.35), 1 + (Math.random() - Math.random()) * 0.4);
      }
    }
    // view bobbing
    this.prevBob = this.bob;
    this.prevBobAmt = this.bobAmt;
    const target = this.onGround && !this.flying ? Math.min(0.1, dist) : 0;
    this.bobAmt += (target - this.bobAmt) * 0.4;
    this.bob += dist;
    this.hungerTick();
    this.animate();
  }
}

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------
// mobs at home in water (they don't avoid it)
const WATER_MOBS = /^(cod|salmon|pufferfish|tropical_fish|squid|glow_squid|dolphin|axolotl|turtle|frog|tadpole|drowned|guardian|elder_guardian|nautilus|zombie_nautilus)$/;
// the zombie and skeleton kinds have no FloatGoal in vanilla: in water they sink and walk the bottom (creepers,
// spiders, witches, endermen and the animals swim up). Here they rose to the top like the rest (115 -> 127 in 300
// ticks) - one source of the "monsters on the sea by day" reports (11-03). Now they go down at vanilla's 0.025 a tick
// (265 -> 257.6 in 300 ticks, 2026-11-04). (husks, strays and the other kinds drawn by vmobs.js move by VMob.moveBy)
const SINKING_MOBS = /^(zombie|zombie_villager|husk|drowned|giant|skeleton|stray|bogged|parched|wither_skeleton|zombified_piglin)$/;
// the undead breathe under water (vanilla tag can_breathe_under_water: #undead) - sunk, they drowned in 15 s
const UNDEAD_MOBS = /^(zombie|zombie_villager|husk|drowned|zombified_piglin|zombie_horse|zombie_nautilus|camel_husk|skeleton|stray|bogged|parched|wither_skeleton|skeleton_horse|phantom|wither|zoglin)$/;
// the nearest a zombie goes for besides players (vanilla Zombie's target goals): villagers and wandering traders even
// behind walls, iron golems in sight, baby turtles on land
function zombiePrey(m) {
  let best = null,
    bd = 16;
  for (const e of m.game.entities) {
    if (e === m || e.dead || e.deathTime || !(e instanceof Living)) continue;
    const vil = e.type === 'villager' || e.type === 'wandering_trader';
    if (!vil && e.type !== 'iron_golem' && !(e.type === 'turtle' && e.baby && !e.inWater)) continue;
    const d = m.distTo(e);
    if (d < bd && (vil || m.canSee(e))) {
      best = e;
      bd = d;
    }
  }
  return best;
}
// A cell's path type as vanilla WalkNodeEvaluator.getPathTypeFromState, coarsely: 0 open, 1 blocked (fences, walls,
// doors, rails, leaves and cocoa too: each walkable on top), 2 water, 3 lava or fire (magma, lit campfires), 4 hurts
// (cactus, berry bush, wither rose, dripstone), 5 the rest (trapdoors, lily pads, big dripleaf, honey, powder snow).
// Open: no collision, or one of the low or thin solid blocks vanilla lets a path through (isPathfindable LAND; slabs,
// stairs, farmland, paths, chests and the like say no)
const PATH_OPEN_SOLID = /carpet$|candle$|^(ladder|scaffolding|daylight_detector|turtle_egg|pitcher_crop|item_frame|glow_item_frame)$/;
const PATH_TYPE = new Int8Array(MAX_BLOCKS).fill(-1); // (by id; -2: by its state)
function pathTypeOf(id) {
  const b = BLOCKS[id],
    k = b && b.key || '';
  if (!b) return 1;
  if (IS_FLUID[id]) return id === LAVA || FLUID_MOD[id] === 2 ? 3 : 2;
  if (b.waterlogged) return 2;
  if (/^(fire|soul_fire|magma_block|lava_cauldron)$/.test(k)) return 3;
  if (/^(cactus|sweet_berry_bush|wither_rose|pointed_dripstone|sulfur_spike)$/.test(k)) return 4;
  if (b.trapdoor || /trapdoor$|^(lily_pad|big_dripleaf|honey_block|powder_snow)$/.test(k)) return 5;
  if (/campfire$/.test(k) || b.gate) return -2;
  if (b.solid ? !PATH_OPEN_SOLID.test(k) : /rail$|^cocoa$/.test(k)) return 1;
  return 0;
}
function pathTypeAt(w, x, y, z) {
  const id = w.getBlock(x, y, z);
  if (!id) return 0;
  let t = PATH_TYPE[id];
  if (t === -1) t = PATH_TYPE[id] = pathTypeOf(id);
  if (t === -2) {
    const s = BLOCKS[id].states && BLOCKS[id].states[w.getMeta(x, y, z)];
    if (!BLOCKS[id].gate) return s && s.lit === 'true' ? 3 : 1;
    if (!s || s.open !== 'true') return 1;
    t = 0;
  }
  return t === 0 && w.isWaterlogged(x, y, z) ? 2 : t;
}
// vanilla getPathTypeStatic(...) === WALKABLE: the cell open, the one below blocked, and no water, lava, fire or
// harmful plant in the ring of cells around it, a level below to one above (checkNeighbourBlocks)
function walkableAt(w, x, y, z) {
  if (pathTypeAt(w, x, y, z) !== 0 || pathTypeAt(w, x, y - 1, z) !== 1) return false;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue;
    for (let dy = -1; dy <= 1; dy++) {
      const t = pathTypeAt(w, x + dx, y + dy, z + dz);
      if (t >= 2 && t <= 4) return false;
    }
  }
  return true;
}
const MOB_TYPES = {
  pig: {
    cn: '猪',
    hp: 10,
    w: 0.9,
    h: 0.9,
    speed: 0.25,
    model: 'pig',
    passive: true,
    food: 'carrot',
    drops: [['porkchop', 1, 3, 'cooked_porkchop']],
    scale: 1
  },
  cow: {
    cn: '牛',
    hp: 10,
    w: 0.9,
    h: 1.4,
    speed: 0.2,
    model: 'cow',
    passive: true,
    food: 'wheat',
    drops: [['beef', 1, 3, 'cooked_beef'], ['leather', 0, 2]],
    scale: 1
  },
  sheep: {
    cn: '羊',
    hp: 8,
    w: 0.9,
    h: 1.3,
    speed: 0.23,
    model: 'sheep',
    passive: true,
    food: 'wheat',
    drops: [['mutton', 1, 2, 'cooked_mutton']],
    scale: 1
  },
  chicken: {
    cn: '鸡',
    hp: 4,
    w: 0.4,
    h: 0.7,
    speed: 0.25,
    model: 'chicken',
    passive: true,
    food: 'wheat_seeds',
    drops: [['chicken', 1, 1, 'cooked_chicken'], ['feather', 0, 2]],
    scale: 1
  },
  zombie: {
    cn: '僵尸',
    hp: 20,
    w: 0.6,
    h: 1.95,
    speed: 0.23,
    model: 'zombie',
    hostile: true,
    attack: 3,
    armor: 2,
    burns: true,
    drops: [['rotten_flesh', 0, 2]],
    scale: 0.9375
  },
  skeleton: {
    cn: '骷髅',
    hp: 20,
    w: 0.6,
    h: 1.99,
    speed: 0.25,
    model: 'skeleton',
    hostile: true,
    burns: true,
    ranged: true,
    drops: [['bone', 0, 2], ['arrow', 0, 2]],
    scale: 0.9375
  },
  creeper: {
    cn: '苦力怕',
    hp: 20,
    w: 0.6,
    h: 1.7,
    speed: 0.25,
    model: 'creeper',
    hostile: true,
    drops: [['gunpowder', 0, 2]],
    scale: 1
  },
  spider: {
    cn: '蜘蛛',
    hp: 16,
    w: 1.4,
    h: 0.9,
    speed: 0.3,
    model: 'spider',
    hostile: true,
    attack: 2,
    climbs: true,
    drops: [['string', 0, 2]],
    scale: 1
  }
};
class Mob extends Living {
  constructor(game, type, x, y, z) {
    const T = MOB_TYPES[type];
    super(game, x, y, z, T.w, T.h, T.hp);
    this.type = type;
    this.T = T;
    this.fireproof = !!T.fireproof;
    this.yaw = Math.random() * Math.PI * 2;
    this.bodyYaw = this.yaw;
    this.target = null;
    this.wander = null;
    this.wanderT = 0;
    this.panic = 0;
    this.attackCd = 0;
    this.fuse = -1;
    this.prevFuse = -1;
    this.sheared = false;
    this.woolColor = 0;
    this.persistent = !!T.passive;
    this.idleSound = 100 + Math.random() * 300;
    this.stuck = 0;
    this.eggT = 6000 + Math.random() * 6000;
    this.waterSpeed = 1.5;
    this._seeAge = -1;
    this._seeOf = null;
    this._see = false; // (sees)
    if (UNDEAD_MOBS.test(type)) this.waterBreather = true;
    if (type === 'chicken') this.slowFall = true;
    if (type === 'sheep') {
      const r = Math.random();
      this.woolColor = r < 0.05 ? 15 : r < 0.1 ? 7 : r < 0.15 ? 8 : r < 0.18 ? 12 : r < 0.182 ? 6 : 0;
    }
  }
  hurt(a, src) {
    // natural armour (vanilla's zombies 2): 4% less a point; breach on the attacker's mace takes 15% of it off a level
    if (this.T.armor && a > 0 && !(src && (src.type === 'void' || src.bypass))) {
      const br = src && src.attacker && src.attacker.inv && typeof enchLevel === 'function' ? enchLevel(src.attacker.inv.held, 'breach') : 0;
      a *= 1 - Math.min(20, this.T.armor) * Math.max(0, 1 - 0.15 * br) / 25;
    }
    const r = super.hurt(a, src);
    if (r) {
      // (the blow that kills: the death sound, like vanilla - it was the hurt sound again)
      Sound.mob(this.type, this.health <= 0 ? 'death' : 'hurt', this.pos);
      if (this.T.passive) this.panic = 100;
      if (src && src.attacker && !this.T.passive) this.target = src.attacker;
      if (this.type === 'spider' && src && src.attacker) this.target = src.attacker;
    }
    return r;
  }
  die(src) {
    super.die(src);
    if (src && (src.attacker === this.game.player || src.player)) this.game.stats.kills++;
    const r = Math.random;
    if (!this.baby) for (const [k, mn, mx, cooked] of this.T.drops) {
      const n = mn + Math.floor(r() * (mx - mn + 1)) + (src && src.looting ? Math.floor(r() * (src.looting + 1)) : 0);
      if (n > 0) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack(this.fire > 0 && cooked ? cooked : k, n));
    }
    if (this.type === 'sheep' && !this.sheared) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack(woolKey(this.woolColor), 1));
    if (this.type === 'creeper' && src && src.type === 'arrow' && Math.random() < 0.2) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('tnt', 1));
    this.game.onMobKilled(this, src);
  }
  deathTick() {
    if (this.deathTime <= 0) return false;
    this.deathTime++;
    if (this.T.flying) this.move(0, -0.05, 0);else this.travel(0, 0, 0, false);
    if (this.deathTime > 20) {
      this.dead = true;
      for (let i = 0; i < 12; i++) this.game.particles.spawn('poof', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + Math.random() * this.h, this.pos[2] + (Math.random() - 0.5) * this.w, (Math.random() - 0.5) * 0.1, Math.random() * 0.1, (Math.random() - 0.5) * 0.1);
      if (this.onRemoved) this.onRemoved();
    }
    return true;
  }
  tick() {
    this.savePrev();
    this.baseTick();
    if (this.deathTick()) return;
    const g = this.game,
      p = g.player,
      T = this.T;
    let fwd = 0,
      jump = false,
      mod = 1,
      strafe = 0;
    let lookAt = null;
    const dP = this.distTo(p);
    const day = (T.burns || this.type === 'spider') && g.isDay(); // (only those two ask - it was worked out for every mob)
    // despawn hostiles far away
    if (!this.persistent && (dP > 100 || dP > 40 && this.age > 600 && Math.random() < 0.001)) {
      this.dead = true;
      return;
    }
    // burn in daylight
    if (T.burns && day && !this.inWater && this.age % 20 === 0) {
      const sky = this.world.skyAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.h), Math.floor(this.pos[2]));
      if (sky >= 15 && g.weather < 0.5) this.fire = Math.max(this.fire, 160);
    }
    if (dP < 32 && Sound.warmMob) Sound.warmMob(this.type);
    if (--this.idleSound < 0) {
      this.idleSound = 200 + Math.random() * 400;
      if (dP < 20) Sound.mob(this.type, 'idle', this.pos);
    }
    if (this.attackCd > 0) this.attackCd--;
    const playerOk = p.deathTime === 0 && !p.creative;
    if (T.hostile) {
      // vanilla NearestAttackableTargetGoal / HurtByTargetGoal (mustSee): a player is picked out only in sight, and a
      // target is let go after 3 s out of sight (TargetGoal.unseenMemoryTicks, 60) - zombies took up a player through
      // walls and kept him as long as he was near
      // (a zombie after a villager turns to a player it sees: the player's goal comes first)
      if (this.type === 'spider' && day && !this.target) {} else if ((!this.target || this.target === this.prey) && playerOk && dP < seenWithin(p, 16) && this.sees(p)) this.target = p;
      if (this.target && (this.target.dead || this.target.deathTime > 0 || this.target === p && (!playerOk || dP > 24) || this.target !== p && this.distTo(this.target) > 24)) this.target = null;
      if (this.type === 'spider' && day && this.target && !this.provoked && this.age % 100 === 0) this.target = null;
      // vanilla Zombie: villagers and wandering traders (seen or not), iron golems in sight, baby turtles on land
      if (!this.target && (this.type === 'zombie' || this.type === 'zombie_villager') && (this.age + this.id) % 10 === 0) this.target = this.prey = zombiePrey(this);
      // (unseenT starts again with every new target - the target's setter)
      const t0 = this.target;
      if (t0) {
        if (t0 === this.prey && (t0.type === 'villager' || t0.type === 'wandering_trader') || this.sees(t0)) this.unseenT = 0;else if (++this.unseenT > 60) this.target = null;
      }
    }
    if (this.target) {
      const t = this.target;
      const dx = t.pos[0] - this.pos[0],
        dz = t.pos[2] - this.pos[2],
        d = Math.hypot(dx, dz);
      const want = Math.atan2(-dx, -dz);
      lookAt = t;
      if (T.ranged) {
        this.turnTo(want, 0.3);
        // vanilla RangedBowAttackGoal: walks up until within 15 blocks and in sight for a second, then strafes round the
        // target - turning about or the other way now and then, backing off within 7.5 and coming on past 13 (it only
        // walked straight to 10 and backed off under 5)
        const seen = this.sees(t);
        this.seeT = seen ? Math.max(0, this.seeT || 0) + 1 : Math.min(0, this.seeT || 0) - 1;
        if (d <= 15 && this.seeT >= 20) {
          var _this$strafeT;
          this.strafeT = ((_this$strafeT = this.strafeT) !== null && _this$strafeT !== void 0 ? _this$strafeT : -1) + 1;
          if (this.strafeT >= 20) {
            if (Math.random() < 0.3) this.strafeCw = !this.strafeCw;
            if (Math.random() < 0.3) this.strafeBack = !this.strafeBack;
            this.strafeT = 0;
          }
          if (d > 13) this.strafeBack = false;else if (d < 7.5) this.strafeBack = true;
          fwd = this.strafeBack ? -0.5 : 0.5;
          strafe = this.strafeCw ? 0.5 : -0.5;
        } else {
          fwd = 1;
          this.strafeT = -1;
        }
        if (this.attackCd <= 0 && d < 16 && seen) {
          this.shoot(t);
          this.attackCd = 40 + Math.floor(Math.random() * 20);
        }
      } else if (this.type === 'creeper') {
        this.turnTo(want, 0.4);
        // vanilla SwellGoal: lit within 3 blocks of a target it sees, it swells on while that one stays within 7 and in
        // sight, and back down otherwise - out of sight it went on and blew up behind the wall
        const dt = this.distTo(t);
        if (dt < 3 && this.sees(t)) {
          if (this.fuse < 0) {
            this.fuse = 0;
            Sound.fuse(this.pos);
          }
        } else if (this.fuse >= 0 && !this.ignited && (dt > 7 || !this.sees(t))) this.fuse = Math.max(-1, this.fuse - 2);
        if (this.fuse < 0) fwd = 1;
      } else {
        var _this$jumpFromY;
        this.turnTo(want, 0.4);
        fwd = 1;
        if (this.type === 'spider' && this.onGround && d < 4 && d > 1.5 && Math.random() < 0.1) {
          this.vel[1] = 0.4;
          this.vel[0] += dx / d * 0.3;
          this.vel[2] += dz / d * 0.3;
        }
        // (in height the two bodies must overlap, as vanilla's attack box: a mob is as tall as it stands - one jumping at
        // a pillar counts from where it jumped. A 3-high pillar is safe from an iron golem again: "铁傀儡跳起来打我")
        const reach = this.w / 2 + t.w / 2 + 0.6,
          base = Math.min(this.pos[1], (_this$jumpFromY = this.jumpFromY) !== null && _this$jumpFromY !== void 0 ? _this$jumpFromY : this.pos[1]);
        if (d < reach && t.pos[1] < base + this.h && t.pos[1] + t.h > base && this.attackCd <= 0) {
          this.attackCd = 20;
          this.swingT = 6;
          this.hitLanded = t.hurt(T.attack, {
            type: 'mob',
            attacker: this,
            knockFrom: this.pos
          });
        }
      }
    } else if (this.panic > 0) {
      this.panic--;
      mod = 1.6;
      if (!this.wander || this.wanderT <= 0 || this.age % 20 === 0) this.pickWander(6);
    } else {
      // follow player holding food
      const held = p.inv.held;
      if (T.passive && held && T.food && held.id === item(T.food) && dP < 8 && dP > 2) {
        lookAt = p;
        this.turnTo(Math.atan2(-(p.pos[0] - this.pos[0]), -(p.pos[2] - this.pos[2])), 0.3);
        fwd = 1;
      } else {
        // vanilla LookAtPlayerGoal: a 2% chance a tick to start, then it keeps looking 40-79 ticks while the player stays
        // in range (it looked for that one tick only and the head turned straight back - cows, pigs, sheep hardly moved it)
        if (!(this.lookT > 0) && dP < 8 && Math.random() < 0.02) this.lookT = 40 + Math.floor(Math.random() * 40);
        if (this.lookT > 0) {
          if (dP < 8) {
            this.lookT--;
            lookAt = p;
          } else this.lookT = 0;
        }
      }
    }
    // (SwellGoal with no target: back down too - one lit at a player who then went creative, died or got away blew up
    // all the same, 2026-11-04 review)
    if (this.fuse >= 0 && !this.target && this.type === 'creeper' && !this.ignited) this.fuse = Math.max(-1, this.fuse - 2); // (lit by flint and steel: on to the end)
    if (this.creeperTick()) return;
    // in water: up (vanilla FloatGoal) - not the zombie and skeleton kinds, which sink
    const sinks = this.inWater && SINKING_MOBS.test(this.type);
    // fallen in: make for dry land (one sunk to the bottom looks for it by the water's top, a few blocks over its head)
    if (!this.target && this.inWater && this.landMob && !this.wander && this.age % 10 === 0) this.pickWander(12, sinks ? this.waterTop() : undefined);
    if (!this.target && fwd === 0) {
      if (this.wander) {
        this.wanderT--;
        const dx = this.wander[0] - this.pos[0],
          dz = this.wander[2] - this.pos[2];
        if (Math.hypot(dx, dz) < 0.8 || this.wanderT <= 0) this.wander = null;else {
          this.turnTo(Math.atan2(-dx, -dz), 0.25);
          fwd = 1;
        }
      } else if (Math.random() < (this.panic > 0 ? 1 : 0.008)) this.pickWander(10);
    }
    // strafing (skeletons): vanilla MoveControl.strafe only steps where the path type is WALKABLE (walkableAt: not off
    // any edge, nor into water, fire or a cactus, nor next to them); elsewhere it walks straight at its target instead
    if (strafe) {
      const s = Math.sin(this.yaw),
        c = Math.cos(this.yaw),
        mx = -s * fwd + c * strafe,
        mz = -c * fwd - s * strafe,
        ml = Math.hypot(mx, mz) || 1,
        r = this.w / 2 + 0.5;
      const fx = Math.floor(this.pos[0] + mx / ml * r),
        fz = Math.floor(this.pos[2] + mz / ml * r),
        fy = Math.floor(this.pos[1]);
      if (!walkableAt(this.world, fx, fy, fz)) {
        fwd = 1;
        strafe = 0;
      }
    }
    // obstacle avoidance: don't walk off cliffs or into lava
    if (fwd > 0) {
      const ax = this.pos[0] - Math.sin(this.yaw) * (this.w / 2 + 0.5),
        az = this.pos[2] - Math.cos(this.yaw) * (this.w / 2 + 0.5);
      const fx = Math.floor(ax),
        fz = Math.floor(az),
        fy = Math.floor(this.pos[1]),
        cf = chunkOf(this.world, fx, fz); // (one column: its chunk once)
      let drop = 0,
        under = cellB(this.world, cf, fx, fy - 1, fz);
      while (drop < 5 && !BLOCKS[under].solid && !IS_FLUID[under]) {
        drop++;
        under = cellB(this.world, cf, fx, fy - 1 - drop, fz);
      }
      const danger = under === LAVA || cellB(this.world, cf, fx, fy, fz) === LAVA;
      // (on land, a land mob doesn't stroll into water; chasing something or following food it may)
      const wet = !this.target && this.landMob && !this.inWater && !!this.wander && (this.world.waterAt(fx, fy, fz) || this.world.waterAt(fx, fy - 1 - drop, fz));
      if (danger || wet || drop > 3 && !this.target) {
        fwd = 0;
        this.wander = null;
      }
      if (this.collidedH && this.onGround && !this.noJump) jump = true;
      if (this.collidedH && T.climbs) {
        this.vel[1] = 0.2;
        this.fallDist = 0;
      }
    }
    // (a wall in the way all climb in water, their way up the shore)
    if (this.inWater && (this.collidedH || this.vel[1] < 0.02 && !sinks)) jump = true;
    // stuck detection
    if (fwd > 0 && Math.hypot(this.pos[0] - this.prev[0], this.pos[2] - this.prev[2]) < 0.01) {
      if (++this.stuck > 30) {
        this.yaw += (Math.random() - 0.5) * 2;
        this.stuck = 0;
        this.wander = null;
      }
    } else this.stuck = 0;
    // (on the bottom under water a jump is the swim's push alone - LivingEntity.aiStep jumps from the ground only with
    // the water at the feet under 0.4 deep: the sunk ones leapt two blocks at every step)
    if (jump && this.onGround && !(sinks && this.waterDepth() > 0.4)) {
      this.vel[1] = 0.42;
      this.jumpFromY = this.pos[1];
    } else if (this.onGround) this.jumpFromY = undefined;
    const speed = T.speed * T.speed * mod * (this.fuse >= 0 ? 0.4 : 1);
    this.travel(fwd, strafe, speed, jump);
    // body/head rotation
    let d = this.yaw - this.bodyYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.bodyYaw += d * 0.3;
    if (lookAt) {
      const dx = lookAt.pos[0] - this.pos[0],
        dz = lookAt.pos[2] - this.pos[2];
      let hy = Math.atan2(-dx, -dz) - this.bodyYaw;
      while (hy > Math.PI) hy -= Math.PI * 2;
      while (hy < -Math.PI) hy += Math.PI * 2;
      this.headYaw += (clamp(hy, -1.2, 1.2) - this.headYaw) * 0.3;
      const dy = lookAt.pos[1] + (lookAt.eyeH || 1) - (this.pos[1] + this.h * 0.85);
      this.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.8, 0.8);
    } else {
      this.headYaw *= 0.9;
      this.pitch *= 0.9;
    }
    // chickens lay eggs
    if (this.type === 'chicken' && --this.eggT < 0) {
      this.eggT = 6000 + Math.random() * 6000;
      this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], makeStack('egg', 1));
      Sound.pop(this.pos);
    }
    // sheep eat grass to regrow wool
    if (this.type === 'sheep' && this.sheared && Math.random() < 0.002) {
      const bx = Math.floor(this.pos[0]),
        by = Math.floor(this.pos[1] - 0.5),
        bz = Math.floor(this.pos[2]);
      if (this.world.getBlock(bx, by, bz) === 2) {
        this.world.setBlock(bx, by, bz, 3, 0);
        this.sheared = false;
        this.eatT = 40;
      }
    }
    if (this.eatT > 0) this.eatT--;
    if (this.loveT > 0) {
      this.loveT--;
      if (this.age % 10 === 0) this.game.particles.spawn('heart', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + this.h, this.pos[2] + (Math.random() - 0.5) * this.w, 0, 0.02, 0);
    }
    if (this.baby && --this.growT <= 0) {
      this.baby = false;
      this.w = this.T.w;
      this.h = this.T.h;
    }
    if (this.swingT > 0) this.swingT--;
    this.animate();
  }
  makeBaby() {
    this.baby = true;
    this.growT = 6000;
    this.w = this.T.w * 0.5;
    this.h = this.T.h * 0.5;
    return this;
  }
  creeperTick() {
    if (this.type !== 'creeper' || this.fuse < 0) {
      this.prevFuse = this.fuse;
      return false;
    }
    this.prevFuse = this.fuse;
    this.fuse++;
    if (this.fuse >= 30) {
      this.dead = true;
      // (vanilla's explodeCreeper goes off at the feet: in water the water there takes the blast and no block breaks.
      // It went off 0.8 up with no word of the water, above the surface of the water it floated in: 12-14 blocks of the
      // wall beside it, 11-03 16:56; tested 2026-11-04 floating 1.5 from a stone wall 6-8 -> 0. The water in the cell
      // of its feet, not anywhere in its box: one on the shore with a side in the water breaks blocks, as in vanilla.
      // Floating, it bobs with its feet at the top of the water's cell, a fifth of the ticks just above it - vanilla's
      // float keeps them under: the water right below counts then. Still 0.8 up: game.explode measures the hurt from
      // the body's middle, not from the feet as vanilla - at the feet a creeper hurt 1-4 less than vanilla's (33 24 16 10
      // 5 -> 29 22 15 9 4 at 1-5 blocks) and its craters on dry ground changed (stone 26-30 -> 7-9), 2026-11-04 review)
      const w = this.world,
        fx = Math.floor(this.pos[0]),
        fz = Math.floor(this.pos[2]);
      const wet = w.waterAt(fx, Math.floor(this.pos[1]), fz) || !this.onGround && w.waterAt(fx, Math.floor(this.pos[1] - 0.2), fz);
      this.game.explode(this.pos[0], this.pos[1] + 0.8, this.pos[2], 3, this, wet, false, true);
      return true;
    }
    return false;
  }
  turnTo(a, rate) {
    let d = a - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += clamp(d, -rate, rate);
  }
  // land mobs keep out of water (vanilla WaterAvoidingRandomStrollGoal / LandRandomPos): they stroll only to dry
  // ground - none found, they stay put - and one that fell in heads for the nearest dry ground; water mobs don't care
  get landMob() {
    return !WATER_MOBS.test(this.type || '') && !this.flies && !(typeof FlyingMob !== 'undefined' && this instanceof FlyingMob);
  }
  dryGround(x, y0, z) {
    const w = this.world,
      fx = Math.floor(x),
      fz = Math.floor(z);
    for (let y = y0 + 2; y >= y0 - 4; y--) {
      var _BLOCKS$w$getBlock;
      const b = BLOCKS[w.getBlock(fx, y - 1, fz)];
      if (!b || !b.solid || (_BLOCKS$w$getBlock = BLOCKS[w.getBlock(fx, y, fz)]) !== null && _BLOCKS$w$getBlock !== void 0 && _BLOCKS$w$getBlock.solid) continue;
      return w.waterAt(fx, y, fz) || w.waterAt(fx, y - 1, fz) || w.getBlock(fx, y, fz) === LAVA ? null : y;
    }
    return null;
  }
  // the first cell above the water it is in (its column, 32 blocks at most)
  waterTop() {
    const w = this.world,
      x = Math.floor(this.pos[0]),
      z = Math.floor(this.pos[2]);
    let y = Math.floor(this.pos[1]);
    for (let k = 0; k < 32 && w.waterAt(x, y, z); k++) y++;
    return y;
  }
  pickWander(r, y0 = Math.floor(this.pos[1])) {
    const land = this.landMob;
    for (let i = 0; i < (land ? 10 : 1); i++) {
      const a = Math.random() * Math.PI * 2,
        d = 3 + Math.random() * r,
        x = this.pos[0] + Math.sin(a) * d,
        z = this.pos[2] + Math.cos(a) * d;
      const y = land ? this.dryGround(x, y0, z) : y0;
      if (y === null) continue;
      this.wander = [x, y, z];
      this.wanderT = 120;
      return true;
    }
    return false;
  }
  // vanilla hasLineOfSight (ClipContext.Block.COLLIDER): eye to eye, every block the line goes through, stopped where
  // it meets a block's collision boxes - glass, panes, leaves, a closed door stop it; a fence or a bottom slab below
  // the line doesn't. It looked at a point every half block and only full opaque cubes stopped it: mobs saw through
  // glass and doors, and between two points past a corner. A clear 12-block line 0.48 us (it was 0.91), 2026-11-04
  canSee(t) {
    // (eye to eye: the target's by its pose - a player sneaking or swimming - or 0.85 of its height as vanilla's default;
    // a mob's was taken at 1 high)
    const w = this.world,
      ax = this.pos[0],
      ay = this.pos[1] + (this.eyeH || this.h * 0.85),
      az = this.pos[2];
    const dx = t.pos[0] - ax,
      dy = t.pos[1] + (typeof t.eye === 'function' ? t.eye() : t.eyeH || t.h * 0.85) - ay,
      dz = t.pos[2] - az;
    if (dx * dx + dy * dy + dz * dz > 16384) return false; // (128 blocks at most)
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0,
      sy = dy > 0 ? 1 : dy < 0 ? -1 : 0,
      sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const ix = 1 / dx,
      iy = 1 / dy,
      iz = 1 / dz;
    let x = Math.floor(ax),
      y = Math.floor(ay),
      z = Math.floor(az);
    // (the line's fraction where it next crosses into the cell beyond, on each axis)
    let tx = sx > 0 ? (x + 1 - ax) * ix : sx < 0 ? (x - ax) * ix : Infinity,
      ty = sy > 0 ? (y + 1 - ay) * iy : sy < 0 ? (y - ay) * iy : Infinity,
      tz = sz > 0 ? (z + 1 - az) * iz : sz < 0 ? (z - az) * iz : Infinity;
    const stx = Math.abs(ix),
      sty = Math.abs(iy),
      stz = Math.abs(iz);
    for (let n = 0; n < 512; n++) {
      const B = BLOCKS[w.getBlock(x, y, z)];
      if (B && B.solid) {
        if (B.shape === SH_CUBE) return false;
        // (its own boxes only - y + 1 to y + 0.5 is the one cell, blockBoxes reaching one down)
        for (const b of blockBoxes(w, x, y + 1, z, x + 0.5, y + 0.5, z + 0.5, _sightBoxes)) {
          let t0 = 0,
            t1 = 1;
          if (sx === 0) {
            if (ax <= b[0] || ax >= b[3]) continue;
          } else {
            let u = (b[0] - ax) * ix,
              v = (b[3] - ax) * ix;
            if (u > v) {
              const k = u;
              u = v;
              v = k;
            }
            if (u > t0) t0 = u;
            if (v < t1) t1 = v;
          }
          if (sy === 0) {
            if (ay <= b[1] || ay >= b[4]) continue;
          } else {
            let u = (b[1] - ay) * iy,
              v = (b[4] - ay) * iy;
            if (u > v) {
              const k = u;
              u = v;
              v = k;
            }
            if (u > t0) t0 = u;
            if (v < t1) t1 = v;
          }
          if (sz === 0) {
            if (az <= b[2] || az >= b[5]) continue;
          } else {
            let u = (b[2] - az) * iz,
              v = (b[5] - az) * iz;
            if (u > v) {
              const k = u;
              u = v;
              v = k;
            }
            if (u > t0) t0 = u;
            if (v < t1) t1 = v;
          }
          if (t0 < t1) return false;
        }
      }
      if (tx <= ty && tx <= tz) {
        if (tx > 1) break;
        x += sx;
        tx += stx;
      } else if (ty <= tz) {
        if (ty > 1) break;
        y += sy;
        ty += sty;
      } else {
        if (tz > 1) break;
        z += sz;
        tz += stz;
      }
    }
    return true;
  }
  // canSee once a tick for the same one (the target's memory, the creeper's swell and the shot all ask)
  sees(t) {
    if (this._seeAge !== this.age || this._seeOf !== t) {
      this._seeAge = this.age;
      this._seeOf = t;
      this._see = this.canSee(t);
    }
    return this._see;
  }
  shoot(t) {
    const sx = this.pos[0],
      sy = this.pos[1] + 1.5,
      sz = this.pos[2];
    const dx = t.pos[0] - sx,
      dz = t.pos[2] - sz,
      dist = Math.hypot(dx, dz);
    const dy = t.pos[1] + 1.2 - sy + dist * 0.2 * 0.5;
    const l = Math.hypot(dx, dy, dz);
    const sp = 1.6,
      err = 0.08;
    const a = new Arrow(this.game, sx, sy, sz, [dx / l * sp + (Math.random() - 0.5) * err, dy / l * sp + (Math.random() - 0.5) * err, dz / l * sp + (Math.random() - 0.5) * err], this);
    this.game.addEntity(a);
    Sound.bow(this.pos);
    this.swingT = 6;
  }
  pose(a) {
    const swing = lerp(this.limbSwing - this.limbAmt, this.limbSwing, a) * 0.6662,
      amt = this.limbAmt;
    const l = Math.cos(swing) * 1.4 * amt,
      r = Math.cos(swing + Math.PI) * 1.4 * amt;
    const P = {
      head: {
        ry: this.headYaw,
        rx: this.pitch
      }
    };
    switch (this.T.model) {
      case 'zombie':
      case 'skeleton':
        {
          const raise = this.type === 'zombie' ? Math.PI / 2 + Math.sin(this.age * 0.067) * 0.05 : this.target ? Math.PI / 2 : 0;
          P.rarm = {
            rx: raise + (this.type === 'zombie' ? 0 : r * 0.5) + (this.swingT > 0 ? Math.sin(this.swingT / 6 * Math.PI) * 0.6 : 0)
          };
          P.larm = {
            rx: raise + (this.type === 'zombie' ? Math.sin(this.age * 0.067 + 1) * 0.05 : l * 0.5)
          };
          P.rleg = {
            rx: l
          };
          P.lleg = {
            rx: r
          };
          // a skeleton after something holds its bow up and draws: vanilla HumanoidModel's BOW_AND_ARROW pose, both arms
          // aimed with the head (yRot -0.1 / 0.5 and xRot -pi/2 plus the head's, negated in this model's space)
          if (this.type === 'skeleton' && this.target) {
            P.rarm = {
              ry: 0.1 + this.headYaw,
              rx: Math.PI / 2 + this.pitch,
              zx: true
            };
            P.larm = {
              ry: -0.5 + this.headYaw,
              rx: Math.PI / 2 + this.pitch,
              zx: true
            };
          }
          break;
        }
      case 'creeper':
        P.leg0 = {
          rx: l
        };
        P.leg1 = {
          rx: r
        };
        P.leg2 = {
          rx: r
        };
        P.leg3 = {
          rx: l
        };
        break;
      case 'chicken':
        {
          P.leg0 = {
            rx: l
          };
          P.leg1 = {
            rx: r
          };
          const flap = this.onGround ? 0 : Math.sin(this.age * 1.5) * 0.8 + 0.8;
          P.wing0 = {
            rz: -flap
          };
          P.wing1 = {
            rz: flap
          };
          break;
        }
      case 'spider':
        {
          // vanilla SpiderModel: the right legs' yRot / zRot (front to hind) and its walk, mirrored for the left legs; in
          // this model's space yRot is negated and the order is vanilla's (zx). The front legs turned backwards and the
          // hind ones forwards before, so they crossed
          const Y = [-Math.PI / 4, -Math.PI / 8, Math.PI / 8, Math.PI / 4],
            Z = [-Math.PI / 4, -0.58119464, -0.58119464, -Math.PI / 4];
          const PH = [Math.PI * 1.5, Math.PI / 2, Math.PI, 0];
          for (let i = 0; i < 8; i++) {
            const right = i % 2 === 0,
              row = i >> 1,
              s = right ? 1 : -1;
            const sw = -Math.cos(swing * 2 + PH[row]) * 0.4 * amt,
              st = Math.abs(Math.sin(swing + PH[row]) * 0.4) * amt;
            P['leg' + i] = {
              ry: -s * (Y[row] + sw),
              rz: s * (Z[row] + st),
              zx: true
            };
          }
          break;
        }
      default:
        P.leg0 = {
          rx: l
        };
        P.leg1 = {
          rx: r
        };
        P.leg2 = {
          rx: r
        };
        P.leg3 = {
          rx: l
        };
        if (this.type === 'sheep' && this.eatT > 0) P.head.rx = -0.9;
    }
    return P;
  }
}
// vanilla Player.canBeSeenAsEnemy: a player in creative or spectator mode is no mob's enemy - nothing picks them out,
// hits back at them (wolves, bees, piglins, golems ...), or keeps chasing one who switched to creative. A new target
// starts the out-of-sight count again (vanilla TargetGoal.start: unseenTicks = 0 - Mob.tick)
Object.defineProperty(Mob.prototype, 'target', {
  get() {
    const t = this._target;
    if (t instanceof Player && (t.creative || t.spectator)) {
      this._target = null;
      return null;
    }
    return t;
  },
  set(v) {
    const n = v instanceof Player && (v.creative || v.spectator) ? null : v || null;
    if (n !== this._target) this.unseenT = 0;
    this._target = n;
  },
  configurable: true
});

// ---------------------------------------------------------------------------
// Item entity
// ---------------------------------------------------------------------------
// A stack that may lie on the ground or go into an inventory: an item this game has (an old save's block item becomes
// its item - fixSavedStack), at least one. Anything else is let go (null): a command block's output text spread into a
// "stack" when the block broke or changed mode (Game.onBlockChanged), an id another version or a room sent. Drawn,
// merged or picked up such a stack threw every frame - "draw ItemEntity: reading 'block'", "entity ItemEntity: reading
// 'durability'" (telemetry 11-02/03: ~80 devices, ~300,000 times, those devices lagging) - and picked up it broke the
// hand. Reported (quietly, once per id and caller) with the code that made it, so a source left shows in telemetry.
function knownStack(st, game, what) {
  if (st == null) return null; // (no stack at all - an empty slot: nothing, as before, not a report)
  if (st && typeof st === 'object' && ITEMS[st.id] && st.count > 0) return st;
  if (st && typeof st === 'object' && ITEMS[st.id]) return null; // (a known item, none of it left: just nothing)
  const f = st && typeof st === 'object' && st.count > 0 ? fixSavedStack(st) : null;
  if (f && ITEMS[f.id]) return f;
  const g = game || typeof window !== 'undefined' && window.game,
    seen = knownStack.seen || (knownStack.seen = new Set());
  const from = String(new Error().stack || '').split('\n').slice(2, 6).map(s => (s.match(/([\w.-]+\.js):(\d+)/) || []).slice(1, 3).join(':')).filter(Boolean).join('<');
  const id = st && typeof st === 'object' ? String(st.id) + 'x' + String(st.count) : typeof st,
    key = what + id + from;
  if (g && g.reportError && !seen.has(key) && seen.size < 50) {
    seen.add(key);
    g.reportError(what, new Error('unknown item ' + id + ' from ' + from), true);
  }
  return null;
}
// the items fire doesn't hurt (vanilla damage_resistant #is_fire)
const ITEM_FIREPROOF = /^(ancient_debris|netherite_(axe|block|boots|chestplate|helmet|hoe|horse_armor|ingot|leggings|nautilus_armor|pickaxe|scrap|shovel|spear|sword))$/;
class ItemEntity extends Entity {
  // (north, south, west, east, up: x y z offset, axis, sign)
  static SIDES = [[0, 0, -1, 2, -1], [0, 0, 1, 2, 1], [-1, 0, 0, 0, -1], [1, 0, 0, 0, 1], [0, 1, 0, 1, 1]];
  // vanilla Entity.moveTowardsClosestSpace: of the four sides and up whose block isn't a full cube, the one closest to
  // the item's middle; its speed that way 0.1-0.3, the rest three quarters of what it was (up when every side is shut)
  closestSpace() {
    const x = this.pos[0],
      y = this.pos[1] + this.h / 2,
      z = this.pos[2],
      bx = Math.floor(x),
      by = Math.floor(y),
      bz = Math.floor(z);
    const f = [x - bx, y - by, z - bz],
      v = this.vel;
    let best = 4,
      dist = Infinity;
    for (let i = 0; i < 5; i++) {
      const [dx, dy, dz, ax, s] = ItemEntity.SIDES[i];
      if (fullCollisionAt(this.world, bx + dx, by + dy, bz + dz)) continue;
      const dd = s > 0 ? 1 - f[ax] : f[ax];
      if (dd < dist) {
        dist = dd;
        best = i;
      }
    }
    const [,,, ax, s] = ItemEntity.SIDES[best];
    v[0] *= 0.75;
    v[1] *= 0.75;
    v[2] *= 0.75;
    v[ax] = s * (Math.random() * 0.2 + 0.1);
  }
  constructor(game, x, y, z, stack, vel) {
    super(game, x, y, z, 0.25, 0.25);
    // (not one this game can show: gone at once - see knownStack; a room's placeholder stays, its item comes later)
    const ok = knownStack(stack, game, 'item entity');
    this.stack = ok || stack;
    if (!ok) this.dead = true;
    this.pickup = 10;
    this.bobOff = Math.random() * Math.PI * 2;
    if (vel) this.vel = vel;else this.vel = [(Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2];
  }
  // the item entities by 2-block cell, made once a tick when the first one merges: each looked through every entity of
  // the world (comparing their stacks before the distance) every second - with the thousands an ocean's washed-out kelp
  // left (telemetry 11-03: worlds with 3,000-5,000 entities) millions of checks a tick
  static near(g, e) {
    let G = g.itemCells;
    if (!G || G.t !== g.tickCount || G.list !== g.entities) {
      G = g.itemCells = {
        t: g.tickCount,
        list: g.entities,
        m: new Map()
      };
      for (const o of g.entities) if (o instanceof ItemEntity && !o.dead) {
        const k = ItemEntity.cell(o.pos[0], o.pos[1], o.pos[2]),
          a = G.m.get(k);
        if (a) a.push(o);else G.m.set(k, [o]);
      }
    }
    const out = [],
      cx = Math.floor(e.pos[0] / 2),
      cy = Math.floor(e.pos[1] / 2),
      cz = Math.floor(e.pos[2] / 2);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = G.m.get(ItemEntity.cell((cx + a) * 2, (cy + b) * 2, (cz + c) * 2));
      if (l) for (const o of l) out.push(o);
    }
    return out;
  }
  static cell(x, y, z) {
    return (Math.floor(x / 2) & 2047) + (Math.floor(z / 2) & 2047) * 2048 + (Math.floor(y / 2) & 255) * 4194304;
  }
  // fire, soul fire and cactus wear it out (vanilla ItemEntity: 5 health; a fire block it is in hurts 1 a tick - soul
  // fire 2 - and sets it burning for 8 s, 1 a second; a cactus 1 a tick). Netherite things don't burn. True: gone
  // (every tick, as vanilla's applyEffectsFromBlocksForLastMovements; the box bounds inline, no array)
  burns() {
    var _this$health;
    const w = this.world,
      p = this.pos,
      hw = this.w / 2;
    const x1 = Math.floor(p[0] + hw - 1e-5),
      y1 = Math.floor(p[1] + this.h - 1e-5),
      z1 = Math.floor(p[2] + hw - 1e-5);
    let dmg = 0;
    for (let x = Math.floor(p[0] - hw + 1e-5); x <= x1; x++) for (let y = Math.floor(p[1] + 1e-5); y <= y1; y++) for (let z = Math.floor(p[2] - hw + 1e-5); z <= z1; z++) {
      const id = w.getBlock(x, y, z);
      if (id === 37) dmg += 1;else if ((id === 171 || id && id === BID.soul_fire) && !this.fireproof()) {
        dmg += id === 171 ? 1 : 2;
        this.burn = 160;
      }
    }
    if (this.burn > 0) {
      this.burn--;
      if (this.inWater) this.burn = 0;else if (this.burn % 20 === 0) dmg += 1;
    }
    if (!dmg) return false;
    this.health = ((_this$health = this.health) !== null && _this$health !== void 0 ? _this$health : 5) - dmg;
    if (this.health > 0) return false;
    this.dead = true;
    return true;
  }
  fireproof() {
    const id = this.stack.id;
    if (this.fpId !== id) {
      this.fpId = id;
      this.fp = ITEM_FIREPROOF.test(ITEMS[id].key);
    }
    return this.fp;
  }
  tick() {
    this.savePrev();
    this.age++;
    const st = this.stack;
    if (!st || !ITEMS[st.id]) {
      this.dead = true;
      return;
    } // (its stack replaced from outside by one this game lacks)
    if (this.pickup > 0) this.pickup--;
    this.updateFluids();
    const v = this.vel;
    // in water (deeper than 0.1 where it is): no gravity, a slight rise, a little drag (ItemEntity.setUnderwaterMovement)
    if (this.inWater && this.waterDepth() > 0.1) {
      v[0] *= 0.99;
      v[2] *= 0.99;
      if (v[1] < 0.06) v[1] += 5e-4;
      this.bubbleColumn();
    } else {
      v[1] -= 0.04;
      if (this.inWater) this.bubbleColumn();
    }
    // (vanilla ItemEntity.tick: one lying still on the ground moves every 4th tick only; the push out of a block put
    // into it waits for that tick here too - a tick or three later than vanilla's - as thousands lying about each ran
    // the collision every tick)
    // stuck in a block (dropped into one, a block put where it lay, taken off an item frame against the wall): pushed
    // toward the closest open side, and that tick it goes through what holds it (vanilla ItemEntity.tick: noPhysics
    // while its box less 1e-7 collides, moveTowardsClosestSpace). It went up 0.1 a tick through everything above until
    // free - out on top of a wall, through a ceiling (the user, 11-13: drops going through walls)
    const b = this.box(),
      stuck = this.collides([b[0] + 1e-7, b[1] + 1e-7, b[2] + 1e-7, b[3] - 1e-7, b[4] - 1e-7, b[5] - 1e-7]);
    if (stuck) this.closestSpace();
    if (stuck || !this.onGround || v[0] * v[0] + v[2] * v[2] > 1e-5 || (this.age + this.id) % 4 === 0) {
      if (stuck) {
        this.pos[0] += v[0];
        this.pos[1] += v[1];
        this.pos[2] += v[2];
        this.onGround = false;
      } else this.move(v[0], v[1], v[2]);
      const f = this.onGround ? 0.6 * 0.98 : 0.98;
      v[0] *= f;
      v[2] *= f;
      v[1] *= 0.98;
      if (this.onGround && v[1] < 0) v[1] *= -0.5; // (not one bouncing off a bed, as vanilla)
    }
    if (this.inLava) {
      this.dead = true;
      Sound.fizz(this.pos);
      return;
    }
    if (this.burns()) return;
    if (this.age > 6000) {
      this.dead = true;
      return;
    }
    // merge with the stacks of the same kind nearby that fit (vanilla mergeWithNeighbours / ItemEntity.merge: the one
    // left keeps the younger age and the longer pick-up delay)
    if (this.age % 20 === 0 && st.count < maxStack(st.id)) {
      for (const e of ItemEntity.near(this.game, this)) {
        if (e === this || e.dead || !e.stack) continue;
        const dx = e.pos[0] - this.pos[0],
          dy = e.pos[1] - this.pos[1],
          dz = e.pos[2] - this.pos[2];
        if (dx * dx + dy * dy + dz * dz >= 1.44 || st.count + e.stack.count > maxStack(st.id) || !sameKind(e.stack, st)) continue;
        st.count += e.stack.count;
        e.dead = true;
        this.age = Math.min(this.age, e.age);
        this.pickup = Math.max(this.pickup, e.pickup);
      }
    }
    // pickup
    const p = this.game.player;
    if (this.pickup <= 0 && p.deathTime === 0) {
      const b = p.box();
      if (this.pos[0] > b[0] - 1 && this.pos[0] < b[3] + 1 && this.pos[1] > b[1] - 0.5 && this.pos[1] < b[4] + 0.5 && this.pos[2] > b[2] - 1 && this.pos[2] < b[5] + 1) {
        const left = p.inv.add(this.stack);
        if (left < this.stack.count) {
          this.game.onPickup(this.stack.id, this.stack.count - left);
          Sound.pop(this.pos);
          this.game.particles.pickupAnim(this, p);
        }
        if (left === 0) this.dead = true;else this.stack.count = left;
      }
    }
  }
}
class FallingBlock extends Entity {
  constructor(game, x, y, z, id, meta) {
    super(game, x + 0.5, y, z + 0.5, 0.98, 0.98);
    this.blockId = id;
    this.meta = meta;
    this.y0 = y;
  }
  tick() {
    this.savePrev();
    this.age++;
    this.vel[1] = (this.vel[1] - 0.04) * 0.98;
    this.move(0, this.vel[1], 0);
    if (this.onGround || this.age > 600) {
      this.dead = true;
      const x = Math.floor(this.pos[0]),
        z = Math.floor(this.pos[2]);
      // (a column falling together lands a little inside the one under it, which has just become a block: the cell
      // above then - before, the top one of three sand dropped as an item, "落下的沙子生成方块又掉一个")
      let y = Math.floor(this.pos[1] + 0.5);
      const free = yy => {
        const c = this.world.getBlock(x, yy, z);
        return c === 0 || REPLACEABLE[c];
      };
      for (let k = 0; k < 8 && this.onGround && !free(y) && SOLIDCUBE[this.world.getBlock(x, y, z)]; k++) y++; // (not on a torch: that breaks it, as in vanilla)
      // a falling stalactite's tip hurts what it lands in (FallingBlockEntity.causeFallDamage, setHurtsEntities)
      if (this.hurts && this.onGround) {
        const n = Math.ceil(this.y0 - this.pos[1] - 1),
          dmg = Math.min(Math.floor(n * this.hurts[0]), this.hurts[1]),
          bb = this.box();
        if (dmg > 0) for (const e of [this.game.player, ...this.game.entities]) {
          if (!(e instanceof Living) || e.dead || e.deathTime > 0) continue;
          const eb = e.box();
          if (eb[0] < bb[3] && eb[3] > bb[0] && eb[1] < bb[4] && eb[4] > bb[1] && eb[2] < bb[5] && eb[5] > bb[2]) e.hurt(dmg, {
            type: 'falling_stalactite'
          });
        }
      }
      // (one that can't stand where it lands - a stalactite on the ground - breaks into its item, as vanilla's)
      if (free(y) && (!this.game.supported || this.game.supported(x, y, z, this.blockId, this.meta))) {
        this.world.setBlock(x, y, z, this.blockId, this.meta);
        Sound.block('place', BLOCKS[this.blockId].sound, this.pos);
      } else this.game.dropItem(this.pos[0], this.pos[1], this.pos[2], makeStack(this.blockId, 1));
    }
  }
}
class PrimedTNT extends Entity {
  constructor(game, x, y, z, fuse = 80) {
    super(game, x + 0.5, y, z + 0.5, 0.98, 0.98);
    this.fuse = fuse;
    const a = Math.random() * Math.PI * 2;
    this.vel = [-Math.sin(a) * 0.02, 0.2, -Math.cos(a) * 0.02];
    Sound.fuse(this.pos);
  }
  tick() {
    this.savePrev();
    this.age++;
    this.updateFluids();
    this.vel[1] -= 0.04;
    this.move(this.vel[0], this.vel[1], this.vel[2]);
    this.vel[0] *= 0.98;
    this.vel[1] *= 0.98;
    this.vel[2] *= 0.98;
    if (this.onGround) {
      this.vel[0] *= 0.7;
      this.vel[2] *= 0.7;
      this.vel[1] *= -0.5;
    }
    if (Math.random() < 0.5) this.game.particles.spawn('smoke', this.pos[0], this.pos[1] + 1.1, this.pos[2], 0, 0.02, 0);
    if (--this.fuse <= 0) {
      this.dead = true;
      this.game.explode(this.pos[0], this.pos[1] + 0.49, this.pos[2], 4, this, this.inWater);
    }
  }
}
class Arrow extends Entity {
  constructor(game, x, y, z, vel, shooter) {
    super(game, x, y, z, 0.5, 0.5);
    this.vel = vel;
    this.shooter = shooter;
    this.stuck = false;
    this.life = 0;
    this.fromPlayer = shooter === game.player;
    this.updateRot();
  }
  breakSnowball() {
    for (let i = 0; i < 8; i++) this.game.particles.spawn('block', this.pos[0], this.pos[1], this.pos[2], (Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2, {
      id: 1,
      layer: ITEMS[this.snowball].tex
    });
    if (ITEMS[this.snowball].key === 'egg' && Math.random() < 0.125) {
      const c = new Mob(this.game, 'chicken', this.pos[0], this.pos[1], this.pos[2]).makeBaby();
      c.persistent = true;
      this.game.addEntity(c);
    }
  }
  updateRot() {
    const v = this.vel;
    this.yaw = Math.atan2(-v[0], -v[2]);
    this.pitch = Math.atan2(v[1], Math.hypot(v[0], v[2]));
  }
  // a burning arrow (flame) lights the TNT it sticks in (vanilla TntBlock.onProjectileHit)
  lightTnt(x, y, z) {
    const g = this.game;
    if (!(this.fire > 0) || this.snowball || g.net || g.p2pGuest || this.world.getBlock(x, y, z) !== 26) return;
    // Projectile.mayInteract: a mob's arrow needs mob_griefing
    if (this.shooter instanceof Mob && g.rule('mob_griefing') === false) return;
    this.world.setBlock(x, y, z, 0, 0);
    g.entities.push(new PrimedTNT(g, x, y, z));
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.stuck) {
      if (++this.life > 1200) this.dead = true;
      const sa = this.stuckAt;
      // the block gone (air or water there now): it drops, its flight's speed all but lost (vanilla startFalling:
      // x random 0-0.2 each way) - it flew on at its old speed
      const sb = this.world.getBlock(sa[0], sa[1], sa[2]);
      if (!sb || IS_FLUID[sb]) {
        this.stuck = false;
        this.life = 0;
        this.vel = this.vel.map(c => c * Math.random() * 0.2);
        return;
      }
      if (this.fromPlayer && this.age > 10) {
        const p = this.game.player;
        // infinity / creative arrows can't be picked up (they go when touched in creative)
        if (this.distTo(p) < 1.5 && (this.noPickup ? p.creative : p.inv.add(this.stack ? {
          ...this.stack,
          count: 1
        } : makeStack('arrow', 1)) === 0)) {
          this.dead = true;
          Sound.pop(this.pos);
        }
      }
      return;
    }
    const v = this.vel;
    const steps = Math.ceil(Math.hypot(v[0], v[1], v[2]) / 0.25);
    // (the list once a tick, not once a step: with thousands of dropped items each flying arrow copied it 4-12 times a tick.
    // And only what this tick's flight can reach - the box round its path, in the list's order; each step made a box and
    // two arrays for every mob of the world: a skeleton fight among ~100 mobs, 2026-11-03. The ender dragon's parts
    // reach past its box: always)
    const ents = [],
      p0 = this.pos,
      sh = this.shooter;
    const lx = Math.min(p0[0], p0[0] + v[0]) - 0.2,
      hx = Math.max(p0[0], p0[0] + v[0]) + 0.2,
      ly = Math.min(p0[1], p0[1] + v[1]) - 0.05,
      hy = Math.max(p0[1], p0[1] + v[1]) + 0.05,
      lz = Math.min(p0[2], p0[2] + v[2]) - 0.2,
      hz = Math.max(p0[2], p0[2] + v[2]) + 0.2;
    const reach = e => {
      if (e === sh || e === this || !(e instanceof Living) && !e.hittable) return;
      if (e.parts) {
        ents.push(e);
        return;
      }
      const b = e.box();
      if (b[3] > lx && b[0] < hx && b[4] > ly && b[1] < hy && b[5] > lz && b[2] < hz) ents.push(e);
    };
    for (const e of this.game.entities) reach(e);
    reach(this.game.player);
    for (let i = 0; i < steps; i++) {
      const nx = this.pos[0] + v[0] / steps,
        ny = this.pos[1] + v[1] / steps,
        nz = this.pos[2] + v[2] / steps;
      // a block first, by its real shape (doors, panes, fences too): the arrow used to look for someone to hit before
      // the wall in between, and thin blocks didn't stop it - "骷髅的箭穿过门/墙射到我", feedback 2026-11-01/02
      {
        blockBoxes(this.world, nx - 0.02, ny - 0.02, nz - 0.02, nx + 0.02, ny + 0.02, nz + 0.02, _boxes);
        let inBox = false;
        for (const b of _boxes) if (nx > b[0] && nx < b[3] && ny > b[1] && ny < b[4] && nz > b[2] && nz < b[5]) {
          inBox = true;
          break;
        }
        const bid = this.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (inBox && bid && !IS_FLUID[bid]) {
          if (this.snowball) {
            this.breakSnowball();
            this.dead = true;
            return;
          }
          this.stuck = true;
          this.stuckAt = [Math.floor(nx), Math.floor(ny), Math.floor(nz)];
          Sound.arrowHit(this.pos);
          this.lightTnt(...this.stuckAt);
          return;
        }
      }
      // entity hit
      const inB = b => nx > b[0] - 0.15 && nx < b[3] + 0.15 && ny > b[1] && ny < b[4] && nz > b[2] - 0.15 && nz < b[5] + 0.15;
      for (const e of ents) {
        if (e.dead || e.deathTime > 0) continue;
        const part = e.parts ? e.parts().find(pt => inB(pt.box)) : inB(e.box());
        if (part) {
          if (this.hitSet && this.hitSet.has(e)) continue;
          // a trident does 8 (impaling more on mobs in water); arrows by their speed
          let dmg = this.snowball ? e.type === 'blaze' ? 3 : 0 : Math.ceil(Math.hypot(v[0], v[1], v[2]) * (this.baseDmg || 2));
          if (this.trident) dmg = 8 + (e.inWater ? 2.5 * enchLevel(this.stack, 'impaling') : 0);
          if (this.fire > 0 && !this.snowball && !e.fireproof && e instanceof Living) e.fire = Math.max(e.fire || 0, 100);
          if (this.snowball) {
            this.breakSnowball();
          }
          if (e.parts) {
            const src = {
              type: 'arrow',
              attacker: this.shooter,
              player: this.fromPlayer
            };
            e.hurtPart(part, dmg, src);
            if (!this.snowball) Sound.arrowHit(this.pos);
            // (a perched dragon: it bounces off back the way it came - vanilla's arrow deflection, x -0.1)
            if (src.deflected && !this.snowball) {
              v[0] *= -0.1;
              v[1] *= -0.1;
              v[2] *= -0.1;
              this.updateRot();
              (this.hitSet || (this.hitSet = new Set())).add(e);
              return;
            }
            this.dead = true;
            return;
          }
          const hit = e.hurt(dmg, {
            type: this.trident ? 'trident' : 'arrow',
            attacker: this.shooter,
            knockFrom: [this.pos[0] - v[0], 0, this.pos[2] - v[2]],
            knock: 0.3 + (this.punch || 0) * 0.6,
            player: this.fromPlayer,
            fire: this.fire > 0 && !this.snowball,
            speed2: v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
          });
          if (hit && e.addEffect) {
            // tipped arrows: their potion for an eighth of the time; spectral arrows: glowing
            if (this.tip && this.tip.pot && typeof POTIONS !== 'undefined') for (const [k, t, amp] of POTIONS[this.tip.pot] || []) {
              if (k === 'instant_health' || k === 'instant_damage') e.addEffect(k, amp, 1);else if (t / 8 >= 1) e.addEffect(k, amp, Math.floor(t / 8));
            }
            if (this.tip && ITEMS[this.tip.id].key === 'spectral_arrow') e.addEffect('glowing', 0, 200);
          }
          if (hit && this.onHit) this.onHit(e);
          if (!this.snowball) Sound.arrowHit(this.pos); // (snowballs and eggs make no hit sound of their own: vanilla Snowball.onHit)
          (this.hitSet || (this.hitSet = new Set())).add(e);
          if (this.trident) return; // it bounces off and falls
          if (this.pierce > 0) {
            this.pierce--;
            continue;
          }
          this.dead = true;
          return;
        }
      }
      const bx = Math.floor(nx),
        by = Math.floor(ny),
        bz = Math.floor(nz);
      const id = this.world.getBlock(bx, by, bz);
      if (id && BLOCKS[id].solid) {
        if (this.snowball) {
          this.breakSnowball();
          this.dead = true;
          return;
        }
        this.stuck = true;
        this.stuckAt = [bx, by, bz];
        Sound.arrowHit(this.pos);
        this.lightTnt(bx, by, bz);
        return;
      }
      this.pos[0] = nx;
      this.pos[1] = ny;
      this.pos[2] = nz;
    }
    this.updateFluids();
    const drag = this.inWater ? 0.6 : 0.99;
    v[0] *= drag;
    v[1] = v[1] * drag - 0.05;
    v[2] *= drag;
    this.updateRot();
    if (this.age > 400) this.dead = true;
  }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
class Particles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pickups = [];
  }
  spawn(type, x, y, z, vx, vy, vz, extra) {
    // full: a stand-in that is never drawn, so the callers that set something on the new one (a torch's flame: .life =
    // 12) don't throw - undefined here stopped the rest of the tick while thousands of kelp were washed out ("Cannot
    // set properties of undefined (setting 'life')", telemetry 11-03: 99 devices)
    if (this.list.length > 3000) return this.spare || (this.spare = {
      type,
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      life: 0,
      size: 0,
      grav: 0,
      layer: 0,
      u0: 0,
      v0: 0,
      us: 1,
      col: [255, 255, 255],
      bright: false,
      frames: 0,
      base: 0
    });
    const p = {
      type,
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      vx,
      vy,
      vz,
      age: 0,
      life: 20,
      size: 0.1,
      grav: 0,
      layer: 0,
      u0: 0,
      v0: 0,
      us: 1,
      col: [255, 255, 255],
      bright: false,
      frames: 0,
      base: 0
    };
    const r = Math.random;
    switch (type) {
      case 'block':
        {
          var _extra$layer;
          const b = BLOCKS[extra.id];
          p.layer = (_extra$layer = extra.layer) !== null && _extra$layer !== void 0 ? _extra$layer : b.texFn && !b.particleOwn ? b.texFn.call(b, 0, extra.meta || 0) : b.particle;
          p.us = 0.25;
          p.u0 = r() * 0.75;
          p.v0 = r() * 0.75;
          p.life = 4 / (r() * 0.9 + 0.1);
          p.grav = 0.04;
          p.size = 0.05 + r() * 0.05;
          // (the block's colour there: Game.blockTintAt - none given, it is looked up)
          const t = extra.tint !== undefined ? extra.tint : b.tint && extra.layer == null ? this.game.blockTintAt(Math.floor(x), Math.floor(z), extra.id, extra.meta || 0) : null;
          if (t) p.col = t;
          break;
        }
      case 'smoke':
        p.frames = 12;
        p.base = T('p_big_smoke_0');
        p.life = 20 + r() * 20;
        p.size = 0.15 + r() * 0.15;
        p.grav = -0.002;
        p.col = [80, 80, 80];
        break;
      case 'poof':
        p.frames = 8;
        p.base = T('p_generic_0');
        p.life = 16 + r() * 8;
        p.size = 0.15 + r() * 0.1;
        p.col = [230, 230, 230];
        p.reverse = true;
        break;
      case 'explosion':
        p.frames = 16;
        p.base = T('p_explosion_0');
        p.life = 8 + r() * 8;
        p.size = 1 + r() * 0.8;
        p.bright = true;
        break;
      case 'flame':
        p.layer = T('p_flame');
        p.life = 10 + r() * 10;
        p.size = 0.06 + r() * 0.04;
        p.bright = true;
        break;
      case 'lava':
        p.layer = T('p_lava');
        p.life = 30;
        p.size = 0.08;
        p.grav = 0.04;
        p.bright = true;
        break;
      case 'splash':
        p.layer = T('p_splash_' + (r() * 4 | 0));
        p.life = 10;
        p.size = 0.08;
        p.grav = 0.04;
        p.col = [80, 120, 230];
        break;
      case 'bubble':
        p.layer = T('p_bubble');
        p.life = 20 + r() * 20;
        p.size = 0.05;
        p.grav = -0.01;
        break;
      // the sword's sweep (vanilla AttackSweepParticle: 4 ticks, grey), soul speed's souls rising off the sand
      case 'sweep':
        {
          p.frames = 8;
          p.base = T('p_sweep_0');
          p.life = 4;
          p.size = 1;
          p.grav = 0;
          const c = 150 + r() * 100 | 0;
          p.col = [c, c, c];
          p.bright = true;
          break;
        }
      case 'soul':
        p.frames = 11;
        p.base = T('p_soul_0');
        p.life = 22;
        p.size = 0.12;
        p.grav = -0.002;
        p.bright = true;
        break;
      case 'crit':
        p.layer = T('p_critical_hit');
        p.life = 12;
        p.size = 0.08;
        p.grav = 0.02;
        p.bright = true;
        break;
      case 'heart':
        p.layer = T('p_heart');
        p.life = 20;
        p.size = 0.15;
        p.grav = -0.005;
        p.bright = true;
        break;
      case 'happy_villager':
        p.layer = T('p_glint');
        p.life = 20;
        p.size = 0.1;
        p.grav = -0.002;
        p.bright = true;
        break;
      case 'note':
        p.layer = T('p_note');
        p.life = 20;
        p.size = 0.15;
        p.bright = true;
        p.col = extra.col;
        break;
      case 'damage':
        p.layer = T('p_damage');
        p.life = 15;
        p.size = 0.1;
        p.grav = 0.02;
        break;
      case 'glint':
        p.layer = T('p_glint');
        p.life = 20;
        p.size = 0.08;
        p.bright = true;
        break;
      // a barrier's / light block's marker, the size of the block (BlockMarker: 80 ticks)
      case 'marker':
        p.layer = extra.layer;
        p.life = 80;
        p.size = 0.5;
        break;
      // potion swirls round whoever has an effect, and splash potions' burst (vanilla SpellParticle: 8-40 ticks, the
      // sprite running through the effect frames, in the effects' colour). Missing, they came out as layer 0 - stone
      case 'effect':
        p.frames = 3;
        p.base = T('p_effect_0');
        p.life = Math.floor(8 / (r() * 0.8 + 0.2));
        p.size = 0.06 + r() * 0.04;
        p.col = extra.col || [255, 255, 255];
        break;
      case 'bone_meal':
        p.layer = T('p_effect_' + (r() * 3 | 0));
        p.life = 20;
        p.size = 0.08;
        p.col = [120, 220, 90];
        p.bright = true;
        break;
      case 'rain':
        p.layer = T('p_splash_' + (r() * 4 | 0));
        p.life = 6;
        p.size = 0.06;
        p.grav = 0.04;
        p.col = [100, 140, 230];
        break;
      case 'portal':
        p.frames = 8;
        p.base = T('p_generic_0');
        p.life = 30 + r() * 20;
        p.size = 0.06 + r() * 0.05;
        p.reverse = true;
        p.bright = true;
        {
          const k = r() * 0.6 + 0.4;
          p.col = [Math.round(230 * k), Math.round(80 * k), 255];
        }
        p.vx *= 0.5;
        p.vy = p.vy * 0.5 - 0.01;
        p.vz *= 0.5;
        break;
      case 'breath':
        p.frames = 8;
        p.base = T('p_generic_0');
        p.life = 20 + r() * 20;
        p.size = 0.12 + r() * 0.08;
        p.reverse = true;
        p.bright = true;
        p.col = [200, 60 + r() * 60 | 0, 255];
        break;
    }
    this.list.push(p);
    return p;
  }
  blockBreak(x, y, z, id, meta) {
    const tint = this.game.blockTintAt(x, z, id, meta);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      const px = x + (i + 0.5) / 4,
        py = y + (j + 0.5) / 4,
        pz = z + (k + 0.5) / 4;
      this.spawn('block', px, py, pz, (px - x - 0.5) * 0.3 + (Math.random() - 0.5) * 0.05, (py - y - 0.5) * 0.3 + Math.random() * 0.1, (pz - z - 0.5) * 0.3, {
        id,
        meta,
        tint
      });
    }
  }
  blockHit(x, y, z, face, id, meta) {
    const D = DIRS[face];
    const px = x + 0.5 + D[0] * 0.52 + (D[0] ? 0 : (Math.random() - 0.5) * 0.9);
    const py = y + 0.5 + D[1] * 0.52 + (D[1] ? 0 : (Math.random() - 0.5) * 0.9);
    const pz = z + 0.5 + D[2] * 0.52 + (D[2] ? 0 : (Math.random() - 0.5) * 0.9);
    const tint = this.game.blockTintAt(x, z, id, meta);
    this.spawn('block', px, py, pz, D[0] * 0.05, 0.05 + D[1] * 0.05, D[2] * 0.05, {
      id,
      meta,
      tint
    });
  }
  pickupAnim(e, p) {
    this.pickups.push({
      stack: {
        ...e.stack
      },
      from: [...e.pos],
      t: 0,
      target: p
    });
  }
  tick() {
    const w = this.game.world;
    for (const p of this.list) {
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      p.age++;
      p.vy -= p.grav;
      let nx = p.x + p.vx,
        ny = p.y + p.vy,
        nz = p.z + p.vz;
      if (p.grav > 0) {
        const id = w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (id && SOLIDCUBE[id]) {
          if (p.vy < 0) {
            ny = p.y;
            p.vy = 0;
            p.vx *= 0.7;
            p.vz *= 0.7;
          } else {
            nx = p.x;
            nz = p.z;
          }
        }
      }
      p.x = nx;
      p.y = ny;
      p.z = nz;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.vz *= 0.98;
      if (p.type === 'smoke' || p.type === 'explosion') {
        p.vx *= 0.9;
        p.vz *= 0.9;
      }
      if (p.type === 'bubble' && w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) !== WATER) p.age = p.life;
      if (p.type === 'lava' && Math.random() < 0.1) this.spawn('smoke', p.x, p.y, p.z, 0, 0.01, 0);
      if (p.age % 4 === 1) p.light = w.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    }
    this.list = this.list.filter(p => p.age < p.life);
    for (const q of this.pickups) q.t++;
    this.pickups = this.pickups.filter(q => q.t < 3);
  }
  // build billboard quads into a MeshBuffer
  build(mb, a, cam, right, up) {
    mb.reset();
    for (const p of this.list) {
      var _p$light;
      const x = lerp(p.px, p.x, a),
        y = lerp(p.py, p.y, a),
        z = lerp(p.pz, p.z, a);
      let layer = p.layer;
      if (p.frames) {
        const f = Math.min(p.frames - 1, Math.floor((p.age + a) / p.life * p.frames));
        layer = p.base + (p.reverse ? p.frames - 1 - f : f);
      }
      const s = p.size;
      const rx = right[0] * s,
        ry = right[1] * s,
        rz = right[2] * s,
        ux = up[0] * s,
        uy = up[1] * s,
        uz = up[2] * s;
      const l = (_p$light = p.light) !== null && _p$light !== void 0 ? _p$light : 0xF0;
      const sky = p.bright ? 255 : (l >> 4) * 17,
        blk = p.bright ? 255 : (l & 15) * 17;
      const u0 = p.u0,
        v0 = p.v0,
        u1 = u0 + p.us,
        v1 = v0 + p.us;
      const c = p.col;
      mb.v(x - rx - ux, y - ry - uy, z - rz - uz, u0, v1, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
      mb.v(x + rx - ux, y + ry - uy, z + rz - uz, u1, v1, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
      mb.v(x + rx + ux, y + ry + uy, z + rz + uz, u1, v0, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
      mb.v(x - rx + ux, y - ry + uy, z - rz + uz, u0, v0, layer, 0, c[0], c[1], c[2], 255, sky, blk, 0);
    }
  }
}

// ---- experience orbs (vanilla ExperienceOrb) -------------------------------------------------------
const XP_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
class ExperienceOrb extends Entity {
  constructor(game, x, y, z, value) {
    super(game, x, y, z, 0.5, 0.5);
    this.value = value;
    this.vel = [(Math.random() * 0.2 - 0.1) * 2, Math.random() * 0.2 * 2, (Math.random() * 0.2 - 0.1) * 2];
    this.icon = value >= 2477 ? 10 : value >= 1237 ? 9 : value >= 617 ? 8 : value >= 307 ? 7 : value >= 149 ? 6 : value >= 73 ? 5 : value >= 37 ? 4 : value >= 17 ? 3 : value >= 7 ? 2 : value >= 3 ? 1 : 0;
  }
  tick() {
    this.savePrev();
    this.age++;
    this.updateFluids();
    const v = this.vel,
      g = this.game,
      p = g.player;
    if (this.inWater) {
      v[0] *= 0.99;
      v[2] *= 0.99;
      if (v[1] < 0.06) v[1] += 5e-4;
    } else v[1] -= 0.03;
    if (this.inLava) {
      v[1] = 0.2;
      v[0] = (Math.random() - Math.random()) * 0.2;
      v[2] = (Math.random() - Math.random()) * 0.2;
    }
    // (in a block: toward the closest open side, as a dropped item - vanilla ExperienceOrb.tick moveTowardsClosestSpace)
    if (this.collides(this.box())) ItemEntity.prototype.closestSpace.call(this);
    // drift toward the player within 8 blocks
    if (p.deathTime === 0 && g.mode !== 'spectator') {
      // (creative players too, like vanilla: players' feedback 2026-10-31)
      const dx = p.pos[0] - this.pos[0],
        dy = p.pos[1] + p.eye() / 2 - this.pos[1],
        dz = p.pos[2] - this.pos[2];
      const l = Math.hypot(dx, dy, dz);
      if (l < 8) {
        let d = 1 - l / 8;
        d *= d;
        v[0] += dx / l * d * 0.1;
        v[1] += dy / l * d * 0.1;
        v[2] += dz / l * d * 0.1;
      }
    }
    this.move(v[0], v[1], v[2]);
    const f = this.onGround ? 0.6 * 0.98 : 0.98;
    v[0] *= f;
    v[1] *= 0.98;
    v[2] *= f;
    if (this.onGround) v[1] *= -0.9;
    if (this.age >= 6000) {
      this.dead = true;
      return;
    }
    // pick-up: one orb every 2 ticks
    if (p.deathTime === 0 && g.mode !== 'spectator' && (p.xpDelay || 0) <= 0) {
      const b = p.box();
      if (this.pos[0] > b[0] - 0.25 && this.pos[0] < b[3] + 0.25 && this.pos[1] > b[1] - 0.25 && this.pos[1] < b[4] + 0.25 && this.pos[2] > b[2] - 0.25 && this.pos[2] < b[5] + 0.25) {
        p.xpDelay = 2;
        Sound.ev('entity.experience_orb.pickup', null, 0.1, (Math.random() - Math.random()) * 0.35 + 0.9);
        let xp = this.value;
        const mend = [p.inv.sel, 36, 37, 38, 39, 40].map(i => p.inv.slots[i]).filter(s => s && s.dmg > 0 && enchLevel(s, 'mending'));
        if (mend.length) {
          const s = mend[Math.floor(Math.random() * mend.length)],
            r = Math.min(xp * 2, s.dmg);
          s.dmg -= r;
          xp -= Math.ceil(r / 2);
        }
        if (xp > 0) g.addXp(xp);
        this.dead = true;
      }
    }
  }
}
