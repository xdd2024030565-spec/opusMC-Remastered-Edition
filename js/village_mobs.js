
'use strict';

// ---------------------------------------------------------------------------
// Village mobs: villagers (biome type + profession skins), zombie villagers, iron golems and cats.
// Models are the vanilla Java models converted to this renderer's space (x mirrored, y up):
// root pivot (-x, 24 - y, z), child pivot (-x, -y, z), box (-(x + w), -(y + h), z), rotX/rotY negated.
// ---------------------------------------------------------------------------
Object.assign(MOB_TYPES, {
  villager: {
    cn: '村民',
    hp: 20,
    w: 0.6,
    h: 1.95,
    speed: 0.22,
    model: 'villager',
    passive: true,
    drops: [],
    scale: 0.9375
  },
  zombie_villager: {
    cn: '僵尸村民',
    hp: 20,
    w: 0.6,
    h: 1.95,
    speed: 0.23,
    model: 'zombie_villager',
    hostile: true,
    attack: 3,
    armor: 2,
    burns: true,
    drops: [['rotten_flesh', 0, 2]],
    scale: 0.9375
  },
  iron_golem: {
    cn: '铁傀儡',
    hp: 100,
    w: 1.4,
    h: 2.7,
    speed: 0.2,
    model: 'iron_golem',
    drops: [['iron_ingot', 3, 5], ['poppy', 0, 2]],
    scale: 1
  },
  cat: {
    cn: '猫',
    hp: 10,
    w: 0.6,
    h: 0.7,
    speed: 0.3,
    model: 'cat',
    passive: true,
    food: 'cod',
    drops: [['string', 0, 2]],
    scale: 0.8
  }
});
(() => {
  const prev = createMob;
  createMob = function (game, type, x, y, z) {
    if (type === 'villager') return new Villager(game, x, y, z);
    if (type === 'iron_golem') return new IronGolem(game, x, y, z);
    if (type === 'cat') return new Cat(game, x, y, z);
    return prev(game, type, x, y, z);
  };
})();
const VILLAGER_TYPES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga'];
const PROFESSIONS = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith'];
const PROFESSION_CN = {
  none: '村民',
  armorer: '盔甲匠',
  butcher: '屠夫',
  cartographer: '制图师',
  cleric: '牧师',
  farmer: '农民',
  fisherman: '渔夫',
  fletcher: '制箭师',
  leatherworker: '皮匠',
  librarian: '图书管理员',
  mason: '石匠',
  nitwit: '傻子',
  shepherd: '牧羊人',
  toolsmith: '工具匠',
  weaponsmith: '武器匠'
};
// villager type from the biome (VillagerType.byBiome)
function villagerTypeAt(game, x, z) {
  const v = game.vbiomeAt && game.vbiomeAt(Math.floor(x), Math.floor(z));
  const n = v && v.name || 'plains';
  if (/desert|badlands/.test(n)) return 'desert';
  if (/jungle|bamboo/.test(n)) return 'jungle';
  if (/savanna/.test(n)) return 'savanna';
  if (/snowy|frozen|ice|grove|jagged|frozen_peaks/.test(n)) return 'snow';
  if (/swamp|mangrove/.test(n)) return 'swamp';
  if (/taiga/.test(n)) return 'taiga';
  return 'plains';
}
// job site blocks (PoiTypes) -> profession
const JOB_SITES = {
  composter: 'farmer',
  smoker: 'butcher',
  blast_furnace: 'armorer',
  cartography_table: 'cartographer',
  brewing_stand: 'cleric',
  barrel: 'fisherman',
  fletching_table: 'fletcher',
  cauldron: 'leatherworker',
  water_cauldron: 'leatherworker',
  lava_cauldron: 'leatherworker',
  powder_snow_cauldron: 'leatherworker',
  lectern: 'librarian',
  stonecutter: 'mason',
  loom: 'shepherd',
  smithing_table: 'toolsmith',
  grindstone: 'weaponsmith'
};
// composite skin (base + biome type + profession), built once per combination
function villagerSkin(r, zombie, type, prof) {
  const key = (zombie ? 'zv_' : 'v_') + type + '_' + prof;
  if (r.entityTex[key]) return key;
  const I = r.images,
    base = I[zombie ? 'zombie_villager' : 'villager'];
  if (!base) return zombie ? 'zombie' : 'steve';
  const c = document.createElement('canvas');
  c.width = base.width;
  c.height = base.height;
  const x = c.getContext('2d');
  x.drawImage(base, 0, 0);
  const t = I[(zombie ? 'zvt_' : 'vt_') + type];
  if (t) x.drawImage(t, 0, 0);
  const p = prof !== 'none' && I[(zombie ? 'zvp_' : 'vp_') + prof];
  if (p) x.drawImage(p, 0, 0);
  r.entityTex[key] = r.tex2D(c);
  return key;
}
const entityTexOf = (r, key) => {
  if (!r.entityTex[key] && r.images[key]) r.entityTex[key] = r.tex2D(r.images[key]);
  return key;
};

