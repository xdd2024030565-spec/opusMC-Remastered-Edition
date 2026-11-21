
'use strict';

// ---------------------------------------------------------------------------
// OpusMC 模组接口 (the mod SDK's API, 2026-11-09): a stable surface for mods made outside this project - by other
// people's or other models' agents with the SDK package (tools/modsdk) - so they never touch the game's own globals.
//   - data side, OpusMC.data(id, def): blocks, items, recipes, ores, textures. Runs in the page and in the terrain /
//     mesh workers (their data.js), so it only adds data: ids come from the installer (tools/modsdk/install_mod.js
//     writes them before the mod's own data.js, OpusMC._prelude), textures are the mod's textures/*.png
//   - code side, OpusMC.code(id, fn): events (tick, breaking, placing, using, attacking, the HUD ...), commands, keys,
//     the world, the player, a per-world store, simple menus. Page only, single player only (rooms are vanilla).
// Every handler of a mod runs guarded: its error is logged as [模组 id] and told once in the chat, the game goes on.
// The built-in mods (tconstruct, veinminer, nightvision) don't use it; it doesn't change anything for them.
// ---------------------------------------------------------------------------
(function () {
  const S = self,
    inPage = typeof window !== 'undefined' && typeof document !== 'undefined';
  const MOD_ID = /^[a-z][a-z0-9_]{1,31}$/;
  const O = S.OpusMC = S.OpusMC || {};
  O.version = 1;
  O.mods = O.mods || {}; // id -> { id, files, ids, textures, def, tiles, blocks:[keys], items:[keys], code }
  O.errors = O.errors || []; // [{ mod, where, message, stack, at }] (agents read it: OpusMC.errors)
  const mod = id => O.mods[id] || (O.mods[id] = {
    id,
    blocks: [],
    items: [],
    handlers: {},
    commands: [],
    keys: []
  });
  const fail = (id, where, e) => {
    const msg = String(e && e.message || e),
      last = O.errors[O.errors.length - 1];
    // (the same error again - a tick handler's, 20 a second - is counted, not listed again)
    if (last && last.mod === id && last.where === where && last.message === msg) {
      last.count++;
      last.at = Date.now();
      return;
    }
    O.errors.push({
      mod: id,
      where,
      message: msg,
      stack: e && e.stack ? String(e.stack) : '',
      at: Date.now(),
      count: 1
    });
    if (O.errors.length > 200) O.errors.shift();
    try {
      console.error('[模组 ' + id + '] ' + where + '：' + msg, e);
    } catch (x) {}
    fail.tell(id, where, msg);
  };
  // (told once per mod and place in the chat, so a broken tick handler doesn't flood it; before a world is open -
  // a mod's code starting - it waits for one)
  fail.told = new Set();
  fail.waiting = [];
  fail.tell = (id, where, msg) => {
    const g = S.game,
      k = id + '|' + where;
    if (!inPage || fail.told.has(k)) return;
    if (!(g && g.ui && g.ui.message && g.world && g.state === 'play')) {
      if (!fail.waiting.some(w => w[0] === id && w[1] === where)) fail.waiting.push([id, where, msg]);
      return;
    }
    fail.told.add(k);
    g.ui.message('[模组 ' + id + '] ' + where + ' 出错：' + msg.slice(0, 120), '#FF5555');
  };
  O._fail = fail;
  const guard = (id, where, fn, ...a) => {
    try {
      return fn(...a);
    } catch (e) {
      fail(id, where, e);
      return undefined;
    }
  };

  // ---- the installer's part: ids and texture files (tools/modsdk/install_mod.js puts it first in data.js) ----
  O._prelude = function (id, p) {
    const m = mod(id);
    m.ids = p.ids || {
      blocks: {},
      items: {}
    };
    m.textures = p.textures || [];
    m.version = p.version || '';
    m.name = p.name || id;
  };

  // ---- data side ---------------------------------------------------------------------------------------------
  const FACE_NAMES = ['west', 'east', 'down', 'up', 'north', 'south']; // (the game's face order; BLOCK_DATA tex is in it)
  const BLOCK_DISPLAY = {
    gui: {
      r: [30, 225, 0],
      t: [0, 0, 0],
      s: [0.625, 0.625, 0.625]
    },
    ground: {
      r: [0, 0, 0],
      t: [0, 3, 0],
      s: [0.25, 0.25, 0.25]
    },
    fixed: {
      r: [0, 0, 0],
      t: [0, 0, 0],
      s: [0.5, 0.5, 0.5]
    },
    firstperson_righthand: {
      r: [0, 45, 0],
      t: [0, 0, 0],
      s: [0.4, 0.4, 0.4]
    },
    firstperson_lefthand: {
      r: [0, 225, 0],
      t: [0, 0, 0],
      s: [0.4, 0.4, 0.4]
    },
    thirdperson_righthand: {
      r: [75, 45, 0],
      t: [0, 2.5, 0],
      s: [0.375, 0.375, 0.375]
    }
  };
  const ITEM_DISPLAY = {
    ground: {
      r: [0, 0, 0],
      t: [0, 2, 0],
      s: [0.5, 0.5, 0.5]
    },
    fixed: {
      r: [0, 180, 0],
      t: [0, 0, 0],
      s: [1, 1, 1]
    },
    firstperson_righthand: {
      r: [0, -90, 25],
      t: [1.13, 3.2, 1.13],
      s: [0.68, 0.68, 0.68]
    },
    thirdperson_righthand: {
      r: [0, 0, 0],
      t: [0, 3, 1],
      s: [0.55, 0.55, 0.55]
    },
    head: {
      r: [0, 180, 0],
      t: [0, 13, 7],
      s: [1, 1, 1]
    }
  };
  // (vanilla block / handheld write their own left hand - the game mirrors the right one where a model has none)
  const HANDHELD_DISPLAY = Object.assign({}, ITEM_DISPLAY, {
    firstperson_righthand: {
      r: [0, -90, 25],
      t: [1.13, 3.2, 1.13],
      s: [0.68, 0.68, 0.68]
    },
    thirdperson_righthand: {
      r: [0, -90, 55],
      t: [0, 4, 0.5],
      s: [0.85, 0.85, 0.85]
    },
    firstperson_lefthand: {
      r: [0, 90, -25],
      t: [1.13, 3.2, 1.13],
      s: [0.68, 0.68, 0.68]
    },
    thirdperson_lefthand: {
      r: [0, 90, -55],
      t: [0, 4, 0.5],
      s: [0.85, 0.85, 0.85]
    }
  });
  const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'];
  const ARMOR_SLOTS = {
    head: 0,
    chest: 1,
    legs: 2,
    feet: 3
  };
  const dataImpl = function (id, def) {
    var _r$xp, _r$time;
    if (!MOD_ID.test(id)) throw new Error('模组 id 不合规：' + id + '（小写字母开头，2-32 个小写字母 / 数字 / 下划线）');
    const m = mod(id);
    if (m.def) return; // (a page reloading the same script: once)
    m.def = def = def || {};
    if (!m.ids) throw new Error('模组 ' + id + ' 没有经过安装（缺少编号）：运行 node tools/install_mod.js');
    const own = k => k === id || k.startsWith(id + '_');
    const chk = (k, what) => {
      if (typeof k !== 'string' || !/^[a-z0-9_]+$/.test(k) || !own(k)) throw new Error(what + '「' + k + '」的名字要以「' + id + '_」开头，只用小写字母、数字、下划线');
    };
    // textures: the mod's textures/*.png in the installer's order, tiles from the next whole row of the texture strip
    // (the same in the page and the mesh worker: both run the vanilla assets and the mods in the same order)
    const texKey = n => id + ':' + n;
    m.tiles = {};
    if (S.ASSETS) {
      const A = S.ASSETS,
        at = Math.ceil(A.count / A.cols) * A.cols;
      m.textures.forEach((n, i) => {
        A.tiles[texKey(n)] = at + i;
        m.tiles[n] = at + i;
      });
      A.count = at + m.textures.length;
      if (m.textures.length) (A.extra || (A.extra = [])).push({
        files: m.textures.map(n => 'mods/' + id + '/textures/' + n + '.png'),
        at
      });
    }
    const tex = (n, where) => {
      if (n == null) return undefined;
      if (typeof n !== 'string') throw new Error(where + '：贴图名要是字符串');
      if (n.startsWith('minecraft:')) return n.slice(10); // (a vanilla tile by its name)
      if (!m.textures.includes(n)) throw new Error(where + '：没有贴图 textures/' + n + '.png');
      return texKey(n);
    };
    const models = {
      models: [],
      blocks: {},
      items: {}
    };
    const addModel = mdl => {
      models.models.push(mdl);
      return models.models.length - 1;
    };
    const variant = mi => ({
      variants: [[{}, [{
        m: mi,
        x: 0,
        y: 0,
        uvlock: false,
        w: 1
      }]]]
    });
    const face = (t, uv, cull) => ({
      uv: uv || [0, 0, 16, 16],
      tex: t,
      cull: cull || null,
      tint: -1,
      rot: 0
    });

    // ---- blocks ----
    const blocks = def.blocks || {};
    for (const k in blocks) {
      var _b$hardness, _b$needsTool;
      const b = blocks[k],
        where = '方块 ' + k;
      chk(k, '方块');
      const bid = m.ids.blocks[k];
      if (bid === undefined) throw new Error(where + ' 没有编号：改了方块以后要重新运行安装（node tools/install_mod.js）');
      const shape = b.shape || 'cube';
      const d = {
        key: k,
        id: bid,
        cn: String(b.name || k),
        hardness: (_b$hardness = b.hardness) !== null && _b$hardness !== void 0 ? _b$hardness : 1.5,
        sound: typeof b.sound === 'string' && /^[a-z_]+$/.test(b.sound) ? b.sound : 'stone'
      }; // (an unknown group sounds like a similar material - audio.js)
      if (b.tool) {
        if (!TOOL_TYPES.includes(b.tool)) throw new Error(where + '：tool 只能是 ' + TOOL_TYPES.join(' / '));
        d.tool = b.tool;
      }
      if (b.level) d.level = b.level | 0;
      if ((_b$needsTool = b.needsTool) !== null && _b$needsTool !== void 0 ? _b$needsTool : !!b.tool) d.needsTool = true;
      if (b.light) d.light = Math.max(0, Math.min(15, b.light | 0));
      if (b.slipperiness) d.slip = +b.slipperiness;
      if (b.climbable) d.climbable = true;
      if (b.fuel) d.fuel = b.fuel | 0;
      if (b.xp) d.xp = Array.isArray(b.xp) ? b.xp : [b.xp, b.xp];
      if (b.replaceable) d.replaceable = true;
      // drops: none, an item, or an item with a count range (like an ore)
      if (b.drops === 'none' || b.drops === null) d.drop = 'none';else if (typeof b.drops === 'string') d.drop = b.drops;else if (b.drops && b.drops.item) {
        var _b$drops$min, _ref, _b$drops$max;
        d.ore = b.drops.item;
        d.oreCount = [(_b$drops$min = b.drops.min) !== null && _b$drops$min !== void 0 ? _b$drops$min : 1, (_ref = (_b$drops$max = b.drops.max) !== null && _b$drops$max !== void 0 ? _b$drops$max : b.drops.min) !== null && _ref !== void 0 ? _ref : 1];
      }
      const textures = b.textures || {},
        all = tex(b.texture || textures.all, where);
      const faceTex = FACE_NAMES.map(f => tex(textures[f] || (f === 'up' ? textures.top : f === 'down' ? textures.bottom : textures.side) || b.texture || textures.all, where + ' 的 ' + f + ' 面'));
      if (shape === 'cube') {
        if (faceTex.some(t => !t)) throw new Error(where + '：方块要有 texture，或者 textures 里的 all / top / bottom / side / 各个面');
        d.kind = 'cube';
        d.tex = faceTex;
        d.particle = all || faceTex[0];
        if (b.transparent === 'cutout') d.cutout = true;else if (b.transparent) d.translucent = true;
        const mi = addModel({
          name: id + ':block/' + k,
          ao: true,
          gen: false,
          light: 'side',
          display: BLOCK_DISPLAY,
          elements: [{
            from: [0, 0, 0],
            to: [16, 16, 16],
            shade: true,
            faces: Object.fromEntries(FACE_NAMES.map((f, i) => [f, face(faceTex[i], null, f)]))
          }]
        });
        models.blocks[k] = variant(mi);
        models.items[k] = {
          m: mi
        };
      } else if (shape === 'cross') {
        if (!all) throw new Error(where + '：cross 形状要有 texture');
        d.kind = 'model';
        d.states = [{}];
        d.particle = all;
        d.nonsolid = true;
        if (b.plant !== false) d.plant = true;
        const pl = (from, to, fs) => ({
          from,
          to,
          shade: false,
          rot: {
            origin: [8, 8, 8],
            axis: 'y',
            angle: 45,
            rescale: true
          },
          faces: Object.fromEntries(fs.map(f => [f, face(all)]))
        });
        const mi = addModel({
          name: id + ':block/' + k,
          ao: false,
          gen: false,
          light: 'side',
          display: {},
          elements: [pl([0.8, 0, 8], [15.2, 16, 8], ['north', 'south']), pl([8, 0, 0.8], [8, 16, 15.2], ['west', 'east'])]
        });
        models.blocks[k] = variant(mi);
        models.items[k] = {
          m: addModel({
            name: id + ':item/' + k,
            ao: true,
            gen: true,
            light: 'front',
            display: ITEM_DISPLAY,
            layers: [all]
          })
        };
      } else if (shape === 'model') {
        // Minecraft-style elements: from / to in pixels (0-16), faces { north|south|east|west|up|down: { texture, uv, cullface, rotation } },
        // an element's rotation { origin, axis, angle (-45..45, steps of 22.5), rescale }
        const els = b.model && b.model.elements || [];
        if (!els.length) throw new Error(where + '：model 形状要有 model.elements');
        const elements = els.map((e, i) => {
          const faces = {};
          for (const f in e.faces || {}) {
            const fd = e.faces[f],
              fn = f === 'bottom' ? 'down' : f === 'top' ? 'up' : f;
            if (!FACE_NAMES.includes(fn)) throw new Error(where + ' 第 ' + (i + 1) + ' 个元件：面名 ' + f + ' 不对');
            faces[fn] = {
              uv: fd.uv || null,
              tex: tex(fd.texture || all, where + ' 第 ' + (i + 1) + ' 个元件的 ' + f + ' 面'),
              cull: fd.cullface || null,
              tint: -1,
              rot: fd.rotation || 0
            };
            if (!faces[fn].uv) {
              // (vanilla's default uv: the element's own bounds on that face)
              const [x0, y0, z0] = e.from,
                [x1, y1, z1] = e.to;
              faces[fn].uv = fn === 'up' || fn === 'down' ? [x0, z0, x1, z1] : fn === 'north' || fn === 'south' ? [x0, 16 - y1, x1, 16 - y0] : [z0, 16 - y1, z1, 16 - y0];
            }
          }
          const r = e.rotation ? {
            origin: e.rotation.origin || [8, 8, 8],
            axis: e.rotation.axis || 'y',
            angle: e.rotation.angle || 0,
            rescale: !!e.rescale || !!e.rotation.rescale
          } : undefined;
          return Object.assign({
            from: e.from,
            to: e.to,
            shade: e.shade !== false,
            faces
          }, r ? {
            rot: r
          } : {});
        });
        d.kind = 'model';
        d.states = [{}];
        d.particle = all || elements[0].faces[Object.keys(elements[0].faces)[0]].tex;
        if (b.solid === false) d.nonsolid = true;
        if (b.transparent === true) d.translucent = true;
        const mi = addModel({
          name: id + ':block/' + k,
          ao: b.ambientOcclusion !== false,
          gen: false,
          light: 'side',
          display: BLOCK_DISPLAY,
          elements
        });
        models.blocks[k] = variant(mi);
        models.items[k] = {
          m: mi
        };
      } else throw new Error(where + '：shape 只能是 cube / cross / model');
      if (S.BLOCK_DATA) S.BLOCK_DATA.push(d);
      m.blocks.push(k);
      // its item (a block always has one, unless noItem)
      if (!b.noItem && S.ITEM_DATA) S.ITEM_DATA.push({
        key: k,
        stack: b.stack || 64,
        tab: id
      });
      m.blockOpts = m.blockOpts || {};
      m.blockOpts[k] = b;
    }

    // ---- items ----
    const items = def.items || {};
    for (const k in items) {
      const it = items[k],
        where = '物品 ' + k;
      chk(k, '物品');
      if (blocks[k]) throw new Error(where + '：和方块同名（方块已经自带物品）');
      const iid = m.ids.items[k];
      if (iid === undefined) throw new Error(where + ' 没有编号：改了物品以后要重新运行安装（node tools/install_mod.js）');
      const t = tex(it.texture, where);
      if (!t) throw new Error(where + '：要有 texture');
      const d = {
        key: k,
        id: iid,
        cn: String(it.name || k),
        stack: it.durability || it.tool || it.armor ? 1 : Math.max(1, Math.min(64, it.stack || 64)),
        tab: id,
        tex: t
      };
      if (it.durability) d.dur = it.durability | 0;
      if (it.places) d.places = it.places;
      if (it.glint) d.glint = true;
      if (it.rarity) d.rar = it.rarity;
      if (it.food) d.food = Array.isArray(it.food) ? it.food : [it.food.hunger || 1, it.food.saturation || 0];
      if (it.attack) {
        d.atk = +it.attack;
        d.aspd = +(it.attackSpeed || 1.6);
      }
      if (S.ITEM_DATA) S.ITEM_DATA.push(d);
      m.items.push(k);
      models.items[k] = {
        m: addModel({
          name: id + ':item/' + k,
          ao: true,
          gen: true,
          light: 'front',
          display: it.tool ? HANDHELD_DISPLAY : ITEM_DISPLAY,
          layers: [t]
        })
      };
      m.itemOpts = m.itemOpts || {};
      m.itemOpts[k] = it;
    }
    (S.MOD_VMODELS || (S.MOD_VMODELS = [])).push(models);
    if (S.Mods && S.Mods.register) S.Mods.register(id, {
      name: m.name,
      blocks: m.blocks.length,
      items: m.items.length,
      tiles: m.textures.length
    });

    // ---- recipes ----
    if (S.RECIPE_DATA) {
      const R = S.RECIPE_DATA,
        ing = v => typeof v === 'string' ? v.replace(/^minecraft:/, '') : Array.isArray(v) ? v.map(ing) : v;
      for (const [i, r] of (def.recipes || []).entries()) {
        const where = '第 ' + (i + 1) + ' 个配方',
          res = r.result && String(r.result).replace(/^minecraft:/, '');
        if (!res) throw new Error(where + '：要有 result');
        switch (r.type) {
          case 'shaped':
            {
              if (!Array.isArray(r.pattern) || !r.pattern.length || r.pattern.length > 3 || r.pattern.some(row => typeof row !== 'string' || row.length > 3 || row.length !== r.pattern[0].length)) throw new Error(where + '：pattern 是 1-3 行、每行一样长（1-3 个字符）');
              const keys = {};
              for (const c in r.key || {}) keys[c] = ing(r.key[c]);
              R.crafting.push(['s', res, r.count || 1, r.pattern, keys]);
              break;
            }
          case 'shapeless':
            {
              const list = (r.ingredients || []).map(ing);
              if (!list.length || list.length > 9) throw new Error(where + '：ingredients 要有 1-9 个');
              R.crafting.push(['l', res, r.count || 1, list]);
              break;
            }
          case 'smelting':
          case 'blasting':
          case 'smoking':
          case 'campfire_cooking':
            R.cooking.push([r.type, ing(r.input), res, (_r$xp = r.xp) !== null && _r$xp !== void 0 ? _r$xp : 0.1, (_r$time = r.time) !== null && _r$time !== void 0 ? _r$time : r.type === 'smelting' ? 200 : r.type === 'campfire_cooking' ? 600 : 100]);
            break;
          case 'stonecutting':
            R.stonecutting.push([ing(r.input), res, r.count || 1]);
            break;
          default:
            throw new Error(where + '：type 只能是 shaped / shapeless / smelting / blasting / smoking / campfire_cooking / stonecutting');
        }
      }
      // tags: an item joins vanilla's tag of that name (planks, logs ...) - recipes taking '#tag' take it too
      for (const t in def.tags || {}) {
        const n = t.replace(/^minecraft:/, '');
        R.tags[n] = [...new Set([...(R.tags[n] || []), ...def.tags[t]])];
      }
    }

    // ---- ores (vanilla's ore feature; the worldgen worker and the page both run this) ----
    if (S.WG_DATA && def.ores && def.ores.length && !S.WG_DATA['mod:' + id]) {
      const W = S.WG_DATA;
      W['mod:' + id] = true;
      const NETHER = ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'],
        END = ['the_end', 'end_highlands', 'end_midlands', 'small_end_islands', 'end_barrens'];
      const ALL = Object.keys(W.biome);
      def.ores.forEach((o, i) => {
        var _o$airExposure, _o$minY, _o$maxY;
        const where = '第 ' + (i + 1) + ' 种矿',
          dim = o.dimension || 'overworld';
        if (!o.block || !blocks[o.block]) throw new Error(where + '：block 要是这个模组自己的方块');
        const targets = dim === 'nether' ? [{
          state: {
            Name: o.block
          },
          target: {
            predicate_type: 'minecraft:tag_match',
            tag: 'minecraft:base_stone_nether'
          }
        }] : dim === 'end' ? [{
          state: {
            Name: o.block
          },
          target: {
            predicate_type: 'minecraft:block_match',
            block: 'minecraft:end_stone'
          }
        }] : [{
          state: {
            Name: o.block
          },
          target: {
            predicate_type: 'minecraft:tag_match',
            tag: 'minecraft:stone_ore_replaceables'
          }
        }, ...(o.deepslateBlock ? [{
          state: {
            Name: o.deepslateBlock
          },
          target: {
            predicate_type: 'minecraft:tag_match',
            tag: 'minecraft:deepslate_ore_replaceables'
          }
        }] : [])];
        const name = id + ':ore_' + i;
        W.configured_feature[name] = {
          type: 'minecraft:ore',
          config: {
            discard_chance_on_air_exposure: (_o$airExposure = o.airExposure) !== null && _o$airExposure !== void 0 ? _o$airExposure : 0,
            size: Math.max(1, Math.min(64, o.size || 8)),
            targets
          }
        };
        W.placed_feature[name] = {
          feature: name,
          placement: [{
            type: 'minecraft:count',
            count: Math.max(1, Math.min(64, o.perChunk || 8))
          }, {
            type: 'minecraft:in_square'
          }, {
            type: 'minecraft:height_range',
            height: {
              type: o.distribution === 'triangle' ? 'minecraft:trapezoid' : 'minecraft:uniform',
              min_inclusive: {
                absolute: (_o$minY = o.minY) !== null && _o$minY !== void 0 ? _o$minY : -64
              },
              max_inclusive: {
                absolute: (_o$maxY = o.maxY) !== null && _o$maxY !== void 0 ? _o$maxY : 64
              }
            }
          }, {
            type: 'minecraft:biome'
          }]
        };
        const biomes = o.biomes ? o.biomes.map(b => b.replace(/^minecraft:/, '')) : dim === 'nether' ? NETHER : dim === 'end' ? END : ALL.filter(b => !NETHER.includes(b) && !END.includes(b) && b !== 'the_void');
        for (const b of biomes) {
          const bf = W.biome[b] && W.biome[b].features;
          if (!bf) continue;
          while (bf.length <= 6) bf.push([]); // (6: underground_ores)
          if (!bf[6].includes(name)) bf[6].push(name);
        }
      });
    }
  };
  // (an error in a mod's data is recorded, not thrown: thrown in a worker's importScripts it would stop the terrain)
  O.data = function (id, def) {
    try {
      dataImpl(id, def);
    } catch (e) {
      fail(id, '数据（data.js）', e);
    }
  };

  // ---- the page, once the vanilla blocks and items exist (mods_code.js calls it before the mods' code.js) ----
  O._finish = function () {
    if (O._finished) return;
    O._finished = true;
    for (const id in O.mods) {
      const m = O.mods[id];
      if (!m.def) continue;
      guard(id, '加载', () => {
        for (const k of m.blocks) {
          const b = m.blockOpts[k],
            B = BLOCKS[BID[k]];
          if (!B) continue;
          if (b.gravity) B.gravity = true;
        }
        for (const k of m.items) {
          const it = m.itemOpts[k],
            I = ITEMS[ITEM_KEY[k]];
          if (!I) continue;
          if (it.tool) {
            var _it$tool$level, _it$tool$speed;
            const ty = it.tool.type || it.tool;
            if (!TOOL_TYPES.includes(ty)) throw new Error('物品 ' + k + '：tool.type 只能是 ' + TOOL_TYPES.join(' / '));
            I.tool = {
              type: ty,
              level: (_it$tool$level = it.tool.level) !== null && _it$tool$level !== void 0 ? _it$tool$level : 2,
              speed: (_it$tool$speed = it.tool.speed) !== null && _it$tool$speed !== void 0 ? _it$tool$speed : 6
            };
            if (ty === 'sword') I.tool.speed = 1.5;
          }
          if (it.attack) {
            I.attack = +it.attack;
            I.attackSpeed = +(it.attackSpeed || 1.6);
          }
          if (it.durability) I.durability = it.durability | 0;
          if (it.food) I.food = Array.isArray(it.food) ? it.food : [it.food.hunger || 1, it.food.saturation || 0];
          if (it.alwaysEdible && typeof ALWAYS_EDIBLE !== 'undefined') ALWAYS_EDIBLE.add(k);
          if (it.fuel) I.fuel = it.fuel | 0;
          if (it.armor) {
            const slot = ARMOR_SLOTS[it.armor.slot];
            if (slot === undefined) throw new Error('物品 ' + k + '：armor.slot 只能是 head / chest / legs / feet');
            I.armor = {
              slot,
              points: it.armor.points || 0,
              tough: it.armor.toughness || 0,
              mat: it.armor.mat || 'iron'
            };
          }
          if (it.enchantability) I.enchantability = it.enchantability;
          if (it.repairWith) I.repair = it.repairWith;
        }
        // its creative tab (after vanilla's and the other mods')
        const tabDef = m.def.tab || {},
          all = [...m.blocks, ...m.items];
        if (all.length && typeof CREATIVE_TABS !== 'undefined' && !CREATIVE_TABS.some(t => t.id === id)) CREATIVE_TABS.push({
          id,
          name: tabDef.name || m.name || id,
          icon: tabDef.icon && ITEM_KEY[tabDef.icon] !== undefined ? tabDef.icon : all[0],
          get items() {
            return creativeTabItems(id);
          }
        });
      });
    }
    O._hook();
  };

  // ---- code side ---------------------------------------------------------------------------------------------
  // (y in the api is vanilla's - what F3 and commands show; inside, the world's y starts at 0: world.minY apart)
  const oy = g => g && g.world && g.world.minY || 0;
  const live = () => {
    const g = S.game;
    return g && g.world && g.state === 'play' && !g.net && !g.p2pGuest ? g : null;
  };
  const keyAt = (g, x, y, z) => {
    const id = g.world.getBlock(x, y, z);
    return id ? BLOCKS[id] ? BLOCKS[id].key : 'unknown' : 'air';
  };
  const stackInfo = st => st && ITEMS[st.id] ? {
    item: ITEMS[st.id].key,
    count: st.count,
    damage: st.dmg || 0
  } : null;
  const blockId = k => {
    const id = BID[String(k).replace(/^minecraft:/, '')];
    if (id === undefined) throw new Error('没有这个方块：' + k);
    return id;
  };
  const itemId = k => {
    const id = ITEM_KEY[String(k).replace(/^minecraft:/, '')];
    if (id === undefined) throw new Error('没有这个物品：' + k);
    return id;
  };
  // the events every mod can listen to: { name: [ [mod id, fn], ... ] }
  const H = {};
  const emit = (name, ev) => {
    const list = H[name];
    if (!list) return ev;
    for (const [id, fn] of list) {
      guard(id, name + ' 事件', fn, ev);
      if (ev.cancelled) break;
    }
    return ev;
  };
  const make = o => {
    o.cancelled = false;
    o.cancel = () => {
      o.cancelled = true;
    };
    return o;
  };
  O._hook = function () {
    if (!inPage || O._hooked) return;
    O._hooked = true;
    const G = Game.prototype;
    // tick (20 a second, playing a single-player world, not paused)
    const tk = G.tick;
    G.tick = function () {
      const r = tk.apply(this, arguments);
      if (live() === this && !(this.ui.screen && this.ui.screen.pauses)) {
        emit('tick', {
          tick: this.tickCount
        });
        for (const t of O._timers) if (this.tickCount % t.every === 0) guard(t.mod, '定时器', t.fn);
        for (const k of O._keys) {
          const d = typeof bindDown === 'function' && !this.ui.screen && bindDown(this, k.bind);
          if (d && !k.was) guard(k.mod, '按键 ' + k.name, k.down);
          if (!d && k.was && k.up) guard(k.mod, '按键 ' + k.name, k.up);
          k.was = d;
        }
      }
      return r;
    };
    // breaking a block by the player (before: cancel keeps it; after: blockBroken)
    const bb = G.breakBlock;
    G.breakBlock = function (x, y, z, natural, silent) {
      if (natural || live() !== this || !(H.blockBreak || H.blockBroken)) return bb.apply(this, arguments);
      const id = this.world.getBlock(x, y, z);
      if (!id) return bb.apply(this, arguments);
      const ev = emit('blockBreak', make({
        x,
        y: y + oy(this),
        z,
        block: keyAt(this, x, y, z),
        held: stackInfo(this.player.inv.held)
      }));
      if (ev.cancelled) return;
      const r = bb.apply(this, arguments);
      if (!this.world.getBlock(x, y, z)) emit('blockBroken', {
        x,
        y: y + oy(this),
        z,
        block: ev.block
      });
      return r;
    };
    // a block placed by the player
    const pa = G.placeAt;
    G.placeAt = function (x, y, z, id) {
      const r = pa.apply(this, arguments);
      if (live() === this && H.blockPlace) emit('blockPlace', {
        x,
        y: y + oy(this),
        z,
        block: BLOCKS[id] ? BLOCKS[id].key : 'unknown'
      });
      return r;
    };
    // right click: a mod's block (useBlock), a mod's item (useItem), then the generic 'use' event, then vanilla
    const us = G.use;
    G.use = function () {
      if (live() !== this) return us.apply(this, arguments);
      const p = this.player,
        t = this.target,
        held = p.inv.held,
        hk = held && ITEMS[held.id] ? ITEMS[held.id].key : null;
      const swing = () => {
        p.swing();
        this.useCd = 4;
      };
      if (t && !p.sneaking && !this.targetEntity) {
        const k = BLOCKS[t.id] && BLOCKS[t.id].key,
          f = O._useBlock[k];
        if (f) {
          const ev = make({
            x: t.pos[0],
            y: t.pos[1] + oy(this),
            z: t.pos[2],
            face: FACE_NAMES[t.face],
            block: k,
            held: stackInfo(held)
          });
          guard(f.mod, '使用方块 ' + k, f.fn, ev);
          if (!ev.cancelled) {
            swing();
            return;
          }
        }
      }
      if (hk && O._useItem[hk]) {
        const f = O._useItem[hk],
          ev = make({
            item: hk,
            held: stackInfo(held),
            target: t && !this.targetEntity ? {
              x: t.pos[0],
              y: t.pos[1] + oy(this),
              z: t.pos[2],
              face: FACE_NAMES[t.face],
              block: BLOCKS[t.id] && BLOCKS[t.id].key
            } : null,
            entity: this.targetEntity ? entInfo(this.targetEntity) : null
          });
        guard(f.mod, '使用物品 ' + hk, f.fn, ev);
        if (!ev.cancelled) {
          swing();
          return;
        }
      }
      if (H.use) {
        const ev = emit('use', make({
          held: stackInfo(held),
          target: t && !this.targetEntity ? {
            x: t.pos[0],
            y: t.pos[1] + oy(this),
            z: t.pos[2],
            face: FACE_NAMES[t.face],
            block: BLOCKS[t.id] && BLOCKS[t.id].key
          } : null,
          entity: this.targetEntity ? entInfo(this.targetEntity) : null
        }));
        if (ev.handled || ev.cancelled) {
          swing();
          return;
        }
      }
      return us.apply(this, arguments);
    };
    // the player hitting an entity (cancel: no hit)
    const at = G.attack;
    G.attack = function (e) {
      if (live() !== this || !H.attack) return at.apply(this, arguments);
      const ev = emit('attack', make({
        entity: entInfo(e),
        held: stackInfo(this.player.inv.held)
      }));
      if (ev.cancelled) return;
      return at.apply(this, arguments);
    };
    // a mob's death (any cause; byPlayer: killed by the player)
    if (typeof Mob !== 'undefined') {
      const md = Mob.prototype.die;
      // (also called by deaths that skip Mob.die, like a villager a zombie turns)
      const dv = Mob.modDeath = function (m, src) {
        const g = m.game;
        if (H.entityDeath && live() === g && !m._modDead) {
          m._modDead = true;
          emit('entityDeath', {
            entity: entInfo(m),
            byPlayer: !!(src && (src.attacker === g.player || src.player))
          });
        }
      };
      Mob.prototype.die = function (src) {
        const r = md.apply(this, arguments);
        dv(this, src);
        return r;
      };
    }
    // the player's death
    const pd = G.onPlayerDeath;
    if (pd) G.onPlayerDeath = function () {
      if (live() === this) emit('playerDeath', {});
      return pd.apply(this, arguments);
    };
    // a world opened (single player): worldLoad
    const lw = G.loadWorld;
    G.loadWorld = async function () {
      const r = await lw.apply(this, arguments);
      const g = this,
        wait = () => {
          if (live() === g) {
            for (const w of fail.waiting.splice(0)) fail.tell(...w);
            emit('worldLoad', {
              name: g.worldMeta && g.worldMeta.name,
              seed: g.worldMeta && g.worldMeta.seed
            });
          } else if (g.state !== 'title') setTimeout(wait, 200);
        };
      setTimeout(wait, 0);
      return r;
    };
    // the HUD: draw(ctx, width, height) after the game's own (ctx: a 2D canvas, the GUI's scaled pixels)
    if (typeof UI !== 'undefined' && UI.prototype.drawHUD) {
      const dh = UI.prototype.drawHUD;
      UI.prototype.drawHUD = function () {
        const r = dh.apply(this, arguments),
          g = this.game;
        if (H.hud && live() === g && !this.hideHud) for (const [id, fn] of H.hud) {
          this.ctx.save();
          guard(id, 'hud 绘制', fn, {
            ctx: this.ctx,
            width: this.w,
            height: this.h,
            text: (s, x, y, col) => Font.draw(this.ctx, String(s), x, y, col || '#FFFFFF'),
            textWidth: s => Font.width(String(s)),
            centerText: (s, x, y, col) => Font.center(this.ctx, String(s), x, y, col || '#FFFFFF')
          });
          this.ctx.restore();
        }
        return r;
      };
    }
  };
  O._timers = [];
  O._keys = [];
  O._useBlock = {};
  O._useItem = {};
  const entInfo = e => e ? {
    type: e.type || (e === (S.game && S.game.player) ? 'player' : e.constructor && e.constructor.name),
    x: e.pos[0],
    y: e.pos[1] + oy(S.game),
    z: e.pos[2],
    health: e.health,
    _e: e
  } : null;

  // the api a mod's code gets (OpusMC.code(id, (api) => { ... }))
  function makeApi(id) {
    const m = mod(id);
    const g = () => S.game;
    const need = () => {
      const x = live();
      if (!x) throw new Error('现在不在单人世界里');
      return x;
    };
    const api = {
      id,
      // ---- events ----
      on(name, fn) {
        const ok = ['tick', 'blockBreak', 'blockBroken', 'blockPlace', 'use', 'attack', 'entityDeath', 'playerDeath', 'worldLoad', 'hud'];
        if (!ok.includes(name)) throw new Error('没有这个事件：' + name + '（可以用：' + ok.join(', ') + '）');
        (H[name] || (H[name] = [])).push([id, fn]);
        return api;
      },
      every(ticks, fn) {
        O._timers.push({
          mod: id,
          every: Math.max(1, ticks | 0),
          fn
        });
        return api;
      },
      onUseBlock(key, fn) {
        if (BID[key] === undefined) throw new Error('没有这个方块：' + key);
        O._useBlock[key] = {
          mod: id,
          fn
        };
        return api;
      },
      onUseItem(key, fn) {
        if (ITEM_KEY[key] === undefined) throw new Error('没有这个物品：' + key);
        O._useItem[key] = {
          mod: id,
          fn
        };
        return api;
      },
      // ---- commands and keys ----
      command(name, opts, fn) {
        if (typeof opts === 'function') {
          fn = opts;
          opts = {};
        }
        if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('命令名只用小写字母、数字、下划线：' + name);
        if (typeof CMD_RUN === 'undefined') return api;
        if (CMD_RUN[name]) throw new Error('命令 /' + name + ' 已经有了');
        CMD_RUN[name] = function (ctx, args) {
          const r = guard(id, '命令 /' + name, fn, args, {
            say: (t, col) => this.ui.message(String(t), col || '#FFFFFF'),
            x: ctx.pos[0],
            y: ctx.pos[1] + oy(this),
            z: ctx.pos[2]
          });
          if (typeof r === 'string') this.ui.message(r, '#FFFFFF');
        };
        if (typeof CMDS_LOCAL !== 'undefined') CMDS_LOCAL.push([name, opts.usage || '/' + name, opts.description || '[' + (m.name || id) + ']', opts.suggest || []]);
        if (!opts.cheats) (S.CMD_FREE || (S.CMD_FREE = new Set())).add(name);
        return api;
      },
      key(name, label, defaultKey, down, up) {
        if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('按键名只用小写字母、数字、下划线：' + name);
        const bind = id + '.' + name;
        if (typeof KEYBIND_CATS !== 'undefined' && !KEY_DEFAULT[bind]) {
          let cat = KEYBIND_CATS.find(c => c[0] === (m.name || id));
          if (!cat) KEYBIND_CATS.push(cat = [m.name || id, []]);
          cat[1].push([bind, label, defaultKey || '']);
          KEY_DEFAULT[bind] = defaultKey || '';
          KEY_CN[bind] = label;
        }
        O._keys.push({
          mod: id,
          name,
          bind,
          down: down || (() => {}),
          up,
          was: false
        });
        return api;
      },
      // ---- talking to the player ----
      message(text, color) {
        const x = g();
        if (x && x.ui) x.ui.message(String(text), color || '#FFFFFF');
      },
      toast(title, sub, iconItem) {
        const x = g();
        if (x && x.ui) x.ui.toast(String(title), String(sub || ''), iconItem && ITEM_KEY[iconItem] !== undefined ? ITEM_KEY[iconItem] : undefined);
      },
      // a simple menu: { title, lines: [text ...], buttons: [{ label, onClick }] } (Esc closes it); returns close()
      menu(o) {
        const x = need();
        class ModMenu extends MenuScreen {
          constructor() {
            super(x, String(o.title || ''));
            this.titleY = 30;
          }
          layout() {
            const u = x.ui,
              cx = u.w / 2,
              bs = o.buttons || [],
              top = Math.max(60, Math.floor(u.h / 2 - 10));
            this.widgets = bs.map((b, i) => ({
              x: cx - 100,
              y: top + 24 * i + (o.lines || []).length * 0,
              w: 200,
              h: 20,
              label: String(b.label),
              onClick: () => guard(id, '菜单按钮', b.onClick || (() => api.closeMenu()))
            }));
            this.top = top;
          }
          drawExtra(ui) {
            (o.lines || []).forEach((t, i) => Font.center(ui.ctx, String(t), ui.w / 2, 50 + i * 11, '#FFFFFF'));
          }
          onEsc() {
            x.ui.close();
          }
        }
        x.ui.open(new ModMenu());
        return () => api.closeMenu();
      },
      closeMenu() {
        const x = g();
        if (x && x.ui.screen) x.ui.close();
      },
      // any command, as a command block would run it: '/summon zombie ~ ~ ~', 'effect give @s speed 10 1' ...
      run(cmd) {
        const x = need();
        let ok = true,
          out = [];
        const src = {
          pos: [...x.player.pos],
          rot: [x.player.yaw, x.player.pitch],
          entity: x.player,
          name: m.name || id,
          say: t => out.push(String(t)),
          fail: t => {
            ok = false;
            out.push(String(t));
          }
        };
        ok = cmdExec(x, String(cmd), src) !== false && ok;
        return {
          ok,
          output: out
        };
      },
      // ---- the mod's own files (its assets/ folder) ----
      assetUrl(file) { const k = 'mods/' + id + '/assets/' + String(file).replace(/^\/+/, ''); return (window.__MODFILES && window.__MODFILES[k]) || k; },
      // a sound file of its own (assets/xxx.ogg / .mp3 / .m4a - Safari plays no ogg), at the game's sound volume
      playSound(file, volume, pitch) {
        try {
          const a = new Audio(api.assetUrl(file));
          a.volume = Math.max(0, Math.min(1, (volume !== null && volume !== void 0 ? volume : 1) * (typeof Sound !== 'undefined' && Sound.volume != null ? Sound.volume : 1)));
          if (pitch) {
            a.preservesPitch = false;
            a.playbackRate = Math.max(0.5, Math.min(2, pitch));
          }
          a.play().catch(() => {});
        } catch (e) {}
      },
      // an image of its own (assets/xxx.png), for the HUD: null until it has loaded
      image(file) {
        const c = m.images || (m.images = {});
        if (!c[file]) {
          const im = new Image();
          im.src = api.assetUrl(file);
          c[file] = im;
        }
        return c[file].complete && c[file].naturalWidth ? c[file] : null;
      },
      // ---- the world ----
      world: {
        getBlock(x, y, z) {
          const G = need();
          return keyAt(G, Math.floor(x), Math.floor(y) - oy(G), Math.floor(z));
        },
        getState(x, y, z) {
          const G = need();
          return G.world.getMeta(Math.floor(x), Math.floor(y) - oy(G), Math.floor(z));
        },
        setBlock(x, y, z, key, state) {
          const G = need();
          x = Math.floor(x);
          y = Math.floor(y) - oy(G);
          z = Math.floor(z);
          G.world.setBlock(x, y, z, key === 'air' ? 0 : blockId(key), state | 0);
          G.flushMesh && G.flushMesh();
        },
        isLoaded(x, z) {
          const G = need();
          return G.world.isLoaded(Math.floor(x), Math.floor(z));
        },
        surfaceY(x, z) {
          const G = need();
          return G.world.surfaceY(Math.floor(x), Math.floor(z)) + oy(G);
        },
        get time() {
          const G = need();
          return G.worldTime;
        },
        set time(v) {
          const G = need();
          G.worldTime = +v;
        },
        get dimension() {
          const G = need();
          return G.dim;
        },
        dropItem(x, y, z, key, count) {
          const G = need();
          G.dropItem(x, y - oy(G), z, makeStack(itemId(key), count || 1));
        },
        explode(x, y, z, power) {
          const G = need();
          G.explode(x, y - oy(G), z, Math.max(0.5, Math.min(10, +power || 3)));
        },
        lightning(x, y, z) {
          const G = need();
          G.strikeLightning(x, y - oy(G), z);
        },
        // entities near a point: [{ type, x, y, z, health }]
        entities(x, y, z, r) {
          const G = need(),
            r2 = (r || 16) ** 2;
          y -= oy(G);
          return G.entities.filter(e => e && e.pos && (e.pos[0] - x) ** 2 + (e.pos[1] - y) ** 2 + (e.pos[2] - z) ** 2 <= r2).map(entInfo);
        },
        damage(entity, amount) {
          const G = need();
          const e = entity && entity._e;
          if (e && e.hurt) e.hurt(+amount || 1, {
            type: 'mod',
            attacker: G.player
          });
        },
        particle(type, x, y, z, count) {
          return api.run(`particle ${type} ${x} ${y} ${z} 0.3 0.3 0.3 0.05 ${count || 8}`);
        },
        sound(event, x, y, z, volume, pitch) {
          if (typeof Sound !== 'undefined') Sound.ev(String(event), [x, y - oy(S.game), z], volume !== null && volume !== void 0 ? volume : 1, pitch !== null && pitch !== void 0 ? pitch : 1);
        }
      },
      // ---- the player ----
      player: {
        get x() {
          return need().player.pos[0];
        },
        get y() {
          const G = need();
          return G.player.pos[1] + oy(G);
        },
        get z() {
          return need().player.pos[2];
        },
        get yaw() {
          return need().player.yaw;
        },
        get pitch() {
          return need().player.pitch;
        },
        get health() {
          return need().player.health;
        },
        set health(v) {
          const p = need().player;
          p.health = Math.max(0, Math.min(p.maxHealth, +v));
        },
        get maxHealth() {
          return need().player.maxHealth;
        },
        get food() {
          return need().player.food;
        },
        set food(v) {
          need().player.food = Math.max(0, Math.min(20, v | 0));
        },
        get mode() {
          return need().mode;
        },
        get sneaking() {
          return !!need().player.sneaking;
        },
        get onGround() {
          return !!need().player.onGround;
        },
        get held() {
          return stackInfo(need().player.inv.held);
        },
        // what the crosshair is on: { x, y, z, face, block } or null
        get target() {
          const G = need(),
            t = G.target;
          return t && !G.targetEntity ? {
            x: t.pos[0],
            y: t.pos[1] + oy(G),
            z: t.pos[2],
            face: FACE_NAMES[t.face],
            block: BLOCKS[t.id] && BLOCKS[t.id].key
          } : null;
        },
        teleport(x, y, z) {
          const G = need(),
            p = G.player;
          p.pos[0] = x;
          p.pos[1] = y - oy(G);
          p.pos[2] = z;
          p.vel[0] = p.vel[1] = p.vel[2] = 0;
          if (p.savePrev) p.savePrev();
        },
        setVelocity(vx, vy, vz) {
          const p = need().player;
          p.vel[0] = vx;
          p.vel[1] = vy;
          p.vel[2] = vz;
        },
        give(key, count) {
          const G = need(),
            st = makeStack(itemId(key), count || 1);
          const left = G.player.inv.add(st);
          if (left) G.dropFromPlayer ? G.dropFromPlayer({
            ...st,
            count: left
          }) : null;
        },
        // take n of an item from the inventory; false if there aren't that many (nothing taken then)
        take(key, count) {
          const p = need().player,
            id = itemId(key);
          let n = count || 1;
          if (p.inv.slots.reduce((s, x) => s + (x && x.id === id ? x.count : 0), 0) < n) return false;
          for (let i = 0; i < p.inv.slots.length && n > 0; i++) {
            const s = p.inv.slots[i];
            if (s && s.id === id) {
              const k = Math.min(n, s.count);
              s.count -= k;
              n -= k;
              if (!s.count) p.inv.slots[i] = null;
            }
          }
          return true;
        },
        count(key) {
          const p = need().player,
            id = itemId(key);
          return p.inv.slots.reduce((s, x) => s + (x && x.id === id ? x.count : 0), 0);
        },
        // damage the held item (tools); it breaks at its durability
        damageHeld(n) {
          const G = need();
          if (G.damageHeld) G.damageHeld(n || 1);
        },
        consumeHeld(n) {
          const G = need(),
            p = G.player,
            h = p.inv.held;
          if (!h || G.mode === 'creative') return;
          h.count -= n || 1;
          if (h.count <= 0) p.inv.slots[p.inv.sel] = null;
        },
        addEffect(effect, seconds, level) {
          const p = need().player;
          p.addEffect(String(effect), Math.max(0, (level || 1) - 1), Math.round((seconds || 10) * 20));
        },
        addXp(n) {
          need().addXp(n | 0);
        }
      },
      // ---- a store of its own, kept with the world (JSON values only) ----
      get store() {
        const G = need(),
          M = G.worldMeta,
          all = M.modData || (M.modData = {});
        return all[id] || (all[id] = {});
      },
      // the game itself, for what this api doesn't cover (unstable: it may change with any update)
      get raw() {
        return {
          game: g(),
          BLOCKS,
          ITEMS,
          BID,
          ITEM_KEY
        };
      }
    };
    return api;
  }

  // a mod's code: OpusMC.code('rubymod', (api) => { ... }) - run once, in the page, after every mod's data
  O.code = function (id, fn) {
    if (!inPage) return;
    const m = mod(id);
    if (m.code) return;
    m.code = true;
    if (!O._finished) O._finish();
    guard(id, '启动', fn, makeApi(id));
  };
})();
;try{window.__SRCS=window.__SRCS||{};window.__SRCS["js/modapi.js"]=document.currentScript.textContent;}catch(e){}
