'use strict';

// 农夫乐事教程地图 (tutorial map: the 模组 screen's 教程地图 on 农夫乐事's card; first made for the recording build #V2): a superflat world with 农夫乐事's play laid out along a route, ① to ⑥ -
// the kitchen (a stew already cooking in the pot on a lit stove, meat roasting on another, the skillet, the cutting
// board with cabbages on it), the farm (cabbages, onions, tomatoes up their ropes, a rice paddy, rich soil with
// mushroom colonies, compost), the wild crops each on its own ground, the feasts and pies on their tables, the cabinets
// / crates / tatami / baskets / rope fence / safety net, and a wall of finished dishes - each with signs and full chests.
// Built each time the world is entered (the user 11-13: a fresh map every time, whatever was done to it before); /demo reset builds it all again (every block, chest, sign, frame, the
// dropped items and the player's inventory), /demo tp goes back to the start. Our own code; the map laid out by hand.
(function () {
  if (window.__OFFLINE_MODS) return; // 离线包：停用教程地图玩法（不再自动建图/传送）
  if (typeof Game !== 'function' || !self.FD) return;
  const FD = self.FD;
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
    const i = st.findIndex(s => Object.keys(props).every(k => !(k in s) || String(s[k]) === String(props[k])));
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
  function chest(x, y, z, stacks, facing = 'south') {
    set(x, y, z, 'chest', {
      facing
    });
    const be = g0.getBlockEntity(x, y, z, 'chest');
    be.slots = new Array(27).fill(null);
    delete be.loot;
    stacks.filter(Boolean).slice(0, 27).forEach((s, i) => {
      be.slots[i] = s;
    });
    g0.markBlockEntity && g0.markBlockEntity(be);
  }
  // a standing sign facing the start (south), or a wall sign; up to 4 lines a side, the back the same
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
  const be = (x, y, z, kind) => {
    const b = FD.beAt(g0, x, y, z, kind);
    return b;
  };

  // ---- clearing the area: the ground back to grass over dirt over stone, air above, nothing left on it ----
  const inArea = (x, y, z) => x >= -R && x <= R && z >= -R && z <= R && y >= BOTTOM && y <= TOP;
  function clear(g) {
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      for (let y = BOTTOM; y <= TOP; y++) set(x, y, z, y > G ? 'air' : y === G ? 'grass_block' : y >= G - 3 ? 'dirt' : 'stone');
    }
    for (const [k, b] of [...g.blockEntities]) if (b.pos && inArea(b.pos[0], b.pos[1], b.pos[2])) g.blockEntities.delete(k);
    if (g.signs) for (const k of [...g.signs.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      if (inArea(x, y, z)) g.signs.delete(k);
    }
    const p = g.player;
    g.entities = g.entities.filter(e => e === p || !inArea(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2])));
  }

  // the dishes (as the mod's creative tab has them): finished meals, sweets and drinks, ingredients
  const MEALS = ['fried_egg', 'cooked_rice', 'bone_broth', 'beef_stew', 'chicken_soup', 'vegetable_soup', 'fish_stew', 'fried_rice', 'pumpkin_soup', 'baked_cod_stew', 'noodle_soup', 'onion_soup', 'bacon_and_eggs', 'pasta_with_meatballs', 'pasta_with_mutton_chop', 'mushroom_rice', 'roasted_mutton_chops', 'vegetable_noodles', 'steak_and_potatoes', 'ratatouille', 'squid_ink_pasta', 'grilled_salmon', 'roast_chicken', 'stuffed_pumpkin', 'honey_glazed_ham', 'shepherds_pie', 'gleaming_salad', 'fruit_salad', 'mixed_salad', 'nether_salad', 'barbecue_stick', 'egg_sandwich', 'chicken_sandwich', 'hamburger', 'bacon_sandwich', 'mutton_wrap', 'dumplings', 'stuffed_potato', 'cabbage_rolls', 'salmon_roll', 'cod_roll', 'kelp_roll', 'kelp_roll_slice', 'dog_food', 'horse_feed'];
  const SWEETS = ['milk_bottle', 'hot_cocoa', 'apple_cider', 'melon_juice', 'apple_pie_slice', 'sweet_berry_cheesecake_slice', 'chocolate_pie_slice', 'pumpkin_pie_slice', 'cake_slice', 'sweet_berry_cookie', 'honey_cookie', 'melon_popsicle', 'glow_berry_custard', 'apple_pie', 'sweet_berry_cheesecake', 'chocolate_pie'];
  const INGREDIENTS = ['cabbage', 'tomato', 'onion', 'rice', 'rice_panicle', 'tomato_sauce', 'wheat_dough', 'raw_pasta', 'pumpkin_slice', 'cabbage_leaf', 'minced_beef', 'beef_patty', 'chicken_cuts', 'cooked_chicken_cuts', 'fd_bacon', 'cooked_bacon', 'cod_slice', 'cooked_cod_slice', 'salmon_slice', 'cooked_salmon_slice', 'mutton_chops', 'cooked_mutton_chops', 'ham', 'smoked_ham', 'pie_crust'];

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
    sign(-2, Y, 21, ['农夫乐事', '教程地图', '沿路线体验', '①→⑥'], null, 'blue');
    sign(2, Y, 21, ['/demo reset', '整张地图重置', '/demo tp', '回到起点'], null, 'red');
    chest(0, Y, 20, [item('flint_knife'), item('iron_knife'), item('golden_knife'), item('diamond_knife'), item('netherite_knife'), item('skillet'), item('bowl', 32), item('glass_bottle', 16), item('bread', 16)]);
    sign(1, Y, 20, ['五种刀', '平底锅', '碗和玻璃瓶'], null);

    // ---- ① the kitchen: a stew cooking, meat roasting on a stove, the skillet, the cutting board ----
    fill(-23, G, 9, -11, G, 18, 'spruce_planks');
    // the pot on a lit stove, with beef, carrot and potato in it and bowls to serve: 炖牛肉 is cooking
    set(-21, Y, 12, 'stove', {
      facing: 'south',
      lit: 'true'
    });
    set(-21, Y + 1, 12, 'cooking_pot', {
      facing: 'south',
      support: 'none'
    });
    {
      const p = be(-21, Y + 1, 12, 'pot');
      p.slots = [item('beef'), item('carrot'), item('potato'), null, null, null, item('bowl', 8), null];
      p.cook = 0;
    }
    // a stove with meat on top (roasting, as on a campfire)
    set(-18, Y, 12, 'stove', {
      facing: 'south',
      lit: 'true'
    });
    {
      const s = be(-18, Y, 12, 'stove');
      s.slots = [item('beef'), item('chicken'), item('mutton'), item('cod'), item('salmon'), item('porkchop')];
      s.cook = [0, 0, 0, 0, 0, 0];
      s.time = [600, 600, 600, 600, 600, 600];
    }
    // the skillet on a lit stove; the cutting board with cabbages waiting for a knife
    set(-15, Y, 12, 'stove', {
      facing: 'south',
      lit: 'true'
    });
    set(-15, Y + 1, 12, 'skillet', {
      facing: 'south',
      support: 'false'
    });
    {
      const s = be(-15, Y + 1, 12, 'skillet');
      s.skillet = item('skillet');
    }
    set(-13, Y, 12, 'cutting_board', {
      facing: 'south'
    });
    {
      const b = be(-13, Y, 12, 'board');
      b.slots = [item('cabbage', 8)];
      b.carved = false;
    }
    chest(-22, Y, 15, [item('beef', 32), item('chicken', 32), item('porkchop', 32), item('mutton', 32), item('cod', 32), item('salmon', 32), item('rabbit', 16), item('egg', 16), item('ink_sac', 8), item('bone', 16), item('milk_bucket'), item('milk_bucket')]);
    chest(-19, Y, 15, [item('cabbage', 32), item('tomato', 32), item('onion', 32), item('rice', 32), item('potato', 32), item('carrot', 32), item('beetroot', 32), item('pumpkin', 8), item('wheat', 32), item('brown_mushroom', 16), item('red_mushroom', 16), item('kelp', 16), item('baked_potato', 8)]);
    chest(-16, Y, 15, [item('sugar', 32), item('cocoa_beans', 16), item('sweet_berries', 32), item('glow_berries', 16), item('honey_bottle', 8), item('apple', 16), item('melon_slice', 32), item('chorus_fruit', 8), item('bowl', 64), item('glass_bottle', 32), item('water_bucket'), item('water_bucket'), item('stick', 16)]);
    chest(-13, Y, 15, INGREDIENTS.map(k => item(k, 16)));
    sign(-21, Y, 10, ['厨锅', '放在炉灶上', '6 格食材 + 碗', '正在炖牛肉'], null);
    sign(-18, Y, 10, ['炉灶', '右键放食物', '顶上 6 格', '像营火一样烤'], null);
    sign(-15, Y, 10, ['平底锅', '手拿锅对着热源', '按住使用来煎', '潜行才放下'], null);
    sign(-13, Y, 10, ['砧板', '放上食材', '用刀右键切', '切出食材'], null);
    sign(-22, Y, 17, ['肉和鱼'], null);
    sign(-19, Y, 17, ['蔬菜和谷物'], null);
    sign(-16, Y, 17, ['甜的 / 容器'], null);
    sign(-13, Y, 17, ['切好的食材'], null);
    sign(-11, Y, 13, ['① 厨房', '炉灶 厨锅', '平底锅 砧板'], 'east', 'blue');

    // ---- ② the farm: crops on hydrated farmland, tomatoes up their ropes, a rice paddy, rich soil, compost ----
    fill(-23, G, -7, -11, G, 3, 'grass_block');
    // farmland rows x -23..-17 with a water channel at x -20
    for (let z = -6; z <= -1; z++) for (let x = -23; x <= -17; x++) set(x, G, z, x === -20 ? 'water' : 'farmland', {
      moisture: '7'
    });
    const row = (z, key, props) => {
      for (let x = -23; x <= -17; x++) if (x !== -20) set(x, Y, z, key, props);
    };
    row(-6, 'cabbages', {
      age: '7'
    });
    row(-5, 'onions', {
      age: '7'
    });
    row(-4, 'budding_tomatoes', {
      age: '4'
    });
    row(-3, 'cabbages', {
      age: '3'
    });
    row(-2, 'wheat', {
      age: '7'
    });
    row(-1, 'carrots', {
      age: '7'
    });
    // tomatoes on ropes: farmland, the vine, two of it on the rope, the rope, a beam over them
    for (let x = -15; x <= -13; x++) {
      set(x, G, -5, 'farmland', {
        moisture: '7'
      });
      set(x, G, -4, 'water');
      set(x, Y, -5, 'tomatoes', {
        age: '3',
        ropelogged: 'true'
      });
      set(x, Y + 1, -5, 'tomatoes_on_rope', {
        age: '3'
      });
      set(x, Y + 2, -5, 'tomatoes_on_rope', {
        age: '2'
      });
      set(x, Y + 3, -5, 'rope', {
        north: 'false',
        south: 'false',
        east: 'false',
        west: 'false',
        tied_to_bell: 'false'
      });
      set(x, Y + 4, -5, 'spruce_planks');
    }
    set(-16, Y, -5, 'spruce_fence');
    set(-16, Y + 1, -5, 'spruce_fence');
    set(-16, Y + 2, -5, 'spruce_fence');
    set(-16, Y + 3, -5, 'spruce_fence');
    set(-16, Y + 4, -5, 'spruce_planks');
    set(-12, Y, -5, 'spruce_fence');
    set(-12, Y + 1, -5, 'spruce_fence');
    set(-12, Y + 2, -5, 'spruce_fence');
    set(-12, Y + 3, -5, 'spruce_fence');
    set(-12, Y + 4, -5, 'spruce_planks');
    // the rice paddy: dirt under water, ringed by mud bricks; rice grown up to its panicles
    fill(-16, Y, -3, -11, Y, 1, 'mud_bricks');
    for (let x = -15; x <= -12; x++) for (let z = -2; z <= 0; z++) {
      set(x, G, z, 'dirt');
      if ((x + z) % 2 === 0) {
        set(x, Y, z, 'rice', {
          age: '3',
          supporting: 'true'
        });
        set(x, Y + 1, z, 'rice_panicles', {
          age: '3'
        });
      } else set(x, Y, z, 'water');
    }
    // rich soil: mushroom colonies grow on it; compost turns into it
    set(-23, G, 1, 'rich_soil');
    set(-23, Y, 1, 'brown_mushroom_colony', {
      age: '3'
    });
    set(-22, G, 1, 'rich_soil');
    set(-22, Y, 1, 'red_mushroom_colony', {
      age: '3'
    });
    set(-21, G, 1, 'rich_soil');
    set(-21, Y, 1, 'brown_mushroom');
    set(-19, G, 1, 'rich_soil_farmland', {
      moisture: '7'
    });
    set(-19, Y, 1, 'wheat', {
      age: '4'
    });
    set(-18, G, 1, 'water');
    set(-17, Y, 1, 'organic_compost', {
      composting: '5'
    });
    set(-16, Y, 1, 'organic_compost', {
      composting: '0'
    });
    chest(-23, Y, 3, [item('cabbage_seeds', 32), item('tomato_seeds', 32), item('onion', 32), item('rice', 32), item('wheat_seeds', 32), item('carrot', 16), item('potato', 16), item('bone_meal', 64), item('iron_hoe'), item('water_bucket'), item('rope', 32), item('organic_compost', 8), item('rich_soil', 16), item('straw', 16), item('tree_bark', 16)], 'south');
    sign(-21, Y, 3, ['卷心菜 洋葱', '番茄 稻米', '种在耕地上', '骨粉催熟'], null);
    sign(-14, Y, 2, ['番茄长成藤', '往上爬绳子', '稻米种在水里', '长出稻穗'], null);
    sign(-18, Y, 3, ['沃土：作物长得快', '蘑菇长成群落', '堆肥慢慢', '变成沃土'], null);
    sign(-11, Y, -2, ['② 田地', '作物 番茄藤', '稻田 沃土'], 'east', 'blue');

    // ---- ③ the wild crops, each on its own ground ----
    const patch = (x0, z0, ground, plant, props) => {
      fill(x0, G, z0, x0 + 2, G, z0 + 2, ground);
      for (let x = x0; x <= x0 + 2; x++) for (let z = z0; z <= z0 + 2; z++) if ((x + z) % 2 === 0) set(x, Y, z, plant, props);
    };
    patch(-9, -24, 'sand', 'wild_cabbages');
    patch(-5, -24, 'sand', 'wild_beetroots');
    patch(-1, -24, 'grass_block', 'wild_onions');
    patch(3, -24, 'grass_block', 'wild_carrots');
    patch(7, -24, 'podzol', 'wild_potatoes');
    patch(-9, -19, 'red_sand', 'wild_tomatoes');
    patch(-5, -19, 'sand', 'sandy_shrub');
    // wild rice: two blocks tall, standing in water over dirt, in a little pond
    fill(-1, Y, -20, 3, Y, -16, 'mud_bricks');
    for (let x = 0; x <= 2; x++) for (let z = -19; z <= -17; z++) {
      set(x, G, z, 'dirt');
      if ((x + z) % 2 === 0) {
        set(x, Y, z, 'wild_rice', {
          half: 'lower'
        });
        set(x, Y + 1, z, 'wild_rice', {
          half: 'upper'
        });
      } else set(x, Y, z, 'water');
    }
    // tall grass to cut with a knife for straw
    fill(5, G, -19, 8, G, -16, 'grass_block');
    for (let x = 5; x <= 8; x++) for (let z = -19; z <= -16; z++) set(x, Y, z, (x + z) % 3 ? 'short_grass' : 'tall_grass', {
      half: 'lower'
    });
    for (let x = 5; x <= 8; x++) for (let z = -19; z <= -16; z++) if (!((x + z) % 3)) set(x, Y + 1, z, 'tall_grass', {
      half: 'upper'
    });
    sign(-8, Y, -21, ['野卷心菜'], null);
    sign(-4, Y, -21, ['野甜菜'], null);
    sign(0, Y, -21, ['野洋葱'], null);
    sign(4, Y, -21, ['野胡萝卜'], null);
    sign(8, Y, -21, ['野马铃薯'], null);
    sign(-8, Y, -16, ['野番茄'], null);
    sign(-4, Y, -16, ['沙生灌木'], null);
    sign(1, Y, -15, ['野生稻'], null);
    sign(6, Y, -15, ['用刀割草', '得到稻草'], null);
    sign(-1, Y, -13, ['③ 野生作物', '在各自的群系', '里自然生成', '挖掉得到作物'], null, 'blue');

    // ---- ④ the feasts and pies, on their tables ----
    fill(11, G, -7, 23, G, 3, 'oak_planks');
    const FEASTS = [['roast_chicken_block', 4], ['stuffed_pumpkin_block', 4], ['honey_glazed_ham_block', 4], ['shepherds_pie_block', 4], ['gleaming_salad_block', 4], ['rice_roll_medley_block', 8]];
    FEASTS.forEach(([k, n], i) => {
      const x = 12 + i * 2;
      set(x, Y, -4, 'stripped_oak_log', {
        axis: 'x'
      });
      set(x, Y + 1, -4, k, {
        facing: 'south',
        servings: String(n)
      });
    });
    ['apple_pie', 'sweet_berry_cheesecake', 'chocolate_pie', 'fd_pumpkin_pie'].forEach((k, i) => {
      const x = 13 + i * 2;
      set(x, Y, 0, 'stripped_oak_log', {
        axis: 'x'
      });
      set(x, Y + 1, 0, k, {
        facing: 'south',
        bites: '0'
      });
    });
    chest(22, Y, 2, [item('bowl', 64), item('bowl', 64), item('bone', 8), item('iron_knife'), item('flint_knife')]);
    sign(17, Y, -2, ['盛宴：拿碗', '右键盛一份', '盛完剩下', '空盘子'], null);
    sign(15, Y, 2, ['派：右键吃一口', '用刀右键', '切成切片'], null);
    sign(11, Y, -6, ['④ 盛宴与派', '烤鸡 酿南瓜', '蜜汁火腿 牧羊人派', '金光沙拉 饭卷'], 'west', 'blue');

    // ---- ⑤ cabinets, crates, tatami, baskets, the rope fence, the safety net ----
    fill(11, G, 9, 23, G, 18, 'stone_bricks');
    ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'].forEach((w, i) => set(12 + i, Y, 10, w + '_cabinet', {
      facing: 'south',
      open: 'false'
    }));
    ['carrot_crate', 'potato_crate', 'beetroot_crate', 'cabbage_crate', 'tomato_crate', 'onion_crate', 'rice_bale', 'rice_bag', 'straw_bale'].forEach((k, i) => set(12 + i, Y, 13, k, k === 'rice_bale' || k === 'straw_bale' ? {
      axis: 'y'
    } : {
      facing: 'up'
    }));
    set(12, Y, 15, 'tatami', {
      facing: 'east'
    });
    set(13, Y, 15, 'tatami', {
      facing: 'west'
    });
    set(15, Y, 15, 'full_tatami_mat', {
      facing: 'east',
      part: 'foot'
    });
    set(16, Y, 15, 'full_tatami_mat', {
      facing: 'east',
      part: 'head'
    });
    set(18, Y, 15, 'half_tatami_mat');
    set(19, Y, 15, 'canvas_rug');
    set(12, Y, 17, 'wooden_basket', {
      facing: 'up'
    });
    set(14, Y, 17, 'bamboo_basket', {
      facing: 'up'
    });
    for (let x = 16; x <= 20; x++) set(x, Y, 18, x === 18 ? 'rope_fence_gate' : 'rope_fence', {
      facing: 'south'
    });
    // the safety net: a tower to jump from, the net below
    fill(22, Y, 15, 22, Y + 5, 15, 'oak_planks');
    for (let y = Y; y <= Y + 5; y++) set(22, y, 16, 'ladder', {
      facing: 'south'
    });
    set(23, Y, 15, 'safety_net');
    set(23, Y, 16, 'safety_net');
    set(23, Y, 17, 'safety_net');
    chest(20, Y, 12, [item('wooden_basket', 4), item('bamboo_basket', 4), item('oak_cabinet', 4), item('canvas', 16), item('straw', 32), item('rope', 32), item('safety_net', 8), item('tatami', 8), item('full_tatami_mat', 8), item('canvas_rug', 8), item('canvas_sign', 8), item('red_canvas_sign', 4), item('blue_canvas_sign', 4), item('hanging_canvas_sign', 4)]);
    sign(17, Y, 11, ['橱柜：右键打开', '能放 18 格'], null);
    sign(15, Y, 14, ['作物箱 / 稻米捆', '摔下来伤害小'], null);
    sign(13, Y, 18, ['篮子：开口吸进', '掉在前面的物品'], null);
    sign(21, Y, 17, ['爬上去跳到', '安全网上', '不会摔伤'], null);
    sign(11, Y, 14, ['⑤ 储物与装饰', '橱柜 作物箱', '榻榻米 篮子', '绳栅栏 安全网'], 'west', 'blue');

    // ---- ⑥ the finished dishes: a wall of frames, and every food in chests ----
    fill(10, G, -24, 24, G, -14, 'bricks');
    fill(10, Y, -25, 24, Y + 3, -25, 'spruce_planks');
    const show = MEALS.slice(0, 36).map(k => item(k));
    show.forEach((st, i) => {
      const fx = 11 + i % 12 + (i % 12 >= 6 ? 1 : 0),
        fy = Y + 2 - Math.floor(i / 12);
      if (!st || typeof ItemFrame !== 'function') return;
      const f = new ItemFrame(g, fx, fy, -24, 5);
      f.item = st;
      g.entities.push(f);
    });
    chest(12, Y, -19, MEALS.slice(0, 27).map(k => item(k, 8)));
    chest(14, Y, -19, MEALS.slice(27).map(k => item(k, 8)));
    chest(16, Y, -19, SWEETS.map(k => item(k, 8)));
    chest(18, Y, -19, [item('roast_chicken_block'), item('stuffed_pumpkin_block'), item('honey_glazed_ham_block'), item('shepherds_pie_block'), item('gleaming_salad_block'), item('rice_roll_medley_block'), item('apple_pie'), item('sweet_berry_cheesecake'), item('chocolate_pie'), item('stove', 4), item('cooking_pot', 4), item('cutting_board', 4), item('skillet', 2)]);
    sign(12, Y, -17, ['料理'], null);
    sign(14, Y, -17, ['料理'], null);
    sign(16, Y, -17, ['甜点和饮品'], null);
    sign(18, Y, -17, ['盛宴 派', '厨具'], null);
    sign(20, Y, -16, ['⑥ 料理展示', '墙上：做好的菜', '箱子：全部食物', '吃了有滋养效果'], null, 'blue');

    // ---- around: lamps along the paths ----
    for (const [lx, lz] of [[-3, 15], [3, 15], [-3, 5], [3, 5], [-3, -5], [3, -5], [-8, 6], [8, 6], [-8, -9], [8, -9]]) {
      set(lx, Y, lz, 'stone_brick_wall');
      set(lx, Y + 1, lz, 'lantern', {
        hanging: 'false'
      });
    }

    // the game's time and weather for filming: noon, clear, no mobs; hungry enough to eat what is made
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
    g.tutorial = -1;
    if (g.worldMeta) g.worldMeta.tutorial = -1;
    if (g.flushMesh) g.flushMesh();
    if (missing.size) console.warn('[fddemo] not found:', [...missing].join(', '));
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
    // (hungry, so the dishes can be eaten on camera)
    p.health = p.maxHealth || 20;
    p.food = 8;
    p.saturation = 0;
    p.fire = 0;
    if (p.effects && p.effects.clear) p.effects.clear();
    toStart(g);
  }
  self.FDDemo = {
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
    if (this.state === 'play' && !this.net && this.worldMeta && this.dim === 'overworld' && this.fddemoFor !== this.worldMeta && loaded(this)) {
      this.fddemoFor = this.worldMeta;
      this.worldMeta.fddemoBuilt = true;
      build(this);
      resetPlayer(this);
      this.ui.message('农夫乐事教程地图已就绪：沿着 ①→⑥ 走一遍。输入 /demo reset 可以把整张地图重置。', '#FFFF55');
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
        this.ui.message('教程地图已重置：方块、箱子、告示牌、展示框和你的物品栏都回到了初始状态。', '#55FF55');
        if (miss.length) this.ui.message('（缺少：' + miss.join('、') + '）', '#AAAAAA');
      } else if (a === 'tp' || a === 'start') {
        toStart(this);
        this.ui.message('已回到起点', '#55FF55');
      } else this.ui.message('/demo reset 重置整张教程地图（含箱子和物品栏）；/demo tp 回到起点', '#FFFF55');
    };
    if (typeof CMDS_LOCAL !== 'undefined') CMDS_LOCAL.push(['demo', '/demo <reset|tp>', '[农夫乐事教程地图] 重置地图 / 回到起点', [['reset', 'tp']]]);
    (self.CMD_FREE || (self.CMD_FREE = new Set())).add('demo');
  }
})();