// ---- Villager -----------------------------------------------------------------------------------
class Villager extends Mob {
  constructor(g, x, y, z) {
    super(g, 'villager', x, y, z);
    this.persistent = true;
    this.vtype = villagerTypeAt(g, x, z);
    this.profession = Math.random() < 0.6 ? PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)] : 'none';
    this.home = [x, y, z];
    this.shake = 0;
  }
  skin(r) {
    return villagerSkin(r, false, this.vtype || 'plains', this.profession || 'none');
  }
  saveData() {
    return {
      t: this.vtype,
      p: this.profession,
      h: this.home,
      tr: this.trades,
      lv: this.vlevel,
      xp: this.vxp,
      rd: this.restockDay,
      j: this.job
    };
  }
  loadData(d) {
    this.vtype = d.t || this.vtype;
    this.profession = d.p || 'none';
    if (d.h) this.home = d.h;
    if (d.tr) {
      this.trades = d.tr;
      this.vlevel = d.lv || 1;
      this.vxp = d.xp || 0;
    }
    this.restockDay = d.rd;
    this.job = d.j;
  }
  tick() {
    const g = this.game;
    // run from zombies, stay near home
    if (this.age % 10 === 0) {
      for (const e of g.entities) if (e instanceof Mob && (e.type === 'zombie' || e.type === 'zombie_villager') && !e.dead && e.distTo(this) < 8) {
        this.panic = 60;
        break;
      }
      if (!this.panic && !this.wander && Math.hypot(this.pos[0] - this.home[0], this.pos[2] - this.home[2]) > 24 && Math.random() < 0.2) {
        this.wander = [this.home[0], this.home[1], this.home[2]];
        this.wanderT = 200;
      }
    }
    if (this.shake > 0) this.shake--;
    if (!this.baby && this.age % 100 === 37) {
      // its job site gone (broken or swapped): vanilla lets the site go, and one that never traded loses its profession
      if (this.job && this.profession !== 'none') {
        const [jx, jy, jz] = this.job.split(',').map(Number),
          b = BLOCKS[this.world.getBlock(jx, jy, jz)];
        if (this.world.isLoaded(jx, jz) && !(b && JOB_SITES[b.key] === this.profession)) {
          this.job = null;
          if (!this.vxp && (this.vlevel || 1) <= 1) {
            this.profession = 'none';
            this.trades = null;
          }
        }
      }
      // unemployed adults claim a free job site nearby; one with a profession and no site looks for its own kind
      if (this.profession === 'none') this.findJob();else if (!this.job && this.profession !== 'nitwit' && this.age % 400 === 37) this.findJob(this.profession);
    }
    super.tick();
  }
  findJob(prof) {
    const g = this.game,
      w = this.world;
    // (the sites the living villagers hold: one that died or lost its job lets its site go)
    const claimed = new Set();
    for (const e of g.entities) if (e instanceof Villager && e !== this && !e.dead && e.job) claimed.add(e.job);
    // (and those of villagers waiting in unloaded chunks)
    for (const m of g.pendingMobs || []) if (m.type === 'villager' && m.x && m.x.j && !(m.health != null && m.health <= 0)) claimed.add(m.x.j);
    const bx = Math.floor(this.pos[0]),
      by = Math.floor(this.pos[1]),
      bz = Math.floor(this.pos[2]);
    for (let r = 1; r <= 16; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (let dy = -3; dy <= 3; dy++) {
        const b = BLOCKS[w.getBlock(bx + dx, by + dy, bz + dz)],
          job = b && JOB_SITES[b.key],
          k = bx + dx + ',' + (by + dy) + ',' + (bz + dz);
        if (!job || claimed.has(k) || prof && job !== prof) continue;
        this.job = k;
        if (prof) return;
        this.profession = job;
        this.trades = null;
        for (let i = 0; i < 6; i++) g.particles.spawn('happy_villager', this.pos[0] + (Math.random() - 0.5), this.pos[1] + 1.5 + Math.random() * 0.5, this.pos[2] + (Math.random() - 0.5), 0, 0.05, 0);
        return;
      }
    }
  }
  interact(p) {
    // trading arrives with the merchant screen; for now villagers shake their heads like unemployed ones
    if (typeof MerchantScreen !== 'undefined' && this.profession !== 'none' && this.profession !== 'nitwit' && !this.baby) {
      this.game.ui.open(new MerchantScreen(this.game, this));
      Sound.ev('entity.villager.trade', this.pos, 1, 1);
      return true;
    }
    this.shake = 40;
    Sound.ev('entity.villager.no', this.pos, 1, 1);
    return true;
  }
  // killed by a zombie on Normal (half the time) or Hard, it rises as a zombie villager keeping its type, profession
  // and trades, and drops nothing (vanilla Zombie.killedEntity / convertVillagerToZombieVillager)
  die(src) {
    const z = src && src.attacker,
      d = this.game.difficulty;
    if (z && /^(zombie|zombie_villager|husk|drowned|zombified_piglin)$/.test(z.type) && d >= 2 && (d === 3 || Math.random() < 0.5)) {
      const m = createMob(this.game, 'zombie_villager', this.pos[0], this.pos[1], this.pos[2]);
      m.vtype = this.vtype;
      m.profession = this.profession;
      m.trades = this.trades;
      m.vlevel = this.vlevel;
      m.vxp = this.vxp;
      m.yaw = this.yaw;
      m.bodyYaw = this.bodyYaw;
      m.headYaw = this.headYaw;
      if (this.baby) m.makeBaby();
      if (this.customName) m.customName = this.customName;
      // (vanilla: one that was traded with, or named, never despawns)
      if (this.vxp || this.customName) m.persistent = true;
      this.dead = true;
      if (Mob.modDeath) Mob.modDeath(this, src); // (mods' entityDeath still hears of it)
      this.game.addEntity(m);
      Sound.ev('entity.zombie.infect', this.pos, 1, 1);
      return;
    }
    super.die(src);
  }
  pose(a) {
    const swing = lerp(this.limbSwing - this.limbAmt, this.limbSwing, a) * 0.6662,
      amt = this.limbAmt;
    const l = Math.cos(swing) * 1.4 * amt * 0.5,
      r = Math.cos(swing + Math.PI) * 1.4 * amt * 0.5;
    const shake = this.shake > 0 ? 0.3 * Math.sin((this.shake - a) * 0.45) : 0;
    return {
      head: {
        ry: this.headYaw + shake,
        rx: this.pitch
      },
      rleg: {
        rx: l
      },
      lleg: {
        rx: r
      }
    };
  }
}

