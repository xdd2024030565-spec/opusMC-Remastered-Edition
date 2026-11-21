
'use strict';

// ---------------------------------------------------------------------------
// Natural spawning in the overworld from each vanilla biome's spawn lists (worldgen data "spawners"): mob
// categories with their caps (monster, creature, ambient, water creature, water ambient, underground water
// creature, axolotls), vanilla's light rules, pack sizes; plus the wandering trader, phantoms and patrols.
// ---------------------------------------------------------------------------
const SPAWN_CAPS = {
  monster: 70,
  creature: 10,
  ambient: 15,
  water_creature: 5,
  water_ambient: 20,
  underground_water_creature: 5,
  axolotls: 5
};
const SPAWN_GROUND = {
  mooshroom: /^mycelium$/,
  polar_bear: /snow|ice/,
  goat: /stone|snow|gravel|calcite|packed_ice/,
  rabbit: /grass_block|snow|sand/,
  turtle: /sand$/,
  frog: /mud|grass_block|mangrove_roots/,
  armadillo: /grass_block|red_sand|coarse_dirt|terracotta/,
  camel: /sand$/,
  parrot: /grass_block|leaves|log/,
  ocelot: /grass_block|leaves/,
  fox: /grass_block|snow|podzol|coarse_dirt/,
  wolf: /grass_block|snow|podzol|coarse_dirt/,
  panda: /grass_block|podzol|bamboo/,
  llama: /grass_block|stone|snow/,
  sniffer: /grass_block/
};
function spawnCatOf(e) {
  return e.T ? e.T.cat || (e.T.hostile ? 'monster' : 'creature') : null;
}
// vanilla leaves only the mobs that must be kept (named, leashed, ridden, from a bucket) out of the counts;
// animals never despawn but still fill their category's cap (`persistent` here only means "never despawns")
function spawnMustKeep(e) {
  return !!(e.customName || e.leashHolder || e.rider || e.fromBucket || e.remote);
}
// the most of one kind a spawn attempt places (vanilla getMaxSpawnClusterSize: 4; ghasts 1, wolves 8, salmon 5)
const SPAWN_CLUSTER = {
  ghast: 1,
  wolf: 8,
  salmon: 5
};
// The area spawning covers and counts in (vanilla: the 17 x 17 chunks around a player, each cap scaled by the chunks it
// can spawn in, cap * chunks / 289): the loaded chunks whose middle is within 104 blocks (Mob despawns past 100), mobs
// placed 24..96 blocks away, uniformly over the area like vanilla's one try per chunk. Before, the whole cap (70 from
// a view distance of 8) went into a 24..80 ring, thicker toward its inner edge: two to four times vanilla's density
// around the player - "晚上怪太多、成群", feedback 2026-10-31..11-03 (the nether uses it too: nether_mobs.js)
function spawnArea(g) {
  const p = g.player,
    w = g.world,
    px = p.pos[0],
    pz = p.pos[2],
    pcx = Math.floor(px) >> 4,
    pcz = Math.floor(pz) >> 4,
    list = [];
  const rd = Math.max(2, Math.min(16, g.settings && g.settings.renderDist || 8)),
    R = Math.min(104, (rd + 1) * 16);
  for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
    const cx = pcx + dx,
      cz = pcz + dz;
    if (Math.hypot(cx * 16 + 8 - px, cz * 16 + 8 - pz) <= R && w.chunks.has(ckey(cx, cz))) list.push(cx, cz);
  }
  const n = list.length / 2;
  return {
    n,
    scale: n / 289,
    has: (x, z) => Math.hypot(x - px, z - pz) <= R,
    pick: () => {
      if (!n) return null;
      const i = Math.floor(Math.random() * n) * 2;
      return [list[i] * 16 + randInt(0, 15), list[i + 1] * 16 + randInt(0, 15)];
    },
    ok: (x, z) => {
      const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz);
      return d >= 24 && d <= Math.min(96, R) && w.isLoaded(x, z);
    }
  };
}
// vanilla's sky darkening (Level.updateSkyBrightness): 0 by day, 11 at night, rain takes up to 5/16 off the daylight
function spawnDarken(g) {
  return Math.floor((1 - g.daylight() * (1 - clamp(g.weather || 0, 0, 1) * 5 / 16)) * 11);
}
// vanilla's slime chunks (WorldgenRandom.seedSlimeChunk with salt 987234911, then nextInt(10) == 0): the same chunks as
// vanilla's for the seed
function slimeChunk(g, cx, cz) {
  const w = g.world,
    m = w.slimeChunks || (w.slimeChunks = new Map()),
    k = cx + ',' + cz;
  let r = m.get(k);
  if (r === undefined) {
    let seed = 0n;
    try {
      seed = BigInt(g.worldMeta && g.worldMeta.seed != null ? g.worldMeta.seed : w.seed | 0);
    } catch (e) {
      seed = BigInt(w.seed | 0);
    }
    const s = BigInt.asIntN(64, seed + BigInt(Math.imul(Math.imul(cx, cx), 4987142)) + BigInt(Math.imul(cx, 5947611)) + BigInt(Math.imul(cz, cz)) * 4392871n + BigInt(Math.imul(cz, 389711))) ^ 987234911n;
    r = new WG.JavaRandom(s).nextIntB(10) === 0;
    if (m.size > 4096) m.clear();
    m.set(k, r);
  }
  return r;
}
const MOON_BRIGHT = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];
// vanilla's Halloween (Oct 20 .. Nov 3): bats come in darker light
function spawnHalloween() {
  const d = new Date(),
    mo = d.getMonth() + 1,
    day = d.getDate();
  return mo === 10 && day >= 20 || mo === 11 && day <= 3;
}
// One spawn attempt as vanilla's NaturalSpawner.spawnCategoryForPosition: one height for the whole attempt (the start
// spot at `y` has already passed), up to three groups walking out from the start column by -5..5 blocks a step, each
// of one kind (the first `pick`, later ones from `again(x, z)`) with the list's count of tries, every mob on a spot of
// its own at that same height that passes `spot(type, x, y, z)` (its own light roll too), at most 4 in all (ghasts 1).
// Before: one group of the list's full count within +-3 blocks, each mob free to move 2 blocks up or down for a floor
// with a light roll at each height (none that could fail at night): packs of 4 nearly every time - "怪成群", feedback
// 2026-11-01..03. Returns how many were placed.
function spawnAttempt(g, pick, x0, y, z0, sp, spot, again, made) {
  let total = 0;
  for (let k = 0; k < 3; k++) {
    let x = x0,
      z = z0,
      s = k ? null : pick,
      type = null,
      n = k ? Math.ceil(Math.random() * 4) : 1;
    for (let q = 0; q < n; q++) {
      if (k || q) {
        x += randInt(0, 5) - randInt(0, 5);
        z += randInt(0, 5) - randInt(0, 5);
        if (!sp.ok(x, z)) continue;
      }
      if (!s && !(s = again(x, z))) break;
      if (!type) {
        type = s.type.replace('minecraft:', '');
        n = s.minCount + randInt(0, s.maxCount - s.minCount);
      }
      if ((k || q) && !spot(type, x, y, z)) continue;
      const m = createMob(g, type, x + 0.5, y, z + 0.5);
      if (!m || m.collides(m.box())) continue;
      if (made) made(m);
      g.entities.push(m);
      if (++total >= (SPAWN_CLUSTER[type] || 4)) return total;
    }
  }
  return total;
}
// a kind from a spawn list (only the mobs this game has), by weight
function spawnPickOf(list) {
  if (!list || !list.length) return null;
  let tot = 0,
    last = null;
  for (const s of list) if (MOB_TYPES[s.type.replace('minecraft:', '')]) {
    tot += s.weight;
    last = s;
  }
  if (!last) return null;
  let r = Math.random() * tot;
  for (const s of list) {
    if (!MOB_TYPES[s.type.replace('minecraft:', '')]) continue;
    if ((r -= s.weight) < 0) return s;
  }
  return last;
}
// the biome whose spawn lists apply here: a superflat world (the older format, no vanilla biome data) is vanilla's
// default superflat, all plains - it had the older generator's spawning, five monsters and no slimes
let SPAWN_FLAT = null;
function spawnBiome(g, x, z) {
  if (g.world && g.world.flat) return SPAWN_FLAT || (SPAWN_FLAT = self.WG_DATA && WG_DATA.biome.plains ? {
    name: 'plains',
    def: WG_DATA.biome.plains
  } : null);
  return g.vbiomeAt ? g.vbiomeAt(x, z) : null;
}
// a structure's own spawn list for the category at this spot, or null (vanilla NaturalSpawner.mobsAt: spawn_overrides -
// pillager outposts their pillagers, swamp huts witches, ancient cities nothing); inside the structure's box. The pieces'
// own boxes are not kept, so of the "piece" ones only the swamp hut's (one piece) counts - not the trial chambers' whole
// box of rock. Without `y`, by the column only
function spawnOverride(g, cat, x, y, z) {
  const w = g.world,
    refs = w.structRefs,
    S = self.STRUCT_DATA && STRUCT_DATA.structure;
  if (!refs || !refs.size || !S) return null;
  // (only the refs of structures with overrides, kept while the map does not change: it holds every structure seen)
  let c = w._spawnOvr;
  if (!c || c.refs !== refs || c.n !== refs.size) {
    c = w._spawnOvr = {
      refs,
      n: refs.size,
      list: []
    };
    for (const s of refs.values()) if (S[s.name] && S[s.name].spawn_overrides && Object.keys(S[s.name].spawn_overrides).length) c.list.push(s);
  }
  const vy = y == null ? null : y + (w.minY || 0);
  for (const s of c.list) {
    const o = S[s.name].spawn_overrides[cat],
      b = s.box;
    if (o && (o.bounding_box !== 'piece' || s.name === 'swamp_hut') && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && (vy == null || vy >= b[1] && vy <= b[4])) return o.spawns || [];
  }
  return null;
}
// the block a land animal stands on in this column: below the leaves (vanilla's MOTION_BLOCKING_NO_LEAVES heightmap for
// animals; surfaceY stops on the canopy, so no animal came under the trees of a forest or taiga), stopping at a fluid
function spawnGroundY(w, x, z) {
  let y = w.surfaceY(x, z);
  for (let id = w.getBlock(x, y, z); y > 1 && (/_leaves$/.test(BLOCKS[id].key) || !BLOCKS[id].solid && !IS_FLUID[id]); id = w.getBlock(x, --y, z));
  return y;
}
// the block a creature stands on: parrots and ocelots also on the canopy (vanilla SpawnPlacements: MOTION_BLOCKING)
function spawnStandY(w, type, x, z) {
  return type === 'parrot' || type === 'ocelot' ? w.surfaceY(x, z) : spawnGroundY(w, x, z);
}
Game.prototype.spawnPick = function (cat, x, z, y) {
  const o = y != null ? spawnOverride(this, cat, x, y, z) : null;
  if (o) return spawnPickOf(o);
  const v = spawnBiome(this, x, z);
  return spawnPickOf(v && v.def && v.def.spawners && v.def.spawners[cat]);
};
const _oldSpawnMobs = Game.prototype.spawnMobs;
Game.prototype.spawnMobs = function () {
  const p = this.player;
  // worlds from the older generator have no vanilla biome data: their own spawning
  const v0 = spawnBiome(this, Math.floor(p.pos[0]), Math.floor(p.pos[2]));
  if (!v0 || !v0.def || !v0.def.spawners) return _oldSpawnMobs.call(this);
  // occasional ones
  if (this.tickCount % 24000 === 1200 && this.trySpawnTrader) this.trySpawnTrader();
  if (this.tickCount % 1200 === 0 && this.trySpawnPhantoms) this.trySpawnPhantoms();
  const sp = spawnArea(this);
  if (!sp.n) return;
  const counts = {};
  for (const e of this.entities) {
    if (!(e instanceof Mob) || e.dead || spawnMustKeep(e) || !sp.has(e.pos[0], e.pos[2])) continue;
    const c = spawnCatOf(e);
    counts[c] = (counts[c] || 0) + 1;
  }
  const dark = spawnDarken(this);
  for (const cat in SPAWN_CAPS) {
    const cap = Math.max(1, Math.round(SPAWN_CAPS[cat] * sp.scale));
    if ((counts[cat] || 0) >= cap) continue;
    if (cat === 'monster' && this.difficulty === 0) continue;
    // animals (vanilla: mostly with new chunks - Game.spawnAnimals -, then every 400 ticks a try in each chunk around,
    // up to the cap; it was one try in 20 seconds for the whole area)
    if (cat === 'creature' && this.tickCount % 400 !== 0) continue;
    for (let attempt = 0, tries = cat === 'creature' ? sp.n : cat === 'monster' ? 3 : 1; attempt < tries && (counts[cat] || 0) < cap; attempt++) {
      const at = sp.pick();
      if (!at || !sp.ok(at[0], at[1])) continue;
      const [x, z] = at;
      // (a structure's own list where there is one for this column: pillager outposts - checked again at the height; an
      // empty one, an ancient city's, only decides at the height, so the ground and caves above it keep the biome's)
      const own = spawnOverride(this, cat, x, null, z),
        fromOwn = !!(own && own.length);
      let pick = fromOwn ? spawnPickOf(own) : this.spawnPick(cat, x, z);
      if (!pick) continue;
      const y = this.spawnY(cat, pick.type.replace('minecraft:', ''), x, z, dark);
      if (y == null) continue;
      if (own) {
        const at = spawnOverride(this, cat, x, y, z);
        if ((at ? at !== own || !fromOwn : fromOwn) && (!(pick = at ? spawnPickOf(at) : this.spawnPick(cat, x, z)) || this.spawnY(cat, pick.type.replace('minecraft:', ''), x, z, dark, y) == null)) continue;
      }
      counts[cat] = (counts[cat] || 0) + spawnAttempt(this, pick, x, y, z, sp, (t, sx, sy, sz) => this.spawnY(cat, t, sx, sz, dark, sy) != null, (sx, sz) => this.spawnPick(cat, sx, sz, y), m => {
        if (cat !== 'creature') m.persistent = false;else if (Math.random() < 0.1 && m.makeBaby && !m.T.hostile) m.makeBaby();
      });
      if (cat !== 'creature') break;
    }
  }
};
// vanilla Slime.checkSlimeSpawnRules: in a swamp at 51..69 by the moon's brightness and the light, or below 40 in a slime
// chunk (one in 10) one time in 10, at any light. The list has slimes in every biome: before, below -24 (a y counted from
// the bottom, 40) every pick of them spawned, in every chunk - slimes all through the deep caves; above it only in swamps
// a new chunk's animals (vanilla NaturalSpawner.spawnMobsForChunkGeneration; Game.spawnAnimals made the first roll under
// the biome's creature_spawn_probability): a group from the biome's creature list - wolves, horses, rabbits, foxes ... as
// the biome has them, it was pigs, cows, sheep and chickens everywhere - then another while a roll stays under it; each of
// the kind's count, on the ground of a column walking from the group's start within the chunk, 4 tries each
Game.prototype.spawnChunkAnimals = function (ch, v) {
  var _v$def$creature_spawn;
  const w = this.world,
    x0 = ch.cx * 16,
    z0 = ch.cz * 16,
    prob = (_v$def$creature_spawn = v.def.creature_spawn_probability) !== null && _v$def$creature_spawn !== void 0 ? _v$def$creature_spawn : 0.1;
  do {
    const pick = spawnPickOf(v.def.spawners.creature);
    if (!pick) return;
    const type = pick.type.replace('minecraft:', ''),
      n = pick.minCount + randInt(0, pick.maxCount - pick.minCount);
    const sx = x0 + randInt(0, 15),
      sz = z0 + randInt(0, 15);
    let x = sx,
      z = sz;
    for (let i = 0; i < n; i++) {
      for (let a = 0, done = false; !done && a < 4; a++) {
        const y = this.spawnY('creature', type, x, z, 0, spawnStandY(w, type, x, z) + 1),
          m = y != null && createMob(this, type, x + 0.5, y, z + 0.5);
        if (m && !m.collides(m.box())) {
          if (i > 0 && Math.random() < 0.05 && m.makeBaby) m.makeBaby();
          this.entities.push(m);
          done = true;
        }
        x += randInt(0, 4) - randInt(0, 4);
        z += randInt(0, 4) - randInt(0, 4);
        while (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) {
          x = sx + randInt(0, 4) - randInt(0, 4);
          z = sz + randInt(0, 4) - randInt(0, 4);
        }
      }
    }
  } while (Math.random() < prob);
};
// (a superflat world's ground is vanilla superflat's, from -64: slimes in its slime chunks as there)
Game.prototype.slimeSpawnOk = function (x, y, z, sky, blk, dark) {
  const wy = y + (this.world.flat ? -64 : this.world.minY || 0),
    moon = MOON_BRIGHT[(Math.floor(this.worldTime / 24000) % 8 + 8) % 8];
  if (wy > 50 && wy < 70 && /swamp/.test(biomeName(this, x, z)) && Math.random() < 0.5 && Math.random() < moon && Math.max(sky - dark, blk) <= randInt(0, 7)) return true;
  return wy < 40 && Math.random() < 0.1 && slimeChunk(this, x >> 4, z >> 4);
};
// a y to spawn at in this column for a category, or null (the light and block rules); `dark`: the sky darkening
// (spawnDarken); `near`: only that height (the rest of a spawn attempt, which keeps the attempt's one height)
Game.prototype.spawnY = function (cat, type, x, z, dark, near) {
  const w = this.world,
    surf = w.surfaceY(x, z),
    py = Math.floor(this.player.pos[1]);
  // (not a cell with water: kelp and seagrass are neither solid nor a fluid, so monsters spawned on the dark sea floor
  // among them and swam up - "白天海上刷怪", feedback 2026-11-01/02)
  const air = y => {
    const id = w.getBlock(x, y, z);
    return id === 0 || !BLOCKS[id].solid && !IS_FLUID[id] && !WLOG[id] && !w.isWaterlogged(x, y, z);
  };
  const water = y => {
    const id = w.getBlock(x, y, z);
    return id === WATER || !!WLOG[id];
  };
  if (cat === 'water_creature' || cat === 'water_ambient' || cat === 'underground_water_creature' || cat === 'axolotls') {
    const deep = cat === 'underground_water_creature' || cat === 'axolotls';
    // vanilla heights (this world's y counts from its bottom, SEA is its top water layer): squid, fish and dolphins 13
    // below the sea level up to it with water below and above (WaterAnimal.checkSurfaceWaterAnimalSpawnRules); glow
    // squids 33 and more below it where no light reaches (GlowSquid.checkGlowSquidSpawnRules). Written for a y from
    // 0, fish and squid were looked for inside the sea floor (only flooded caves under it got them) and glow squids
    // only far deeper (its 30 meant vanilla's y), in block light too
    let y = near;
    if (y == null) {
      const lo = deep ? Math.max(1, py - 48) : SEA - 12,
        hi = deep ? Math.min(SEA - 32, py + 24) : SEA - 1;
      if (lo > hi) return null;
      y = randInt(lo, hi);
    }
    if (!water(y) || !water(y + 1)) return null;
    if (deep ? w.getLight(x, y, z) !== 0 : !water(y - 1)) return null;
    return y;
  }
  if (cat === 'ambient') {
    // vanilla Bat.checkBatSpawnRules: below the sea level, on a floor, in the light the hour leaves within a roll of
    // 0..3 (0..6 around Halloween; outside it half the tries fail first) - it was capped at 62 counted from the bottom
    let y = near;
    if (y == null) {
      const lo = Math.max(1, py - 48),
        hi = Math.min(SEA, surf - 4, py + 24);
      if (lo > hi) return null;
      y = randInt(lo, hi);
    }
    if (y > SEA || !SOLIDCUBE[w.getBlock(x, y - 1, z)] || !air(y) || !air(y + 1)) return null;
    const l = w.getLight(x, y, z),
      hw = spawnHalloween();
    if (!hw && Math.random() < 0.5) return null;
    if (Math.max((l >> 4) - dark, l & 15) > randInt(0, hw ? 6 : 3)) return null;
    return y;
  }
  // drowned: vanilla Drowned.checkDrownedSpawnRules (placed in water): water there and below, no solid block above, dark
  // enough as any monster, then one try in 15 in rivers, or one in 40 at least 5 below the sea level elsewhere. Since
  // water stopped counting as room for the monsters below (11-02), none spawned at all (no tridents from them)
  if (type === 'drowned') {
    let y = near;
    if (y == null) {
      const lo = Math.max(1, Math.min(surf + 2, py - 48)),
        hi = SEA;
      if (lo > hi) return null;
      y = randInt(lo, hi);
    }
    if (!water(y) || !water(y - 1) || SOLIDCUBE[w.getBlock(x, y + 1, z)]) return null;
    const l = w.getLight(x, y, z),
      sky = l >> 4,
      blk = l & 15;
    if (sky > randInt(0, 31) || blk > 0 || Math.max(sky - dark, blk) > randInt(0, 7)) return null;
    return Math.random() < (/river/.test(biomeName(this, x, z)) ? 1 / 15 : y <= SEA - 5 ? 1 / 40 : 0) ? y : null;
  }
  // guardians (an ocean monument's list): vanilla Guardian.checkGuardianSpawnRules, placed in water - water there and
  // below, no solid block above, then one try in 20 where the sky shows through the water (no light rule). They went down
  // the land path, which wants air, so none spawned
  if (type === 'guardian' || type === 'elder_guardian') {
    let y = near;
    if (y == null) {
      const lo = Math.max(1, Math.min(surf, py - 48)),
        hi = SEA;
      if (lo > hi) return null;
      y = randInt(lo, hi);
    }
    if (!water(y) || !water(y - 1) || SOLIDCUBE[w.getBlock(x, y + 1, z)]) return null;
    return surf < y && Math.random() >= 1 / 20 ? null : y;
  }
  // monsters and creatures: on a solid block with room above
  const cand = near != null ? [near] : cat === 'creature' ? [spawnStandY(w, type, x, z) + 1] : Math.random() < 0.4 ? [surf + 1] : [randInt(Math.max(1, Math.min(surf, py - 48)), surf)];
  for (const y0 of cand) {
    let y = y0;
    if (near == null && cat === 'monster' && !air(y)) {
      for (let k = 0; k < 12 && !air(y); k++) y++;
    }
    const below = w.getBlock(x, y - 1, z),
      bk = BLOCKS[below].key;
    // (leaves are not opaque: parrots and ocelots may still stand on them - vanilla LeavesBlock isValidSpawn)
    if (!(SOLIDCUBE[below] || (type === 'parrot' || type === 'ocelot') && /_leaves$/.test(bk)) || !air(y) || !air(y + 1)) continue;
    if (bk === 'bedrock' || bk === 'barrier' || bk === 'magma_block' && !MOB_TYPES[type].fireproof) continue;
    const l = w.getLight(x, y, z),
      sky = l >> 4,
      blk = l & 15;
    if (cat === 'monster') {
      // vanilla Monster.isDarkEnoughToSpawn: the sky light over a roll of 0..31 fails at any hour, any block light fails,
      // then the light the hour leaves (the sky less the darkening, or the block light) must be within a roll of 0..7.
      // Before, only the last, with the sky scaled to nothing at night: every dark spot took a mob, open ground at night
      // four times as often as vanilla
      if (type === 'slime') {
        if (!this.slimeSpawnOk(x, y, z, sky, blk, dark)) continue;
      }
      // (pillagers at an outpost: any sky light, block light up to 8 - PatrollingMonster.checkPatrollingMonsterSpawnRules)
      else if (type === 'pillager') {
        if (blk > 8) continue;
      } else if (sky > randInt(0, 31) || blk > 0 || Math.max(sky - dark, blk) > randInt(0, 7)) continue;
    } else {
      if (l >> 4 < 9 && blk < 9) continue;
      const g2 = SPAWN_GROUND[type];
      if (g2 ? !g2.test(bk) : bk !== 'grass_block') continue;
    }
    return y;
  }
  return null;
};
// the spawn lists know about the mobs of 26.2; the old hostile list stays as the fallback without biome data
// Worlds saved before the counts above were fixed can hold hundreds of plain animals spawned while idling.
// Once per dimension: in each 128x128 area keep at most 40 of them (named, owned, tamed, saddled or bucket
// mobs are always kept).
const SPAWN_CLEAN_MAX = 40;
const _loadDimDataSpawn = Game.prototype.loadDimData;
Game.prototype.loadDimData = async function (dim) {
  const had = !!this.dimData[dim],
    d = await _loadDimDataSpawn.call(this, dim);
  const md = this.worldMeta && this.worldMeta.dims && this.worldMeta.dims[dim];
  const fixed = this.worldMeta && (this.worldMeta.capFix || (this.worldMeta.capFix = {}));
  if (had || !md || !fixed || fixed[dim]) return d;
  fixed[dim] = 1;
  const cells = new Map(),
    drop = new Set();
  for (const m of d.pendingMobs) {
    const T = MOB_TYPES[m.type],
      x = m.x || {};
    if (!T || T.cat !== 'creature' || x.name || x.own || x.tame || x.trust || x.fb || x.sad || x.sit) continue;
    const k = Math.floor(m.pos[0] / 128) + ',' + Math.floor(m.pos[2] / 128);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(m);
  }
  for (const list of cells.values()) {
    if (list.length <= SPAWN_CLEAN_MAX) continue;
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    for (let i = SPAWN_CLEAN_MAX; i < list.length; i++) drop.add(list[i]);
  }
  if (drop.size) {
    d.pendingMobs = d.pendingMobs.filter(m => !drop.has(m));
    console.log('[spawning] removed ' + drop.size + ' extra animals from the save (' + dim + ')');
  }
  return d;
};
