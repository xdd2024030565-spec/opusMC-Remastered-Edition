'use strict';

// 匠魂教程地图 (tutorial map: the 模组 screen's 教程地图 on 匠魂's card; first made for the recording build #V1): a superflat world with 匠魂's play laid out along a route, ① to ⑧ - the
// first tools (part builder, tinker station), the melter, the smeltery (melting, alloys, casting), modifiers, a test
// ground for the big tools, a slime island, finished tools and armour on show - each with its signs and its chests full.
// Built each time the world is entered (the user 11-13: a fresh map every time, whatever was done to it before); /demo reset builds it all again (every block, chest, sign, frame, stand,
// the dropped items and the player's inventory), /demo tp goes back to the start.
// Our own code; the map is laid out by hand here (no one else's map).
(function () {
  if (window.__OFFLINE_MODS) return; // 离线包：停用匠魂教程地图（不再自动建图/传送）
  if (typeof Game !== 'function' || !self.TCON) return;
  const TC = self.TCON,
    M = TC.materials,
    P = TC.parts,
    T = TC.tools;
  const HF = self.tcHandlers;
  // the area (x, z from -R to R), the ground (grass at y 60 in a superflat world), what is built goes from y 61
  const R = 27,
    G = 60,
    TOP = 82,
    BOTTOM = 48;
  const START = [0.5, 61, 23.5];

  // ---- blocks ----
  const idOf = k => BID[k] !== undefined ? BID[k] : -1;
  function metaOf(id, props) {
    const st = BLOCKS[id] && BLOCKS[id].states;
    if (!st || !props) return 0;
    const i = st.findIndex(s => Object.keys(props).every(k => String(s[k]) === String(props[k])));
    return i < 0 ? 0 : i;
  }
  let W = null,
    g0 = null;
  const missing = new Set();
  function set(x, y, z, key, props) {
    const id = key === 'air' ? 0 : idOf(key);
    if (id < 0) {
      missing.add(key);
      return;
    }
    const m = id ? metaOf(id, props) : 0;
    if (W.getBlock(x, y, z) === id && W.getMeta(x, y, z) === m) return;
    W.setBlock(x, y, z, id, m);
  }
  function fill(x0, y0, z0, x1, y1, z1, key, props) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) set(x, y, z, key, props);
  }
  // ---- stacks ----
  const item = (k, n = 1) => ITEM_KEY[k] !== undefined ? {
    id: ITEM_KEY[k],
    count: n,
    dmg: 0
  } : (missing.add(k), null);
  const firstWith = stat => Object.keys(M).find(m => !M[m].hidden && !M[m].compat && M[m].stats[stat]);
  const toolId = k => ITEM_KEY[k] !== undefined && ITEMS[ITEM_KEY[k]].tcTool === k ? ITEM_KEY[k] : ITEM_KEY['tc_' + k];
  // a tool in these materials (one a part, the last for the rest; a part that can't take it: the first that can)
  function tool(k, mats) {
    const t = T[k],
      id = toolId(k);
    if (!t || id === undefined) {
      missing.add(k);
      return null;
    }
    const stats = t.parts.length ? t.parts.map(p => P[p] && P[p].stat) : (t.matStats || []).map(x => x[0]);
    const want = [].concat(mats || []);
    const m = stats.map((s, i) => {
      const w = want[Math.min(i, want.length - 1)];
      return w && M[w] && M[w].stats[s] ? w : firstWith(s);
    });
    return {
      id,
      count: 1,
      dmg: 0,
      tc: {
        m
      }
    };
  }
  const part = (k, mat, n = 1) => ITEM_KEY[k] !== undefined && M[mat] ? {
    id: ITEM_KEY[k],
    count: n,
    dmg: 0,
    tc: {
      m: mat
    }
  } : (missing.add(k + ':' + mat), null);
  function chest(x, y, z, stacks) {
    set(x, y, z, 'chest');
    const be = g0.getBlockEntity(x, y, z, 'chest');
    be.slots = new Array(27).fill(null);
    delete be.loot;
    stacks.filter(Boolean).slice(0, 27).forEach((s, i) => {
      be.slots[i] = s;
    });
    g0.markBlockEntity && g0.markBlockEntity(be);
  }
  // a standing sign turned to face the start (south), or a wall sign; up to 4 lines a side, the back the same
  function sign(x, y, z, lines, wall, color) {
    if (wall) set(x, y, z, 'oak_wall_sign', {
      facing: wall
    });else set(x, y, z, 'oak_sign', {
      rotation: '0'
    });
    const t = g0.signAt(x, y, z),
      L = [0, 1, 2, 3].map(i => lines[i] || '');
    t.f.l = L.slice();
    t.f.c = color || 'black';
    t.f.g = false;
    t.b.l = L.slice();
    t.b.c = color || 'black';
    t.b.g = false;
  }
  const tcBE = (x, y, z, kind) => HF.beAt(g0, x, y, z, kind);

  // ---- clearing the area: the ground back to grass over dirt over stone, air above, nothing left on it ----
  const inArea = (x, y, z) => x >= -R && x <= R && z >= -R && z <= R && y >= BOTTOM && y <= TOP;
  function clear(g) {
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      for (let y = BOTTOM; y <= TOP; y++) set(x, y, z, y > G ? 'air' : y === G ? 'grass_block' : y >= G - 3 ? 'dirt' : 'stone');
    }
    for (const [k, be] of [...g.blockEntities]) if (be.pos && inArea(be.pos[0], be.pos[1], be.pos[2])) g.blockEntities.delete(k);
    if (g.signs) for (const k of [...g.signs.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      if (inArea(x, y, z)) g.signs.delete(k);
    }
    const p = g.player;
    g.entities = g.entities.filter(e => e === p || !inArea(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2])));
  }

  // ---- the map ----
  function build(g) {
    g0 = g;
    W = g.world;
    missing.clear();
    clear(g);
    const Y = G + 1;
    // paths: smooth stone from the start north, and across
    fill(-1, G, -12, 1, G, 25, 'smooth_stone');
    fill(-24, G, 6, 24, G, 7, 'smooth_stone');
    fill(-24, G, -10, 24, G, -9, 'smooth_stone');

    // ---- the start ----
    fill(-5, G, 19, 5, G, 26, 'polished_andesite');
    sign(-2, Y, 21, ['匠魂', '教程地图', '沿路线体验', '①→⑦'], null, 'blue');
    sign(2, Y, 21, ['/demo reset', '整张地图重置', '/demo tp', '回到起点'], null, 'red');
    chest(0, Y, 20, [item('materials_and_you'), item('puny_smelting'), item('mighty_smelting'), item('tinkers_gadgetry'), item('fantastic_foundry'), item('encyclopedia'), item('bread', 32), item('cooked_beef', 16), item('torch', 32)]);
    sign(1, Y, 20, ['匠魂的书', '（教程）', '和食物'], null);

    // ---- ① the first tool: the part builder, the tinker station ----
    fill(-23, G, 9, -11, G, 18, 'stone_bricks');
    set(-20, Y, 12, 'part_builder__oak_planks', {
      facing: 'south'
    });
    set(-18, Y, 12, 'tinker_station__oak_planks', {
      facing: 'south'
    });
    set(-16, Y, 12, 'crafting_station__oak_log', {
      facing: 'south'
    });
    chest(-14, Y, 12, [item('pattern', 64), item('pattern', 64), item('oak_planks', 64), item('oak_log', 32), item('cobblestone', 64), item('flint', 32), item('bone', 32), item('stick', 32), item('string', 32), item('feather', 32), item('leather', 16), item('cactus', 16), item('copper_ingot', 32), item('iron_ingot', 32)]);
    sign(-20, Y, 14, ['部件加工台', '图样 + 材料', '→ 工具部件'], null);
    sign(-18, Y, 14, ['工匠站', '部件放进去', '→ 组装工具'], null);
    sign(-16, Y, 14, ['工作站', '带物品栏的', '工作台'], null);
    sign(-14, Y, 14, ['材料箱', '图样 木头 石头', '燧石 骨头'], null);
    sign(-17, Y, 17, ['① 第一把工具', '木头 / 石头 / 燧石', '做镐头 + 手柄', '+ 绑定结'], null, 'blue');

    // ---- ② the melter: a heater with coal under it, a faucet each side - a casting table, a basin ----
    fill(-23, G, -6, -11, G, 3, 'stone_bricks');
    set(-19, Y, -2, 'seared_heater', {
      facing: 'south',
      active: 'false'
    });
    set(-19, Y + 1, -2, 'seared_melter', {
      facing: 'south',
      active: 'false',
      in_structure: 'false'
    });
    set(-18, Y + 1, -2, 'seared_faucet', {
      facing: 'east'
    });
    set(-18, Y, -2, 'seared_table', {
      facing: 'south'
    });
    set(-20, Y + 1, -2, 'seared_faucet', {
      facing: 'west'
    });
    set(-20, Y, -2, 'seared_basin', {
      facing: 'south'
    });
    {
      const h = tcBE(-19, Y, -2, 'heater');
      h.slots = [item('coal', 64)];
    }
    chest(-15, Y, -2, [item('raw_iron', 32), item('raw_copper', 32), item('raw_gold', 32), item('iron_ore', 16), item('coal', 64), item('grout', 64), item('seared_brick', 64), item('gold_ingot', 32), item('sand', 32)]);
    chest(-13, Y, -2, [item('ingot_cast'), item('nugget_cast'), item('gem_cast'), item('pick_head_cast'), item('small_axe_head_cast'), item('small_blade_cast'), item('tool_binding_cast'), item('tool_handle_cast'), item('repair_kit_cast'), item('blank_sand_cast', 16)]);
    sign(-19, Y, 0, ['焦黑熔化炉', '矿石放进去熔化', '下面加热器烧煤'], null);
    sign(-17, Y, 0, ['浇注口', '右键开 / 关', '流进浇铸台'], null);
    sign(-15, Y, 0, ['矿石 煤', '砂浆（熔炉烧', '成焦黑砖）'], null);
    sign(-13, Y, 0, ['金铸模', '放浇铸台上', '倒熔融金属'], null);
    sign(-17, Y, 2, ['② 熔化与浇铸', '熔化矿石', '浇成锭和部件', '金浇在部件上→铸模'], null, 'blue');

    // ---- ③ the smeltery: 3 x 3 x 3 inside, glass in front, a drain each side with a faucet - table east, basin
    // west - and a tank of lava at the back ----
    const sx0 = -2,
      sx1 = 2,
      sz0 = -22,
      sz1 = -18;
    fill(sx0 - 1, G, sz0 - 1, sx1 + 4, G, sz1 + 5, 'polished_blackstone');
    fill(sx0, Y, sz0, sx1, Y, sz1, 'seared_bricks');
    for (let y = Y + 1; y <= Y + 3; y++) for (let x = sx0; x <= sx1; x++) for (let z = sz0; z <= sz1; z++) {
      const edge = x === sx0 || x === sx1 || z === sz0 || z === sz1;
      if (!edge) continue;
      set(x, y, z, z === sz1 && x > sx0 && x < sx1 ? 'seared_glass' : 'seared_bricks');
    }
    set(0, Y + 1, sz1, 'smeltery_controller', {
      facing: 'south',
      active: 'false',
      in_structure: 'false'
    });
    set(sx1, Y + 1, -20, 'seared_drain', {
      facing: 'east',
      in_structure: 'false'
    });
    set(sx1 + 1, Y + 1, -20, 'seared_faucet', {
      facing: 'east'
    });
    set(sx1 + 1, Y, -20, 'seared_table', {
      facing: 'east'
    });
    set(sx0, Y + 1, -20, 'seared_drain', {
      facing: 'west',
      in_structure: 'false'
    });
    set(sx0 - 1, Y + 1, -20, 'seared_faucet', {
      facing: 'west'
    });
    set(sx0 - 1, Y, -20, 'seared_basin', {
      facing: 'west'
    });
    set(0, Y + 1, sz0, 'seared_fuel_tank');
    {
      const t = tcBE(0, Y + 1, sz0, 'tank');
      t.tank = {
        f: 'lava',
        a: 4000
      };
    }
    set(0, Y + 2, sz0, 'seared_fuel_tank');
    {
      const t = tcBE(0, Y + 2, sz0, 'tank');
      t.tank = {
        f: 'lava',
        a: 4000
      };
    }
    chest(-4, Y, -15, [item('raw_iron', 64), item('raw_gold', 64), item('raw_copper', 64), item('raw_cobalt', 64), item('ancient_debris', 16), item('quartz', 64), item('amethyst_shard', 64), item('obsidian', 32), item('sky_slime_ball', 32), item('slime_ball', 32), item('seared_brick', 32), item('lava_bucket'), item('lava_bucket'), item('bucket', 4)]);
    chest(4, Y, -15, [item('ingot_cast'), item('nugget_cast'), item('gem_cast'), item('pick_head_cast'), item('small_axe_head_cast'), item('small_blade_cast'), item('tool_binding_cast'), item('tool_handle_cast'), item('hammer_head_cast'), item('broad_blade_cast'), item('broad_axe_head_cast'), item('large_plate_cast'), item('tough_handle_cast'), item('tough_binding_cast'), item('adze_head_cast'), item('bow_limb_cast'), item('bow_grip_cast'), item('repair_kit_cast'), item('helmet_plating_cast'), item('chestplate_plating_cast'), item('leggings_plating_cast'), item('boots_plating_cast'), item('maille_cast')]);
    sign(-2, Y, -16, ['冶炼炉控制器', '右键看炉内', '矿石放进炉里'], null);
    sign(2, Y, -16, ['两侧排液孔', '浇注口 → 东边', '浇铸台 西边浇铸盆'], null);
    sign(-4, Y, -13, ['矿石 / 合金料', '钴 远古残骸', '石英 紫水晶'], null);
    sign(4, Y, -13, ['全套金铸模', '工具部件', '和镶板'], null);
    sign(-1, Y, -12, ['③ 冶炼炉', '后面储罐是岩浆', '（燃料）', '炉里自动合金'], null, 'blue');
    sign(1, Y, -12, ['合金举例', '铜+金→玫瑰金', '钴+残骸→钴锰', '铜+紫水晶→紫铜'], null, 'green');

    // ---- ④ modifiers: the tinker's anvil, a tinker station, the modifier worktable; materials, metal parts, tools ----
    fill(11, G, -6, 23, G, 3, 'stone_bricks');
    set(14, Y, -2, 'tinkers_anvil__manyullyn_block', {
      facing: 'south'
    });
    set(16, Y, -2, 'tinker_station__spruce_planks', {
      facing: 'south'
    });
    set(18, Y, -2, 'modifier_worktable', {
      facing: 'south'
    });
    set(20, Y, -2, 'part_builder__spruce_planks', {
      facing: 'south'
    });
    chest(14, Y, -4, [item('redstone', 64), item('redstone_block', 16), item('lapis_lazuli', 64), item('lapis_block', 16), item('quartz', 64), item('quartz_block', 16), item('diamond', 16), item('emerald', 16), item('netherite_ingot', 4), item('gold_ingot', 32), item('glowstone_dust', 32), item('iron_reinforcement', 16), item('obsidian_reinforcement', 8), item('silky_cloth', 8), item('ender_pearl', 16), item('slime_ball', 32), item('sky_slime_ball', 32), item('earth_slime_crystal', 16), item('sky_slime_crystal', 16), item('blaze_powder', 16), item('obsidian', 16), item('feather', 16), item('rabbit_foot', 8), item('string', 32)]);
    chest(16, Y, -4, [part('pick_head', 'cobalt', 2), part('hammer_head', 'cobalt'), part('tool_binding', 'manyullyn', 2), part('tool_handle', 'hepatizon', 2), part('tough_handle', 'hepatizon', 2), part('tough_binding', 'manyullyn', 2), part('large_plate', 'cobalt', 2), part('broad_blade', 'manyullyn'), part('broad_axe_head', 'hepatizon'), part('small_blade', 'cobalt'), part('small_axe_head', 'rose_gold'), part('adze_head', 'slimesteel'), part('bow_limb', 'slimewood', 2), part('bow_grip', 'cobalt'), part('bowstring', 'string')]);
    chest(18, Y, -4, [tool('pickaxe', ['cobalt', 'hepatizon', 'manyullyn']), tool('sword', ['manyullyn', 'hepatizon', 'cobalt']), tool('hand_axe', ['hepatizon', 'cobalt', 'manyullyn']), tool('mattock', ['rose_gold', 'cobalt', 'slimesteel']), tool('dagger', ['amethyst_bronze', 'cobalt']), tool('kama', ['slimesteel', 'cobalt', 'manyullyn'])]);
    sign(14, Y, 0, ['工匠砧', '工具放中间', '周围放强化材料'], null);
    sign(16, Y, 0, ['工匠站', '组装 / 修理'], null);
    sign(18, Y, 0, ['强化工作台', '拆强化', '重新排序'], null);
    sign(20, Y, 0, ['部件加工台', '回收工具'], null);
    sign(17, Y, 2, ['④ 强化', '红石→急迫', '石英→锋利', '钻石 绿宝石…'], null, 'blue');

    // ---- ⑤ the test ground: a wall of stone with ores (hammers, vein hammer), a pit of dirt and gravel (excavator),
    // trees (broad axe) ----
    fill(10, G, 9, 24, G, 24, 'grass_block');
    fill(13, Y, 13, 23, Y + 4, 15, 'stone');
    const ores = ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'cobalt_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore'];
    let k = 0;
    for (let x = 13; x <= 23; x++) for (let y = Y; y <= Y + 4; y++) for (let z = 13; z <= 15; z++) {
      k = k * 1103515245 + 12345 + x * 7 + y * 13 + z * 31 >>> 0;
      if (k % 7 === 0) set(x, y, z, ores[(k >>> 8) % ores.length]);
    }
    // (a vein for the vein hammer: iron through the middle)
    fill(16, Y + 1, 14, 20, Y + 2, 14, 'iron_ore');
    fill(11, G - 2, 18, 15, G, 22, 'gravel');
    fill(11, G - 2, 18, 13, G, 22, 'dirt');
    for (const [tx, tz] of [[19, 21], [22, 18], [22, 23]]) {
      fill(tx, Y, tz, tx, Y + 5, tz, 'oak_log', {
        axis: 'y'
      });
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 6; dy++) {
        if (Math.abs(dx) + Math.abs(dz) > (dy >= 6 ? 1 : 3) || dx === 0 && dz === 0 && dy <= 5) continue;
        if (Math.abs(tx + dx) <= R && Math.abs(tz + dz) <= R) set(tx + dx, Y + dy, tz + dz, 'oak_leaves');
      }
    }
    chest(11, Y, 10, [tool('sledge_hammer', ['cobalt', 'manyullyn', 'hepatizon']), tool('vein_hammer', ['manyullyn', 'cobalt', 'hepatizon']), tool('excavator', ['slimesteel', 'hepatizon', 'cobalt']), tool('broad_axe', ['hepatizon', 'manyullyn', 'cobalt']), tool('scythe', ['queens_slime', 'hepatizon', 'manyullyn']), tool('pickadze', ['rose_gold', 'cobalt']), tool('pickaxe', ['iron', 'wood', 'wood'])]);
    sign(11, Y, 11, ['试用工具箱', '大锤 矿脉锤', '挖掘铲 宽斧'], null);
    sign(15, Y, 17, ['大锤：一次挖', '3×3', '矿脉锤：整条矿'], null);
    sign(12, Y, 17, ['挖掘铲', '挖泥土 / 沙砾', '一次 3×3'], null);
    sign(18, Y, 17, ['宽斧：一下', '砍倒整棵树'], null);
    sign(11, Y, 8, ['⑤ 试挖区', '用大工具试试', '/demo reset', '可以全部恢复'], null, 'blue');

    // ---- ⑥ the slime island: slime dirt and grass, a greenheart and a skyroot tree, vines, a pad of congealed
    // slime to bounce on ----
    const ix = -18,
      iz = -18;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
      const d = Math.hypot(dx, dz);
      if (d > 6.2) continue;
      const h = d < 3 ? 3 : d < 5 ? 2 : 1;
      for (let y = 0; y < h; y++) set(ix + dx, Y + y, iz + dz, y === h - 1 ? 'earth_earth_slime_grass' : 'earth_slime_dirt', {
        snowy: 'false'
      });
    }
    const top = Y + 3;
    fill(ix - 3, top - 1, iz - 2, ix - 3, top + 4, iz - 2, 'greenheart_log', {
      axis: 'y'
    });
    fill(ix + 3, top - 1, iz + 2, ix + 3, top + 5, iz + 2, 'skyroot_log', {
      axis: 'y'
    });
    // (a round crown: wide below, narrowing to a cross on top)
    const R2 = [5, 5, 2, 1];
    const blob = (cx, cy, cz, key) => {
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 2; dy++) {
        if (dx * dx + dz * dz > R2[dy + 1]) continue;
        if (W.getBlock(cx + dx, cy + dy, cz + dz) === 0) set(cx + dx, cy + dy, cz + dz, key);
      }
    };
    blob(ix - 3, top + 4, iz - 2, 'earth_slime_leaves');
    blob(ix + 3, top + 5, iz + 2, 'sky_slime_leaves');
    for (const [vx, vz] of [[ix + 5, iz + 2], [ix + 1, iz + 2]]) for (let y = top + 3; y >= top + 2; y--) if (W.getBlock(vx, y, vz) === 0 && W.getBlock(vx, y + 1, vz) !== 0) set(vx, y, vz, 'sky_slime_vine');else if (W.getBlock(vx, y, vz) === 0 && W.getBlock(vx, y + 1, vz) === idOf('sky_slime_vine')) set(vx, y, vz, 'sky_slime_vine');
    for (const [fx, fz, f] of [[ix, iz + 2, 'earth_slime_fern'], [ix - 1, iz + 3, 'earth_slime_tall_grass'], [ix + 3, iz - 2, 'earth_slime_fern'], [ix - 4, iz, 'earth_slime_tall_grass']]) {
      let y = top + 1;
      while (y > Y && W.getBlock(fx, y - 1, fz) === 0) y--;
      if (W.getBlock(fx, y, fz) === 0) set(fx, y, fz, f);
    }
    fill(ix + 7, Y, iz + 3, ix + 9, Y, iz + 5, 'earth_congealed_slime');
    fill(ix + 7, Y, iz - 2, ix + 9, Y, iz, 'sky_congealed_slime');
    chest(ix + 8, Y, iz + 8, [item('shears'), tool('kama', ['slimesteel', 'cobalt', 'manyullyn']), item('earth_slime_sapling', 4), item('sky_slime_sapling', 4), item('slime_ball', 16)]);
    sign(ix + 8, Y, iz + 7, ['剪刀 镰刀', '史莱姆树苗'], null);
    sign(ix + 6, Y, iz + 9, ['⑥ 史莱姆岛', '史莱姆树叶掉', '树苗和史莱姆球', '跳上凝胶块会弹'], null, 'blue');

    // ---- ⑦ on show: a wall of item frames with finished tools, armour stands in plate, slime and travelers' gear ----
    fill(10, G, -26, 24, G, -12, 'polished_andesite');
    fill(11, Y, -25, 23, Y + 3, -25, 'seared_bricks');
    const show = [tool('cleaver', ['manyullyn', 'hepatizon', 'hepatizon', 'cobalt']), tool('broad_axe', ['hepatizon', 'manyullyn', 'cobalt']), tool('scythe', ['queens_slime', 'hepatizon', 'manyullyn']), tool('sledge_hammer', ['cobalt', 'manyullyn', 'hepatizon']), tool('excavator', ['slimesteel', 'hepatizon', 'cobalt']), tool('vein_hammer', ['manyullyn', 'cobalt']), tool('sword', ['cobalt', 'hepatizon', 'manyullyn']), tool('dagger', ['amethyst_bronze', 'cobalt']), tool('pickaxe', ['rose_gold', 'slimewood', 'cobalt']), tool('longbow', ['slimewood', 'cobalt', 'string']), tool('crossbow', ['cobalt', 'hepatizon', 'string']), tool('javelin', ['cobalt', 'hepatizon']), tool('throwing_axe', ['manyullyn', 'cobalt']), tool('battlesign', ['ancient', 'cobalt']), tool('war_pick', ['cobalt', 'slimewood', 'string']), tool('swasher', ['necrotic_bone', 'iron', 'cobalt']), tool('melting_pan', ['cobalt', 'slimesteel']), tool('earth_staff', []), tool('sky_staff', []), tool('ender_staff', []), tool('flint_and_brick', []), tool('mattock', ['rose_gold', 'cobalt']), tool('kama', ['slimesteel', 'cobalt']), tool('hand_axe', ['hepatizon', 'cobalt'])].filter(Boolean);
    show.forEach((st, i) => {
      const fx = 11 + i % 12 + (i % 12 >= 6 ? 1 : 0),
        fy = Y + 2 - Math.floor(i / 12);
      if (fx > 23 || typeof ItemFrame !== 'function') return;
      const f = new ItemFrame(g, fx, fy, -24, 5);
      f.item = st;
      g.entities.push(f);
    });
    const stand = (x, z, gear) => {
      if (typeof ArmorStand !== 'function') return;
      const s = new ArmorStand(g, x + 0.5, Y, z + 0.5);
      s.arms = true;
      s.yaw = Math.PI;
      s.gear = [gear.boots || null, gear.legs || null, gear.chest || null, gear.head || null, gear.hand || null, null];
      g.entities.push(s);
    };
    stand(12, -18, {
      head: tool('plate_helmet', ['cobalt', 'iron']),
      chest: tool('plate_chestplate', ['cobalt', 'iron']),
      legs: tool('plate_leggings', ['cobalt', 'iron']),
      boots: tool('plate_boots', ['cobalt', 'iron']),
      hand: tool('cleaver', ['manyullyn'])
    });
    stand(15, -18, {
      head: tool('plate_helmet', ['manyullyn', 'cobalt']),
      chest: tool('plate_chestplate', ['hepatizon', 'cobalt']),
      legs: tool('plate_leggings', ['manyullyn', 'cobalt']),
      boots: tool('plate_boots', ['hepatizon', 'cobalt']),
      hand: tool('sword', ['manyullyn'])
    });
    stand(18, -18, {
      head: tool('slime_helmet', ['bone', 'earthslime']),
      chest: item('elytra'),
      legs: tool('slime_leggings', ['leather', 'skyslime']),
      boots: tool('slime_boots', ['leather', 'earthslime']),
      hand: tool('sky_staff', [])
    });
    stand(21, -18, {
      head: tool('travelers_helmet', ['copper', 'leather']),
      chest: tool('travelers_chestplate', ['copper', 'leather']),
      legs: tool('travelers_leggings', ['copper', 'leather']),
      boots: tool('travelers_boots', ['copper', 'leather']),
      hand: tool('longbow', ['slimewood'])
    });
    chest(23, Y, -14, [tool('plate_shield', ['wood', 'cobalt']), tool('travelers_shield', ['copper', 'leather']), tool('slime_wings', ['skyslime']), tool('arrow', ['flint', 'wood', 'feather']), tool('shuriken', ['flint'])]);
    sign(12, Y, -16, ['镶板盔甲', '钴 + 链甲'], null);
    sign(15, Y, -16, ['镶板盔甲', '钴锰 / 黑铜'], null);
    sign(18, Y, -16, ['史莱姆套装', '浇铸做成', '史莱姆头盔'], null);
    sign(21, Y, -16, ['旅行者套装', '铜 + 皮革'], null);
    sign(17, Y, -13, ['⑦ 成品展示', '墙上：各种工具', '盔甲架：三套盔甲', '箱子：盾牌 箭矢'], null, 'blue');

    // ---- around: lamps along the paths ----
    for (const [lx, lz] of [[-3, 15], [3, 15], [-3, 5], [3, 5], [-3, -5], [3, -5], [-8, 6], [8, 6], [-8, -9], [8, -9]]) {
      set(lx, Y, lz, 'stone_brick_wall');
      set(lx, Y + 1, lz, 'lantern', {
        hanging: 'false'
      });
    }

    // the game's time and weather for filming: noon, clear, no mobs
    g.gameRules = Object.assign({}, g.gameRules, {
      advance_time: false,
      advance_weather: false,
      spawn_mobs: false,
      spawn_monsters: false,
      keep_inventory: true
    });
    if (g.worldMeta) g.worldMeta.gameRules = g.gameRules;
    g.worldTime = 6000;
    g.weather = 0;
    g.rainTarget = 0;
    // (no beginners' tutorial popping up over the recording)
    g.tutorial = -1;
    if (g.worldMeta) g.worldMeta.tutorial = -1;
    if (missing.size) console.warn('[tcdemo] not found:', [...missing].join(', '));
    return [...missing];
  }
  function toStart(g) {
    const p = g.player;
    p.pos = [...START];
    p.prev = [...START];
    p.vel = [0, 0, 0];
    p.yaw = 0;
    p.pitch = 0.1;
    p.fallDist = 0;
  }
  function resetPlayer(g) {
    const p = g.player;
    for (let i = 0; i < p.inv.slots.length; i++) p.inv.slots[i] = null;
    p.health = p.maxHealth || 20;
    p.food = 20;
    p.saturation = 5;
    p.fire = 0;
    if (p.effects && p.effects.clear) p.effects.clear();
    toStart(g);
  }
  self.TCDemo = {
    build,
    clear,
    toStart,
    R
  };

  // ---- built each time the world is entered (once its area is loaded): the world's meta object is new for each
  // entry, so the game remembers which one it built for ----
  const loaded = g => {
    const w = g.world;
    for (let x = -R; x <= R; x += 9) for (let z = -R; z <= R; z += 9) if (!w.isLoaded(x, z)) return false;
    return w.isLoaded(R, R);
  };
  const tk = Game.prototype.tick;
  Game.prototype.tick = function () {
    const r = tk.apply(this, arguments);
    if (window.__OFFLINE_MODS) return r; // 离线包：不自动建造教程地图
    if (this.state === 'play' && !this.net && this.worldMeta && this.dim === 'overworld' && this.tcdemoFor !== this.worldMeta && loaded(this)) {
      this.tcdemoFor = this.worldMeta;
      this.worldMeta.tcdemoBuilt = true;
      build(this);
      resetPlayer(this);
      this.ui.message('匠魂教程地图已就绪：沿着 ①→⑦ 走一遍。输入 /demo reset 可以把整张地图重置。', '#FFFF55');
    }
    return r;
  };

  // ---- /demo ----
  if (typeof CMD_RUN !== 'undefined') {
    CMD_RUN.demo = function (ctx, args) {
      const a = String((Array.isArray(args) ? args[0] : args) || '').trim();
      if (this.net) {
        this.ui.message('联机里不能用', '#FF5555');
        return;
      }
      if (this.dim !== 'overworld') {
        this.ui.message('先回到主世界再用 /demo', '#FF5555');
        return;
      }
      if (a === 'reset') {
        const miss = build(this);
        resetPlayer(this);
        this.ui.message('教程地图已重置：方块、箱子、告示牌、展示框、盔甲架和你的物品栏都回到了初始状态。', '#55FF55');
        if (miss.length) this.ui.message('（缺少：' + miss.join('、') + '）', '#AAAAAA');
      } else if (a === 'tp' || a === 'start') {
        toStart(this);
        this.ui.message('已回到起点', '#55FF55');
      } else this.ui.message('/demo reset 重置整张教程地图（含箱子和物品栏）；/demo tp 回到起点', '#FFFF55');
    };
    if (typeof CMDS_LOCAL !== 'undefined') CMDS_LOCAL.push(['demo', '/demo <reset|tp>', '[匠魂教程地图] 重置地图 / 回到起点', [['reset', 'tp']]]);
    (self.CMD_FREE || (self.CMD_FREE = new Set())).add('demo');
  }
})();