// ---- Iron golem ---------------------------------------------------------------------------------
class IronGolem extends Mob {
  // (vanilla: it doesn't jump - it steps up a whole block instead)
  constructor(g, x, y, z) {
    super(g, 'iron_golem', x, y, z);
    this.persistent = true;
    this.attackAnim = 0;
    this.noJump = true;
    this.stepHeight = 1;
  }
  // its texture, cracked like vanilla's below 3/4, 1/2 and 1/4 health. Without a skin of its own it looked for an
  // 'iron_golem' GL texture nobody made (the image was loaded, never uploaded) and was drawn black
  skin(r) {
    const f = this.health / this.maxHealth,
      crack = f < 0.25 ? 'high' : f < 0.5 ? 'medium' : f < 0.75 ? 'low' : null;
    const mix = crack && r.etexMix(['entity/iron_golem/iron_golem', 'entity/iron_golem/iron_golem_crackiness_' + crack]);
    return mix || entityTexOf(r, 'iron_golem');
  }
  tick() {
    const g = this.game;
    // guards the village: goes after hostile mobs nearby
    if (this.age % 20 === 0 && (!this.target || this.target.dead || this.target.deathTime > 0)) {
      this.target = null;
      let best = 16;
      for (const e of g.entities) if (e instanceof Mob && e.T.hostile && e.type !== 'creeper' && !e.dead && e.deathTime === 0) {
        const d = e.distTo(this);
        if (d < best) {
          best = d;
          this.target = e;
        }
      }
    }
    const before = this.attackCd;
    this.T = this.target ? GOLEM_HUNT : MOB_TYPES.iron_golem;
    super.tick();
    this.T = MOB_TYPES.iron_golem;
    if (this.attackCd === 20 && before !== 20) {
      this.attackAnim = 10;
      // (vanilla: the toss only when the blow did hurt - a target still hurt-immune from another golem's isn't thrown
      // higher - and less by its knockback resistance)
      const t = this.target;
      if (t && this.hitLanded && t.vel) t.vel[1] += 0.4 * Math.max(0, 1 - (t.T && t.T.kbRes || 0));
      Sound.ev('entity.iron_golem.attack', this.pos, 1, 1);
    }
    if (this.attackAnim > 0) this.attackAnim--;
  }
  // (knockback resistance 1, like vanilla: never pushed back by hits - players' feedback 2026-10-31)
  hurt(a, src) {
    if (src && src.knockFrom) src = {
      ...src,
      knockFrom: null
    };
    const r = super.hurt(a, src);
    if (r && src && src.attacker && src.attacker !== this.game.player) this.target = src.attacker;
    return r;
  }
  pose(a) {
    const t = lerp(this.limbSwing - this.limbAmt, this.limbSwing, a),
      amt = this.limbAmt;
    const tri = (x, p) => (Math.abs(x % p - p * 0.5) - p * 0.25) / (p * 0.25);
    const P = {
      head: {
        ry: this.headYaw,
        rx: this.pitch
      }
    };
    P.rleg = {
      rx: -1.5 * tri(t, 13) * amt
    };
    P.lleg = {
      rx: 1.5 * tri(t, 13) * amt
    };
    if (this.attackAnim > 0) {
      const k = (this.attackAnim - a) / 10;
      const v = 2 - 4 * Math.abs(k - 0.5);
      P.rarm = {
        rx: v
      };
      P.larm = {
        rx: v
      };
    } else {
      P.rarm = {
        rx: (-0.2 + 1.5 * tri(t, 13)) * amt
      };
      P.larm = {
        rx: (-0.2 - 1.5 * tri(t, 13)) * amt
      };
    }
    return P;
  }
}
const GOLEM_HUNT = Object.assign({}, MOB_TYPES.iron_golem, {
  attack: 10,
  speed: 0.25
});

// ---- Cat ------------------------------------------------------------------------------------------
const CAT_VARIANTS = ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie', 'all_black'];
class Cat extends Mob {
  constructor(g, x, y, z) {
    super(g, 'cat', x, y, z);
    this.variant = CAT_VARIANTS[Math.floor(Math.random() * CAT_VARIANTS.length)];
    this.persistent = true;
  }
  // (a tame one wears its collar, dyed - vanilla CatCollarLayer)
  skin(r) {
    const mix = this.owner && r.etexMix(['entity/cat/cat_' + this.variant, {
      p: 'entity/cat/cat_collar',
      c: dyeRGB(this.collar || 'red')
    }]);
    return mix || entityTexOf(r, 'cat_' + this.variant);
  }
  saveData() {
    return {
      v: this.variant,
      own: this.owner ? 1 : 0,
      sit: this.sitting ? 1 : 0,
      col: this.collar
    };
  }
  loadData(d) {
    if (d.v) this.variant = d.v;
    if (d.own) this.owner = this.game.player;
    this.sitting = !!d.sit;
    if (d.col) this.collar = d.col;
  }
  // taming as vanilla's Cat.mobInteract: raw cod or salmon, a 1 in 3 chance; tame, it sits or stands when clicked, is
  // healed or bred with the food, and its collar dyed (feeding a wild one only put it in love, it was never tamed)
  interact(p, held) {
    const g = this.game,
      k = held && ITEMS[held.id] && ITEMS[held.id].key,
      food = k === 'cod' || k === 'salmon';
    if (Mob.prototype.interact && Mob.prototype.interact.call(this, p, held)) return true; // (name tags, leads: mobitems.js)
    if (!this.owner) {
      if (!food) return false;
      useOne(g, p);
      Sound.ev('entity.cat.eat', this.pos, 1, 1);
      tryTame(this, p, 1 / 3);
      if (this.owner) this.sitT = undefined;
      return true;
    }
    if (this.owner !== p) return false;
    if (k && /_dye$/.test(k)) {
      if (this.collar === k.slice(0, -4)) return false;
      this.collar = k.slice(0, -4);
      useOne(g, p);
      return true;
    }
    if (food && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 2);
      useOne(g, p);
      Sound.ev('entity.cat.eat', this.pos, 1, 1);
      return true;
    }
    if (food && !this.baby && !this.loveT) {
      this.loveT = 600;
      useOne(g, p);
      Sound.ev('entity.cat.eat', this.pos, 1, 1);
      const mate = g.entities.find(o => o !== this && o instanceof Cat && o.owner && o.loveT > 0 && !o.baby && !o.dead && o.distTo(this) < 8);
      if (mate) {
        this.loveT = mate.loveT = 0;
        const b = createMob(g, 'cat', (this.pos[0] + mate.pos[0]) / 2, this.pos[1], (this.pos[2] + mate.pos[2]) / 2).makeBaby();
        b.variant = Math.random() < 0.5 ? this.variant : mate.variant;
        b.owner = this.owner;
        g.entities.push(b);
        g.dropXp(b.pos[0], b.pos[1] + 0.5, b.pos[2], 1 + (Math.random() * 7 | 0));
      }
      return true;
    }
    if (food) return false;
    this.sitting = !this.sitting;
    this.sitT = undefined;
    this.wander = null;
    return true;
  }
  // (hurt, a tame one gets up - TamableAnimal)
  hurt(a, src) {
    const r = super.hurt(a, src);
    if (r) this.sitting = false;
    return r;
  }
  tick() {
    // told to sit: stays down; otherwise sometimes sits for a while
    if (this.sitting) this.sitT = 2;else if (!this.panic && this.sitT === undefined && !this.owner && Math.random() < 0.002) this.sitT = 200 + Math.random() * 400;
    if (this.sitT !== undefined) {
      if (--this.sitT <= 0 || this.panic) this.sitT = undefined;else {
        this.wander = null;
      }
    }
    // a tame one keeps up with its owner (vanilla FollowOwnerGoal: walks after it past 6 blocks, jumps to it past 12)
    else if (this.owner && this.age % 10 === 0) {
      const c = {};
      if (PetMixin.followOwner.call(this, c) && c.goal) {
        this.wander = c.goal;
        this.wanderT = 20;
      }
    }
    // (sitting, it stays put - it still walked after the fish in a player's hand)
    const T = this.T;
    if (this.sitT !== undefined) this.T = Cat.SIT_T || (Cat.SIT_T = {
      ...T,
      speed: 0
    });
    super.tick();
    this.T = T;
  }
  pose(a) {
    const swing = lerp(this.limbSwing - this.limbAmt, this.limbSwing, a) * 0.6662,
      amt = this.limbAmt;
    const l = Math.cos(swing) * amt,
      r = Math.cos(swing + Math.PI) * amt;
    const P = {
      head: {
        ry: this.headYaw,
        rx: this.pitch
      },
      lfleg: {
        rx: l
      },
      rfleg: {
        rx: r
      },
      lhleg: {
        rx: r
      },
      rhleg: {
        rx: l
      }
    };
    if (this.sitT !== undefined) {
      // vanilla AdultFelineModel's sitting pose (pixel offsets y and x / rotations negated for this model's space; the
      // pose's rx adds to the part's own rotX: body pi/4, tail1 1.7278761, tail2 2.670354 in vanilla)
      const px = 1 / 16;
      P.body = {
        rx: Math.PI / 4,
        t: [0, 4 * px, 5 * px]
      };
      P.head.t = [0, 3.3 * px, 1 * px];
      P.lhleg = {
        rx: Math.PI / 2,
        t: [0, -3 * px, -4 * px]
      };
      P.rhleg = {
        rx: Math.PI / 2,
        t: [0, -3 * px, -4 * px]
      };
      P.lfleg = {
        rx: Math.PI / 20,
        t: [0, -2 * px, -2 * px]
      };
      P.rfleg = {
        rx: Math.PI / 20,
        t: [0, -2 * px, -2 * px]
      };
      P.tail1 = {
        rx: -1.7278761 + 0.9,
        t: [0, -8 * px, -2 * px]
      };
      P.tail2 = {
        rx: -2.670354 + 1.7,
        t: [0, -2 * px, -0.8 * px]
      };
    }
    return P;
  }
}

// zombie villagers: zombies with the villager body and skins
(() => {
  const prevCreate = createMob;
  createMob = function (game, type, x, y, z) {
    if (type === 'zombie_villager') {
      const m = new Mob(game, 'zombie_villager', x, y, z);
      m.vtype = villagerTypeAt(game, x, z);
      m.profession = 'none';
      m.skin = r => villagerSkin(r, true, m.vtype || 'plains', m.profession || 'none');
      // (a villager a zombie turned keeps its type, profession and trades in the save)
      m.saveData = function () {
        const o = Mob.prototype.saveData && Mob.prototype.saveData.call(this) || {};
        o.t = this.vtype;
        o.p = this.profession;
        if (this.trades) {
          o.tr = this.trades;
          o.lv = this.vlevel;
          o.xp = this.vxp;
        }
        if (this.customName) o.name = this.customName;
        return o;
      };
      // (a baby zombie villager never grows up, like baby zombies - Mob.makeBaby's 6000-tick countdown made it an adult;
      // tick holds it there too, for saves that restore the old countdown)
      m.makeBaby = function () {
        Mob.prototype.makeBaby.call(this);
        this.growT = 1e12;
        return this;
      };
      m.tick = function () {
        if (this.baby) this.growT = 1e12;
        return Mob.prototype.tick.call(this);
      };
      m.loadData = function (o) {
        if (Mob.prototype.loadData) Mob.prototype.loadData.call(this, o);
        if (!o) return;
        if (o.t) this.vtype = o.t;
        if (o.p) this.profession = o.p;
        if (o.tr) {
          this.trades = o.tr;
          this.vlevel = o.lv || 1;
          this.vxp = o.xp || 0;
        }
        if (o.name) this.customName = o.name;
      };
      m.pose = a => {
        const swing = lerp(m.limbSwing - m.limbAmt, m.limbSwing, a) * 0.6662,
          amt = m.limbAmt;
        const raise = Math.PI / 2 + Math.sin(m.age * 0.067) * 0.05;
        return {
          head: {
            ry: m.headYaw,
            rx: m.pitch
          },
          rarm: {
            rx: raise + (m.swingT > 0 ? Math.sin(m.swingT / 6 * Math.PI) * 0.6 : 0)
          },
          larm: {
            rx: raise
          },
          rleg: {
            rx: Math.cos(swing) * 1.4 * amt
          },
          lleg: {
            rx: Math.cos(swing + Math.PI) * 1.4 * amt
          }
        };
      };
      return m;
    }
    return prevCreate(game, type, x, y, z);
  };
})();

// ---- models -----------------------------------------------------------------------------------------
(() => {
  const proto = Renderer.prototype.initModels2;
  Renderer.prototype.initModels2 = function () {
    proto.call(this);
    const M = this.models;
    const P = (tw, th, parts) => {
      for (const p of parts) p.mesh = this.makeModelPart(p.boxes, tw, th);
      return {
        parts
      };
    };
    const head = [{
      name: 'head',
      pivot: [0, 24, 0],
      boxes: [[0, 0, -4, 0, -4, 8, 10, 8]]
    }, {
      name: 'hat',
      parent: 'head',
      pivot: [0, 0, 0],
      boxes: [[32, 0, -4, 0, -4, 8, 10, 8, 0.51]]
    }, {
      name: 'hat_rim',
      parent: 'hat',
      pivot: [0, 0, 0],
      rotX: Math.PI / 2,
      boxes: [[30, 47, -8, -8, -6, 16, 16, 1]]
    }, {
      name: 'nose',
      parent: 'head',
      pivot: [0, 2, 0],
      boxes: [[24, 0, -1, -3, -6, 2, 4, 2]]
    }, {
      name: 'body',
      pivot: [0, 24, 0],
      boxes: [[16, 20, -4, -12, -3, 8, 12, 6]]
    }, {
      name: 'jacket',
      parent: 'body',
      pivot: [0, 0, 0],
      boxes: [[0, 38, -4, -20, -3, 8, 20, 6, 0.5]]
    }, {
      name: 'rleg',
      pivot: [2, 12, 0],
      boxes: [[0, 22, -2, -12, -2, 4, 12, 4]]
    }, {
      name: 'lleg',
      pivot: [-2, 12, 0],
      boxes: [[0, 22, -2, -12, -2, 4, 12, 4, 0, true]]
    }];
    M.villager = P(64, 64, [...head, {
      name: 'arms',
      pivot: [0, 21, -1],
      rotX: 0.75,
      boxes: [[44, 22, 4, -6, -2, 4, 8, 4], [44, 22, -8, -6, -2, 4, 8, 4, 0, true], [40, 38, -4, -6, -2, 8, 4, 4]]
    }]);
    M.zombie_villager = P(64, 64, [...head.map(p => ({
      ...p,
      boxes: p.boxes.map(b => b.slice())
    })), {
      name: 'rarm',
      pivot: [5, 22, 0],
      boxes: [[44, 22, -1, -10, -2, 4, 12, 4]]
    }, {
      name: 'larm',
      pivot: [-5, 22, 0],
      boxes: [[44, 22, -3, -10, -2, 4, 12, 4, 0, true]]
    }]);
    M.iron_golem = P(128, 128, [{
      name: 'head',
      pivot: [0, 31, -2],
      boxes: [[0, 0, -4, 2, -5.5, 8, 10, 8], [24, 0, -1, 1, -7.5, 2, 4, 2]]
    }, {
      name: 'body',
      pivot: [0, 31, 0],
      boxes: [[0, 40, -9, -10, -6, 18, 12, 11], [0, 70, -4.5, -15, -3, 9, 5, 6, 0.5]]
    }, {
      name: 'rarm',
      pivot: [0, 31, 0],
      boxes: [[60, 21, 9, -27.5, -3, 4, 30, 6]]
    }, {
      name: 'larm',
      pivot: [0, 31, 0],
      boxes: [[60, 58, -13, -27.5, -3, 4, 30, 6]]
    }, {
      name: 'rleg',
      pivot: [4, 13, 0],
      boxes: [[37, 0, -2.5, -13, -3, 6, 16, 5]]
    }, {
      name: 'lleg',
      pivot: [-5, 13, 0],
      boxes: [[60, 0, -2.5, -13, -3, 6, 16, 5, 0, true]]
    }]);
    M.cat = P(64, 32, [{
      name: 'head',
      pivot: [0, 9, -9],
      boxes: [[0, 0, -2.5, -2, -3, 5, 4, 5], [0, 24, -1.5, -1.999, -4, 3, 2, 2], [0, 10, 1, 2, 0, 1, 1, 2], [6, 10, -2, 2, 0, 1, 1, 2]]
    }, {
      name: 'body',
      pivot: [0, 12, -10],
      rotX: -Math.PI / 2,
      boxes: [[20, 0, -2, -19, -8, 4, 16, 6]]
    }, {
      name: 'tail1',
      pivot: [0, 9, 8],
      rotX: -0.9,
      boxes: [[0, 15, -0.5, -8, 0, 1, 8, 1]]
    }, {
      name: 'tail2',
      pivot: [0, 4, 14],
      rotX: -1.7,
      boxes: [[4, 15, -0.5, -8, 0, 1, 8, 1]]
    }, {
      name: 'lhleg',
      pivot: [-1.1, 6, 5],
      boxes: [[8, 13, -1, -6, 1, 2, 6, 2]]
    }, {
      name: 'rhleg',
      pivot: [1.1, 6, 5],
      boxes: [[8, 13, -1, -6, 1, 2, 6, 2]]
    }, {
      name: 'lfleg',
      pivot: [-1.2, 9.9, -5],
      boxes: [[40, 0, -1, -10, 0, 2, 10, 2]]
    }, {
      name: 'rfleg',
      pivot: [1.2, 9.9, -5],
      boxes: [[40, 0, -1, -10, 0, 2, 10, 2]]
    }]);
  };
})();

// ---- items / eggs / spawning ----------------------------------------------------------------------------
for (const [m, cn] of [['villager', '村民'], ['zombie_villager', '僵尸村民'], ['iron_golem', '铁傀儡'], ['cat', '猫']]) {
  defItem(m + '_spawn_egg', cn + '刷怪蛋', {
    spawnEgg: m
  });
}
