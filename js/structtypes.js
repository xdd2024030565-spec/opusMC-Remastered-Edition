
'use strict';

// ---------------------------------------------------------------------------
// Structure types that are not jigsaw (run in the generation worker, registered into SG.TYPES):
// igloo, shipwreck, ocean ruins, ruined portals, nether fossils, buried treasure (templates + code),
// and the scattered feature pieces swamp hut, desert pyramid and jungle temple (code-built).
// Every state literal below ('name[k=v,...]', sorted properties) is collected by
// tools/build_structures.py into the shared state table.
// ---------------------------------------------------------------------------
(function () {
  const H = SG.helpers,
    T = SG.TYPES,
    D = H.D;
  const S = key => {
    const i = H.stateOf(key);
    if (i === undefined) throw new Error('state missing from the table: ' + key);
    return i;
  };
  const AIR = () => S('air');
  const start = (name, def, pieces, adapt) => {
    const b = pieces.reduce((a, p) => [Math.min(a[0], p.box[0]), Math.min(a[1], p.box[1]), Math.min(a[2], p.box[2]), Math.max(a[3], p.box[3]), Math.max(a[4], p.box[4]), Math.max(a[5], p.box[5])], pieces[0].box.slice());
    return {
      name,
      def,
      pieces,
      box: b,
      adapt: adapt || def.terrain_adaptation || 'none',
      step: def.step
    };
  };
  const biomeOk = (gen, def, x, y, z) => new Set(H.biomeSet(def.biomes)).has(gen.biomeAtQuart(x >> 2, y >> 2, z >> 2));
  // Structure.onTopOfChunkCenter: the first occupied block at the chunk's middle
  const centre = (gen, cx, cz, floor) => {
    const x = cx * 16 + 8,
      z = cz * 16 + 8;
    return [x, gen.baseHeight(x, z, floor) - 1, z];
  };
  const pick = (list, r) => list[r.nextInt(list.length)];
  const range = (pre, a, b) => {
    const o = [];
    for (let i = a; i <= b; i++) o.push(pre + i);
    return o;
  };

  // ---- igloo (IglooPieces) ------------------------------------------------------------------------
  T.igloo = (gen, name, def, cx, cz, r) => {
    const c = centre(gen, cx, cz, false);
    if (!biomeOk(gen, def, c[0], c[1], c[2])) return null;
    const rot = r.nextInt(4),
      pos = [cx * 16, 90, cz * 16];
    const PIV = {
        top: [3, 5],
        middle: [1, 1],
        bottom: [3, 7]
      },
      OFF = {
        top: [0, 0, 0],
        middle: [2, -3, 4],
        bottom: [0, -3, -2]
      };
    // all pieces are lowered by the surface height at the igloo's door column
    const d = H.rotPosM(3, 0, 0, rot, 0, 3, 5),
      dy = gen.baseHeight(pos[0] + d[0], pos[2] + d[2]) - 90 - 1;
    const mk = (k, down) => H.tplPiece('igloo/' + k, [pos[0] + OFF[k][0], 90 + OFF[k][1] - down + dy, pos[2] + OFF[k][2]], rot, 0, PIV[k], {
      marker: (m, x, y, z, set, out) => {
        if (m === 'chest') {
          set(x, y, z, AIR());
          out.loot.push([x, y - 1, z, 'loot', 'chests/igloo_chest']);
        }
      }
    });
    const pieces = [];
    if (r.nextDouble() < 0.5) {
      const n = r.nextInt(8) + 4;
      pieces.push(mk('bottom', n * 3));
      for (let j = 0; j < n - 1; j++) pieces.push(mk('middle', j * 3));
    }
    const top = mk('top', 0);
    top.post = (x0, z0, set, getId) => {
      // a snow block in the doorway unless the ladder shaft is below
      const q = H.rotPosM(3, 0, 5, rot, 0, 3, 5),
        x = top.pos[0] + q[0],
        y = top.pos[1] + q[1],
        z = top.pos[2] + q[2];
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) return;
      const below = SG.ID_NAME[getId(x, y - 1, z)] || 'air';
      if (below !== 'air' && below !== 'ladder') set(x, y, z, S('snow_block'));
    };
    pieces.push(top);
    return start(name, def, pieces.filter(Boolean));
  };

  // ---- shipwreck (ShipwreckPieces) ------------------------------------------------------------------
  const SHIP_OCEAN = ['with_mast', 'upsidedown_full', 'upsidedown_fronthalf', 'upsidedown_backhalf', 'sideways_full', 'sideways_fronthalf', 'sideways_backhalf', 'rightsideup_full', 'rightsideup_fronthalf', 'rightsideup_backhalf', 'with_mast_degraded', 'upsidedown_full_degraded', 'upsidedown_fronthalf_degraded', 'upsidedown_backhalf_degraded', 'sideways_full_degraded', 'sideways_fronthalf_degraded', 'sideways_backhalf_degraded', 'rightsideup_full_degraded', 'rightsideup_fronthalf_degraded', 'rightsideup_backhalf_degraded'];
  const SHIP_BEACHED = ['with_mast', 'sideways_full', 'sideways_fronthalf', 'sideways_backhalf', 'rightsideup_full', 'rightsideup_fronthalf', 'rightsideup_backhalf', 'with_mast_degraded', 'rightsideup_full_degraded', 'rightsideup_fronthalf_degraded', 'rightsideup_backhalf_degraded'];
  const SHIP_LOOT = {
    map_chest: 'chests/shipwreck_map',
    treasure_chest: 'chests/shipwreck_treasure',
    supply_chest: 'chests/shipwreck_supply'
  };
  T.shipwreck = (gen, name, def, cx, cz, r) => {
    const beached = !!def.is_beached,
      c = centre(gen, cx, cz, !beached);
    if (!biomeOk(gen, def, c[0], c[1], c[2])) return null;
    const rot = r.nextInt(4),
      t = pick(beached ? SHIP_BEACHED : SHIP_OCEAN, r),
      tpl = H.TPL['shipwreck/' + t];
    if (!tpl) return null;
    const x0 = cx * 16,
      z0 = cz * 16,
      s = tpl.size;
    // the wreck rests on the average floor height of its footprint (beached: sunk into the lowest point)
    let sum = 0,
      n = 0,
      mn = 1e9;
    for (let x = 0; x < s[0]; x += 2) for (let z = 0; z < s[2]; z += 2) {
      const h = gen.baseHeight(x0 + x, z0 + z, !beached);
      sum += h;
      n++;
      mn = Math.min(mn, h);
    }
    const y = beached ? mn - (s[1] >> 1) - r.nextInt(3) : Math.floor(sum / n);
    const p = H.tplPiece('shipwreck/' + t, [x0, y, z0], rot, 0, [4, 15], {
      ignoreAir: true,
      marker: (m, x, yy, z, set, out) => {
        if (SHIP_LOOT[m]) out.loot.push([x, yy - 1, z, 'loot', SHIP_LOOT[m]]);
      }
    });
    return p && start(name, def, [p]);
  };

  // ---- ocean ruins (OceanRuinPieces) ------------------------------------------------------------------
  const WARM = range('underwater_ruin/warm_', 1, 8),
    BIG_WARM = range('underwater_ruin/big_warm_', 4, 7);
  const BRICK = range('underwater_ruin/brick_', 1, 8),
    CRACKED = range('underwater_ruin/cracked_', 1, 8),
    MOSSY = range('underwater_ruin/mossy_', 1, 8);
  const BIG = k => [1, 2, 3, 8].map(i => 'underwater_ruin/big_' + k + '_' + i);
  T.ocean_ruin = (gen, name, def, cx, cz, r) => {
    const c = centre(gen, cx, cz, true);
    if (!biomeOk(gen, def, c[0], c[1], c[2])) return null;
    const warm = def.biome_temp === 'warm',
      pieces = [];
    const pos = [cx * 16, 90, cz * 16],
      rot = r.nextInt(4);
    const add = (p, rot, large, integ) => {
      const mkp = (n, integrity) => {
        const tpl = H.TPL[n];
        if (!tpl) return;
        // OceanRuinPiece.postProcess: drop onto the floor, lower if the footprint dips
        let y = gen.baseHeight(p[0], p[2], true);
        const e = H.rotPos(tpl.size[0] - 1, 0, tpl.size[2] - 1, rot);
        let lo = y;
        for (const [ax, az] of [[0, 0], [e[0], 0], [0, e[2]], [e[0], e[2]], [e[0] >> 1, e[2] >> 1]]) lo = Math.min(lo, gen.baseHeight(p[0] + ax, p[2] + az, true));
        if (y - 1 - lo > 2) y = lo + 1;
        pieces.push(H.tplPiece(n, [p[0], y, p[2]], rot, 0, null, {
          ignoreAir: true,
          integrity,
          marker: (m, x, yy, z, set, out) => {
            if (m === 'chest') {
              set(x, yy, z, S('chest[facing=north,type=single,waterlogged=true]'));
              out.loot.push([x, yy, z, 'loot', large ? 'chests/underwater_ruin_big' : 'chests/underwater_ruin_small']);
            }
          }
        }));
      };
      if (warm) mkp(pick(large ? BIG_WARM : WARM, r), integ);else {
        const L = large ? [BIG('brick'), BIG('cracked'), BIG('mossy')] : [BRICK, CRACKED, MOSSY],
          i = r.nextInt(L[0].length);
        mkp(L[0][i], integ);
        mkp(L[1][i], 0.7);
        mkp(L[2][i], 0.5);
      }
    };
    const large = r.nextFloat() <= def.large_probability;
    add(pos, rot, large, large ? 0.9 : 0.8);
    if (large && r.nextFloat() <= def.cluster_probability) {
      // a ring of small ruins around the big one
      const e = H.rotPos(15, 0, 15, rot),
        bx = Math.min(pos[0], pos[0] + e[0]),
        bz = Math.min(pos[2], pos[2] + e[2]);
      const ri = (a, b) => a + r.nextInt(b - a + 1);
      const spots = [[-16 + ri(1, 8), 16 + ri(1, 7)], [-16 + ri(1, 8), ri(1, 7)], [-16 + ri(1, 8), -16 + ri(4, 8)], [ri(1, 7), 16 + ri(1, 7)], [ri(1, 7), -16 + ri(4, 6)], [16 + ri(1, 7), 16 + ri(3, 8)], [16 + ri(1, 7), ri(1, 5)], [16 + ri(1, 7), -16 + ri(4, 8)]].map(([a, b]) => [bx + a, 90, bz + b]);
      const n = ri(4, 8);
      for (let j = 0; j < n && spots.length; j++) {
        const q = spots.splice(r.nextInt(spots.length), 1)[0];
        add(q, r.nextInt(4), false, 0.8);
      }
    }
    return pieces.length ? start(name, def, pieces) : null;
  };

  // ---- nether fossils ---------------------------------------------------------------------------------
  T.nether_fossil = (gen, name, def, cx, cz, r) => {
    const x = cx * 16 + r.nextInt(16),
      z = cz * 16 + r.nextInt(16),
      sea = gen.sea;
    let y = H.sampleHeight(gen, def.height, r);
    while (y > sea) {
      const air = gen.densityAt(x, y, z) <= 0;
      y--;
      if (air && gen.densityAt(x, y, z) > 0) break;
    }
    if (y <= sea || !biomeOk(gen, def, x, y, z)) return null;
    const rot = r.nextInt(4),
      f = 'nether_fossils/fossil_' + (1 + r.nextInt(14));
    const p = H.tplPiece(f, [x, y, z], rot, 0, null, {
      ignoreAir: true
    });
    return p && start(name, def, [p]);
  };

  // ---- buried treasure ------------------------------------------------------------------------------------
  const TREASURE_BASE = new Set(['sandstone', 'stone', 'andesite', 'granite', 'diorite']);
  T.buried_treasure = (gen, name, def, cx, cz, r) => {
    const c = centre(gen, cx, cz, true);
    if (!biomeOk(gen, def, c[0], c[1], c[2])) return null;
    const x = cx * 16 + 9,
      z = cz * 16 + 9;
    const p = {
      kind: 'code',
      box: [x - 1, gen.minY, z - 1, x + 1, c[1] + 1, z + 1],
      rigid: false,
      gld: 0,
      junctions: [],
      build: (x0, z0, minY, Hh, blocks, meta, getId, idx, out) => {
        if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) return;
        const name = id => SG.ID_NAME[id] || 'air',
          liquid = n => n === 'water' || n === 'lava';
        let y = minY + Hh - 1;
        while (y > minY && (getId(x, y, z) === 0 || liquid(name(getId(x, y, z))))) y--;
        y++;
        for (; y > minY + 1; y--) {
          const here = getId(x, y, z),
            below = getId(x, y - 1, z);
          if (!TREASURE_BASE.has(name(below))) continue;
          const fill = here && !liquid(name(here)) ? here : SG.PAL.sand;
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
            const nx = x + dx,
              ny = y + dy,
              nz = z + dz;
            if (nx < x0 || nx >= x0 + 16 || nz < z0 || nz >= z0 + 16) continue;
            const n = getId(nx, ny, nz);
            if (n && !liquid(name(n))) continue;
            const nb = getId(nx, ny - 1, nz);
            blocks[idx(nx, ny, nz)] = (!nb || liquid(name(nb))) && dy !== 1 ? below : fill;
          }
          const g = S('chest[facing=north,type=single,waterlogged=false]'),
            k = idx(x, y, z);
          if (SG.SMAP_ID(g) >= 0) {
            blocks[k] = SG.SMAP_ID(g);
            meta[k] = SG.SMAP_META(g);
          }
          out.loot.push([x, y, z, 'loot', 'chests/buried_treasure']);
          return;
        }
      }
    };
    return start(name, def, [p]);
  };

  // ---- ruined portals (simplified RuinedPortalPiece: placement, mossiness, netherrack spread) -----------
  T.ruined_portal = (gen, name, def, cx, cz, r) => {
    // RuinedPortalStructure.findGenerationPoint (its order of random calls)
    const setups = def.setups;
    let setup = setups[0];
    if (setups.length > 1) {
      let tot = 0;
      for (const s of setups) tot += s.weight;
      let f = r.nextFloat();
      for (const s of setups) {
        f -= s.weight / tot;
        if (f < 0) {
          setup = s;
          break;
        }
      }
    }
    const ap = setup.air_pocket_probability,
      airPocket = ap === 0 ? false : ap === 1 ? true : r.nextFloat() < ap;
    const giant = r.nextFloat() < 0.05;
    const tn = giant ? 'ruined_portal/giant_portal_' + (1 + r.nextInt(3)) : 'ruined_portal/portal_' + (1 + r.nextInt(10));
    const tpl = H.TPL[tn];
    if (!tpl) return null;
    const rot = r.nextInt(4),
      mirror = r.nextFloat() < 0.5 ? 0 : 2;
    const sx = tpl.size[0],
      sz = tpl.size[2],
      piv = [sx >> 1, sz >> 1];
    const x0 = cx * 16,
      z0 = cz * 16;
    const a = H.rotPosM(0, 0, 0, rot, mirror, piv[0], piv[1]),
      b = H.rotPosM(sx - 1, 0, sz - 1, rot, mirror, piv[0], piv[1]);
    const bx0 = x0 + Math.min(a[0], b[0]),
      bx1 = x0 + Math.max(a[0], b[0]),
      bz0 = z0 + Math.min(a[2], b[2]),
      bz1 = z0 + Math.max(a[2], b[2]);
    const floor = setup.placement === 'on_ocean_floor',
      ySpan = tpl.size[1];
    const surf = gen.baseHeight(bx0 + (bx1 - bx0 + 1 >> 1), bz0 + (bz1 - bz0 + 1 >> 1), floor) - 1;
    const between = (lo, hi) => r.nextInt(hi - lo + 1) + lo,
      within = (lo, hi) => lo < hi ? between(lo, hi) : hi;
    const minY = gen.minY + 15;
    let y;
    switch (setup.placement) {
      case 'in_nether':
        y = airPocket ? between(32, 100) : r.nextFloat() < 0.5 ? between(27, 29) : between(29, 100);
        break;
      case 'in_mountain':
        y = within(70, surf - ySpan);
        break;
      case 'underground':
        y = within(minY, surf - ySpan);
        break;
      case 'partly_buried':
        y = surf - ySpan + between(2, 8);
        break;
      default:
        y = surf;
    }
    // findSuitableY: down to where 3 of the 4 bottom corners are in the ground (it was the centre's surface, so on a
    // slope or a cliff edge the portal hung in the air)
    const corners = [[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]];
    // (WORLD_SURFACE_WG: not air, so the aquifer's water / lava count but cave air does; OCEAN_FLOOR_WG: solid only)
    const opaque = gen.substanceAt ? (x, yy, z) => {
      const s = gen.substanceAt(x, yy, z);
      return floor ? s === WG.SUB.NONE : s !== WG.SUB.AIR;
    } : (x, yy, z) => gen.densityAt(x, yy, z) > 0 || !floor && yy < gen.sea;
    for (; y > minY; y--) {
      let n = 0;
      for (const [x, z] of corners) if (opaque(x, y, z) && ++n === 3) break;
      if (n === 3) break;
    }
    if (!biomeOk(gen, def, x0, y, z0)) return null;
    const moss = setup.mossiness,
      black = setup.replace_with_blackstone;
    const MOSSY = {
      stone_bricks: 'mossy_stone_bricks',
      stone_brick_stairs: 'mossy_stone_brick_stairs',
      stone_brick_slab: 'mossy_stone_brick_slab',
      stone_brick_wall: 'mossy_stone_brick_wall'
    };
    const BLACK = {
      stone_bricks: 'polished_blackstone_bricks',
      cracked_stone_bricks: 'cracked_polished_blackstone_bricks',
      stone_brick_stairs: 'polished_blackstone_brick_stairs',
      stone_brick_slab: 'polished_blackstone_brick_slab',
      stone_brick_wall: 'polished_blackstone_brick_wall',
      chiseled_stone_bricks: 'chiseled_polished_blackstone',
      stone: 'blackstone',
      cobblestone: 'blackstone',
      mossy_stone_bricks: 'polished_blackstone_bricks'
    };
    const swap = (g, map) => {
      var _H$stateOf;
      const st = D.states[g],
        k = st.indexOf('['),
        n = k < 0 ? st : st.slice(0, k);
      if (!map[n]) return g;
      const i = H.stateOf(map[n] + (k < 0 ? '' : st.slice(k)));
      return i === undefined ? (_H$stateOf = H.stateOf(map[n])) !== null && _H$stateOf !== void 0 ? _H$stateOf : g : i;
    };
    const p = H.tplPiece(tn, [x0, y, z0], rot, mirror, piv, {
      ignoreAir: !airPocket,
      mapState: (g, x, yy, z) => {
        var _H$stateOf2;
        const n = H.NAMES[g];
        if (n === 'gold_block' && H.JR(H.posSeed(x, yy, z)).nextFloat() < 0.3) return AIR();
        // the lava (RuinedPortalPiece.getLavaProcessorRule): all magma on the ocean floor, else a fifth of it. (It
        // stayed lava on the sea floor, in the water: "海里废弃传送门的岩浆碰水不变黑曜石")
        if (n === 'lava' && (setup.placement === 'on_ocean_floor' || H.JR(H.posSeed(x, yy, z)).nextFloat() < 0.2)) return (_H$stateOf2 = H.stateOf('magma_block')) !== null && _H$stateOf2 !== void 0 ? _H$stateOf2 : g;
        if (black) return swap(g, BLACK);
        if (moss > 0 && MOSSY[n] && H.JR(H.posSeed(x, yy, z)).nextFloat() < moss) return swap(g, MOSSY);
        return g;
      }
    });
    // netherrack and magma spread over the ground around the portal
    const spread = {
      kind: 'code',
      box: [p.box[0] - 3, p.box[1] - 2, p.box[2] - 3, p.box[3] + 3, p.box[1] + 2, p.box[5] + 3],
      rigid: false,
      gld: 0,
      junctions: [],
      build: (x0c, z0c, minY, Hh, blocks, meta, getId, idx) => {
        const cxp = (p.box[0] + p.box[3]) / 2,
          czp = (p.box[2] + p.box[5]) / 2,
          rad = Math.max(p.box[3] - p.box[0], p.box[5] - p.box[2]) / 2 + 2;
        for (let x = Math.max(x0c, spread.box[0]); x <= Math.min(x0c + 15, spread.box[3]); x++) for (let z = Math.max(z0c, spread.box[2]); z <= Math.min(z0c + 15, spread.box[5]); z++) {
          const d = Math.hypot(x - cxp, z - czp),
            rr = H.JR(H.posSeed(x, 0, z));
          if (d > rad || rr.nextFloat() > 1 - d / rad * 0.7) continue;
          for (let yy = p.box[1] + 1; yy >= p.box[1] - 2; yy--) {
            const id = getId(x, yy, z),
              up = getId(x, yy + 1, z),
              nm = SG.ID_NAME[id] || 'air';
            if (!id || nm === 'water' || nm === 'lava' || up && SG.ID_NAME[up] !== 'air' && !/grass|fern|flower|snow/.test(SG.ID_NAME[up])) continue;
            blocks[idx(x, yy, z)] = black ? SG.PAL.blackstone : rr.nextFloat() < 0.07 ? SG.PAL.magma_block : SG.PAL.netherrack;
            break;
          }
        }
      }
    };
    return start(name, def, [spread, p]);
  };

  // ---- scattered feature pieces (StructurePiece coordinates: orientation, mirrored/rotated states) ------
  // orientation 0 north, 1 east, 2 south, 3 west (Direction.Plane.HORIZONTAL order)
  function scattered(x, y, z, orient, w, h, d) {
    const zAxis = orient === 0 || orient === 2;
    const box = zAxis ? [x, y, z, x + w - 1, y + h - 1, z + d - 1] : [x, y, z, x + d - 1, y + h - 1, z + w - 1];
    // StructurePiece.setOrientation: south -> mirror left_right, west -> mirror left_right + cw 90, east -> cw 90
    const mirror = orient === 2 || orient === 3 ? 1 : 0,
      rot = orient === 1 || orient === 3 ? 1 : 0;
    return {
      box,
      orient,
      wx: (lx, lz) => orient === 3 ? box[3] - lz : orient === 1 ? box[0] + lz : box[0] + lx,
      wz: (lx, lz) => orient === 0 ? box[5] - lz : orient === 2 ? box[2] + lz : box[2] + lx,
      st: key => {
        let g = S(key);
        if (mirror) g = D.mir[g][0];
        return D.rot[g][rot];
      }
    };
  }
  // a code piece: fill(B) writes in local coordinates through B (clipped to the chunk being generated)
  function codePiece(P, fill) {
    return {
      kind: 'code',
      box: P.box,
      rigid: true,
      gld: 0,
      junctions: [],
      build: (x0, z0, minY, Hh, blocks, meta, getId, idx, out) => {
        if (P.box[3] < x0 || P.box[0] > x0 + 15 || P.box[5] < z0 || P.box[2] > z0 + 15) return;
        const inChunk = (x, y, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16 && y >= minY && y < minY + Hh;
        const cache = new Map(),
          st = k => {
            let g = cache.get(k);
            if (g === undefined) cache.set(k, g = P.st(k));
            return g;
          };
        const B = {
          set(lx, ly, lz, key) {
            const x = P.wx(lx, lz),
              y = P.box[1] + ly,
              z = P.wz(lx, lz);
            if (!inChunk(x, y, z)) return;
            const g = st(key),
              k = idx(x, y, z);
            if (SG.SMAP_ID(g) < 0) return;
            blocks[k] = SG.SMAP_ID(g);
            meta[k] = SG.SMAP_META(g);
          },
          box(ax, ay, az, bx, by, bz, edge, inner) {
            for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) {
              const e = y === ay || y === by || x === ax || x === bx || z === az || z === bz;
              const k = e ? edge : inner === undefined ? edge : inner;
              if (k) B.set(x, y, z, k);
            }
          },
          rnd(lx, ly, lz) {
            return H.JR(H.posSeed(P.wx(lx, lz), P.box[1] + ly, P.wz(lx, lz))).nextFloat();
          },
          get(lx, ly, lz) {
            const x = P.wx(lx, lz),
              y = P.box[1] + ly,
              z = P.wz(lx, lz);
            return inChunk(x, y, z) ? SG.ID_NAME[getId(x, y, z)] || 'air' : null;
          },
          down(lx, ly, lz, key) {
            // fillColumnDown: until a solid block
            const x = P.wx(lx, lz),
              z = P.wz(lx, lz);
            for (let y = P.box[1] + ly; y > minY; y--) {
              if (!inChunk(x, y, z)) return;
              const n = SG.ID_NAME[getId(x, y, z)] || 'air';
              if (n !== 'air' && n !== 'water' && n !== 'lava' && !/grass|fern|flower|vine|leaves|seagrass|kelp|bush/.test(n)) return;
              const g = st(key),
                k = idx(x, y, z);
              if (SG.SMAP_ID(g) < 0) return;
              blocks[k] = SG.SMAP_ID(g);
              meta[k] = SG.SMAP_META(g);
            }
          },
          chest(lx, ly, lz, key, loot) {
            B.set(lx, ly, lz, key);
            const x = P.wx(lx, lz),
              y = P.box[1] + ly,
              z = P.wz(lx, lz);
            if (inChunk(x, y, z)) out.loot.push([x, y, z, 'loot', loot]);
          },
          mob(lx, ly, lz, type) {
            const x = P.wx(lx, lz),
              y = P.box[1] + ly,
              z = P.wz(lx, lz);
            if (inChunk(x, y, z)) out.ent.push([x + 0.5, y, z + 0.5, type, {}]);
          }
        };
        fill(B);
      }
    };
  }
  // average ground height under a footprint (updateAverageGroundHeight, done once for the whole piece)
  const avgGround = (gen, box) => {
    let s = 0,
      n = 0;
    for (let x = box[0]; x <= box[3]; x += 2) for (let z = box[2]; z <= box[5]; z += 2) {
      s += gen.baseHeight(x, z);
      n++;
    }
    return Math.floor(s / n);
  };
  const singlePiece = (gen, def, cx, cz, w, d) => {
    // SinglePieceStructure: needs ground above sea level at the four corners
    const x0 = cx * 16,
      z0 = cz * 16;
    const lo = Math.min(gen.baseHeight(x0, z0), gen.baseHeight(x0 + w, z0), gen.baseHeight(x0, z0 + d), gen.baseHeight(x0 + w, z0 + d)) - 1;
    if (lo < gen.sea) return null;
    const c = centre(gen, cx, cz, false);
    return biomeOk(gen, def, c[0], c[1], c[2]) ? c : null;
  };

  // swamp hut (witch hut)
  T.swamp_hut = (gen, name, def, cx, cz, r) => {
    const c = centre(gen, cx, cz, false);
    if (!biomeOk(gen, def, c[0], c[1], c[2])) return null;
    const P = scattered(cx * 16, 64, cz * 16, r.nextInt(4), 7, 7, 9);
    const dy = avgGround(gen, P.box) - P.box[1];
    P.box[1] += dy;
    P.box[4] += dy;
    const PL = 'spruce_planks',
      LOG = 'oak_log[axis=y]',
      F = 'oak_fence[east=false,north=false,south=false,waterlogged=false,west=false]';
    const stairs = (f, shape = 'straight') => `spruce_stairs[facing=${f},half=bottom,shape=${shape},waterlogged=false]`;
    return start(name, def, [codePiece(P, B => {
      B.box(1, 1, 1, 5, 1, 7, PL);
      B.box(1, 4, 2, 5, 4, 7, PL);
      B.box(2, 1, 0, 4, 1, 0, PL);
      B.box(2, 2, 2, 3, 3, 2, PL);
      B.box(1, 2, 3, 1, 3, 6, PL);
      B.box(5, 2, 3, 5, 3, 6, PL);
      B.box(2, 2, 7, 4, 3, 7, PL);
      B.box(1, 0, 2, 1, 3, 2, LOG);
      B.box(5, 0, 2, 5, 3, 2, LOG);
      B.box(1, 0, 7, 1, 3, 7, LOG);
      B.box(5, 0, 7, 5, 3, 7, LOG);
      B.set(2, 3, 2, F);
      B.set(3, 3, 7, F);
      B.set(1, 3, 4, 'air');
      B.set(5, 3, 4, 'air');
      B.set(5, 3, 5, 'air');
      B.set(1, 3, 5, 'potted_red_mushroom');
      B.set(3, 2, 6, 'crafting_table');
      B.set(4, 2, 6, 'cauldron');
      B.set(1, 2, 1, F);
      B.set(5, 2, 1, F);
      B.box(0, 4, 1, 6, 4, 1, stairs('north'));
      B.box(0, 4, 2, 0, 4, 7, stairs('east'));
      B.box(6, 4, 2, 6, 4, 7, stairs('west'));
      B.box(0, 4, 8, 6, 4, 8, stairs('south'));
      B.set(0, 4, 1, stairs('north', 'outer_right'));
      B.set(6, 4, 1, stairs('north', 'outer_left'));
      B.set(0, 4, 8, stairs('south', 'outer_left'));
      B.set(6, 4, 8, stairs('south', 'outer_right'));
      for (const z of [2, 7]) for (const x of [1, 5]) B.down(x, -1, z, LOG);
      B.mob(2, 2, 5, 'cat');
    })]);
  };

  // desert pyramid (layout after the vanilla temple: stepped sandstone pyramid, two towers with orange
  // terracotta, the blue terracotta star over the hidden treasure room with four chests and a TNT trap)
  T.desert_pyramid = (gen, name, def, cx, cz, r) => {
    if (!singlePiece(gen, def, cx, cz, 21, 21)) return null;
    const P = scattered(cx * 16, 64, cz * 16, r.nextInt(4), 21, 15, 21);
    const dy = avgGround(gen, P.box) - P.box[1] - r.nextInt(3);
    P.box[1] += dy;
    P.box[4] += dy;
    const SS = 'sandstone',
      CUT = 'cut_sandstone',
      CH = 'chiseled_sandstone',
      OT = 'orange_terracotta',
      BT = 'blue_terracotta';
    const st = (f, half = 'bottom') => `sandstone_stairs[facing=${f},half=${half},shape=straight,waterlogged=false]`;
    const SLAB = 'sandstone_slab[type=bottom,waterlogged=false]';
    const chest = f => `chest[facing=${f},type=single,waterlogged=false]`;
    return start(name, def, [codePiece(P, B => {
      B.box(0, -4, 0, 20, 0, 20, SS);
      for (let i = 1; i <= 9; i++) {
        B.box(i, i, i, 20 - i, i, 20 - i, SS);
        B.box(i + 1, i, i + 1, 19 - i, i, 19 - i, 'air');
      }
      for (let x = 0; x <= 20; x++) for (let z = 0; z <= 20; z++) B.down(x, -5, z, SS);
      // the two front towers
      for (const tx of [0, 16]) {
        B.box(tx, 0, 0, tx + 4, 9, 4, SS, 'air');
        B.box(tx + 1, 10, 1, tx + 3, 10, 3, CUT);
        B.set(tx + 2, 10, 0, st('north'));
        B.set(tx + 2, 10, 4, st('south'));
        B.set(tx, 10, 2, st('east'));
        B.set(tx + 4, 10, 2, st('west'));
        for (const yy of [5, 6, 7]) {
          B.set(tx + 2, yy, 0, OT);
          B.set(tx + 1, yy, 0, yy === 6 ? OT : CUT);
          B.set(tx + 3, yy, 0, yy === 6 ? OT : CUT);
        }
        B.set(tx + 2, 8, 0, CH);
        B.set(tx + 2, 4, 0, CH);
        B.box(tx + 1, 1, 1, tx + 3, 9, 3, 'air');
      }
      // entrance and the corridor to the hall
      B.box(8, 0, 0, 12, 4, 4, SS, 'air');
      B.box(9, 1, 0, 11, 3, 4, 'air');
      B.set(10, 5, 0, CH);
      B.set(9, 4, 0, CUT);
      B.set(11, 4, 0, CUT);
      B.set(10, 4, 0, CUT);
      B.box(8, 5, 0, 12, 5, 0, CUT);
      B.set(10, 6, 0, st('north'));
      // inner hall with pillars
      B.box(5, 1, 5, 15, 4, 15, 'air');
      for (const [px, pz] of [[5, 5], [15, 5], [5, 15], [15, 15], [9, 9], [11, 9], [9, 11], [11, 11]]) B.box(px, 1, pz, px, 3, pz, CUT);
      // orange terracotta star and blue centre over the treasure room
      B.box(8, 0, 8, 12, 0, 12, OT);
      B.box(9, 0, 9, 11, 0, 11, SS);
      B.set(10, 0, 10, BT);
      for (const [a, b] of [[10, 7], [10, 13], [7, 10], [13, 10]]) B.set(a, 0, b, OT);
      // hidden treasure room: shaft, four chests in alcoves, TNT under a pressure plate
      B.box(8, -14, 8, 12, -9, 12, SS, 'air');
      B.box(9, -13, 9, 11, -10, 11, 'air');
      B.box(10, -9, 10, 10, -1, 10, 'air');
      for (const [ax, az, f] of [[10, 8, 'south'], [10, 12, 'north'], [8, 10, 'east'], [12, 10, 'west']]) {
        B.set(ax, -12, az, CUT);
        B.chest(ax, -13, az, chest(f), 'chests/desert_pyramid');
      }
      B.box(9, -14, 9, 11, -14, 11, 'tnt[unstable=false]');
      B.set(10, -13, 10, 'stone_pressure_plate[powered=false]');
      for (const [a, b] of [[9, 9], [11, 9], [9, 11], [11, 11]]) B.set(a, -11, b, CH);
      // sloped outer edges
      for (let i = 1; i <= 9; i++) {
        B.set(i, i, 10, st('east'));
        B.set(20 - i, i, 10, st('west'));
        B.set(10, i, 20 - i, st('north'));
      }
      B.set(10, 10, 10, SLAB);
    })]);
  };

  // jungle temple (mossy cobblestone temple with the lever puzzle, arrow traps and two chests)
  T.jungle_temple = (gen, name, def, cx, cz, r) => {
    if (!singlePiece(gen, def, cx, cz, 12, 15)) return null;
    const P = scattered(cx * 16, 64, cz * 16, r.nextInt(4), 12, 10, 15);
    const dy = avgGround(gen, P.box) - P.box[1];
    P.box[1] += dy;
    P.box[4] += dy;
    // JungleTemplePiece.postProcess: its boxes are filled solid (cobblestone 40% / mossy cobblestone), then carved;
    // the lower floor has the two tripwire arrow traps and the three-lever puzzle with sticky pistons hiding a chest
    const CO = 'cobblestone',
      MO = 'mossy_cobblestone',
      CH = 'chiseled_stone_bricks';
    const cs = f => `cobblestone_stairs[facing=${f},half=bottom,shape=straight,waterlogged=false]`;
    const WIRE_NS = 'redstone_wire[east=none,north=side,power=0,south=side,west=none]',
      WIRE_EW = 'redstone_wire[east=side,north=none,power=0,south=none,west=side]';
    const TRIP_EW = 'tripwire[attached=true,disarmed=false,east=true,north=false,powered=false,south=false,west=true]';
    const TRIP_NS = 'tripwire[attached=true,disarmed=false,east=false,north=true,powered=false,south=true,west=false]';
    const LEVER = 'lever[face=wall,facing=north,powered=false]';
    return start(name, def, [codePiece(P, B => {
      const fill = (ax, ay, az, bx, by, bz) => {
        for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) B.set(x, y, z, B.rnd(x, y, z) < 0.4 ? CO : MO);
      };
      const air = (ax, ay, az, bx, by, bz) => B.box(ax, ay, az, bx, by, bz, 'air');
      fill(0, -4, 0, 11, 0, 14);
      fill(2, 1, 2, 9, 2, 2);
      fill(2, 1, 12, 9, 2, 12);
      fill(2, 1, 3, 2, 2, 11);
      fill(9, 1, 3, 9, 2, 11);
      fill(1, 3, 1, 10, 6, 1);
      fill(1, 3, 13, 10, 6, 13);
      fill(1, 3, 2, 1, 6, 12);
      fill(10, 3, 2, 10, 6, 12);
      fill(2, 3, 2, 9, 3, 12);
      fill(2, 6, 2, 9, 6, 12);
      fill(3, 7, 3, 8, 7, 11);
      fill(4, 8, 4, 7, 8, 10);
      air(3, 1, 3, 8, 2, 11);
      air(4, 3, 6, 7, 3, 9);
      air(2, 4, 2, 9, 5, 12);
      air(4, 6, 5, 7, 6, 9);
      air(5, 7, 6, 6, 7, 8);
      air(5, 1, 2, 6, 2, 2);
      air(5, 2, 12, 6, 2, 12);
      air(5, 5, 1, 6, 5, 1);
      air(5, 5, 13, 6, 5, 13);
      for (const [x, z] of [[1, 5], [10, 5], [1, 9], [10, 9]]) B.set(x, 5, z, 'air');
      for (const z of [0, 14]) for (const x of [2, 4, 7, 9]) fill(x, 4, z, x, 5, z);
      fill(5, 6, 0, 6, 6, 0);
      for (const x of [0, 11]) {
        for (let z = 2; z <= 12; z += 2) fill(x, 4, z, x, 5, z);
        fill(x, 6, 5, x, 6, 5);
        fill(x, 6, 9, x, 6, 9);
      }
      fill(2, 7, 2, 2, 9, 2);
      fill(9, 7, 2, 9, 9, 2);
      fill(2, 7, 12, 2, 9, 12);
      fill(9, 7, 12, 9, 9, 12);
      fill(4, 9, 4, 4, 9, 4);
      fill(7, 9, 4, 7, 9, 4);
      fill(4, 9, 10, 4, 9, 10);
      fill(7, 9, 10, 7, 9, 10);
      fill(5, 9, 7, 6, 9, 7);
      for (const [x, y, z, f] of [[5, 9, 6, 'north'], [6, 9, 6, 'north'], [5, 9, 8, 'south'], [6, 9, 8, 'south'], [4, 0, 0, 'north'], [5, 0, 0, 'north'], [6, 0, 0, 'north'], [7, 0, 0, 'north'], [4, 1, 8, 'north'], [4, 2, 9, 'north'], [4, 3, 10, 'north'], [7, 1, 8, 'north'], [7, 2, 9, 'north'], [7, 3, 10, 'north']]) B.set(x, y, z, cs(f));
      fill(4, 1, 9, 4, 1, 9);
      fill(7, 1, 9, 7, 1, 9);
      fill(4, 1, 10, 7, 2, 10);
      fill(5, 4, 5, 6, 4, 5);
      B.set(4, 4, 5, cs('east'));
      B.set(7, 4, 5, cs('west'));
      for (let i = 0; i < 4; i++) {
        B.set(5, -i, 6 + i, cs('south'));
        B.set(6, -i, 6 + i, cs('south'));
        air(5, -i, 7 + i, 6, -i, 9 + i);
      }
      // lower floor
      air(1, -3, 12, 10, -1, 13);
      air(1, -3, 1, 3, -1, 13);
      air(1, -3, 1, 9, -1, 5);
      for (let z = 1; z <= 13; z += 2) fill(1, -3, z, 1, -2, z);
      for (let z = 2; z <= 12; z += 2) fill(1, -1, z, 3, -1, z);
      fill(2, -2, 1, 5, -2, 1);
      fill(7, -2, 1, 9, -2, 1);
      fill(6, -3, 1, 6, -3, 1);
      fill(6, -1, 1, 6, -1, 1);
      // trap 1: tripwire across the west corridor, wire to the dispenser above the north wall
      B.set(1, -3, 8, 'tripwire_hook[attached=true,facing=east,powered=false]');
      B.set(4, -3, 8, 'tripwire_hook[attached=true,facing=west,powered=false]');
      B.set(2, -3, 8, TRIP_EW);
      B.set(3, -3, 8, TRIP_EW);
      for (let z = 2; z <= 7; z++) B.set(5, -3, z, WIRE_NS);
      B.set(5, -3, 1, 'redstone_wire[east=none,north=side,power=0,south=none,west=side]');
      B.set(4, -3, 1, WIRE_EW);
      B.set(3, -3, 1, MO);
      B.chest(3, -2, 1, 'dispenser[facing=north,triggered=false]', 'chests/jungle_temple_dispenser');
      B.set(3, -2, 2, 'vine[east=false,north=false,south=true,up=false,west=false]');
      // trap 2: tripwire in front of the main chest, wire to the dispenser on the east
      B.set(7, -3, 1, 'tripwire_hook[attached=true,facing=north,powered=false]');
      B.set(7, -3, 5, 'tripwire_hook[attached=true,facing=south,powered=false]');
      for (let z = 2; z <= 4; z++) B.set(7, -3, z, TRIP_NS);
      B.set(8, -3, 6, WIRE_EW);
      B.set(9, -3, 6, 'redstone_wire[east=none,north=none,power=0,south=side,west=side]');
      B.set(9, -3, 5, 'redstone_wire[east=none,north=side,power=0,south=up,west=none]');
      B.set(9, -3, 4, MO);
      B.set(9, -2, 4, WIRE_NS);
      B.chest(9, -2, 3, 'dispenser[facing=west,triggered=false]', 'chests/jungle_temple_dispenser');
      B.set(8, -1, 3, 'vine[east=true,north=false,south=false,up=false,west=false]');
      B.set(8, -2, 3, 'vine[east=true,north=false,south=false,up=false,west=false]');
      B.chest(8, -3, 3, 'chest[facing=north,type=single,waterlogged=false]', 'chests/jungle_temple');
      for (const [x, y, z] of [[9, -3, 2], [8, -3, 1], [4, -3, 5], [5, -2, 5], [5, -1, 5], [6, -3, 5], [7, -2, 5], [7, -1, 5], [8, -3, 5]]) B.set(x, y, z, MO);
      fill(9, -1, 1, 9, -1, 5);
      // the lever puzzle: three levers on the chiseled wall, sticky pistons opening the hidden chest's room
      air(8, -3, 8, 10, -1, 10);
      for (const x of [8, 9, 10]) {
        B.set(x, -2, 11, CH);
        B.set(x, -2, 12, LEVER);
      }
      fill(8, -3, 8, 8, -3, 10);
      fill(10, -3, 8, 10, -3, 10);
      B.set(10, -2, 9, MO);
      B.set(8, -2, 9, WIRE_NS);
      B.set(8, -2, 10, WIRE_NS);
      B.set(10, -1, 9, 'redstone_wire[east=side,north=side,power=0,south=side,west=side]');
      B.set(9, -2, 8, 'sticky_piston[extended=false,facing=up]');
      B.set(10, -2, 8, 'sticky_piston[extended=false,facing=west]');
      B.set(10, -1, 8, 'sticky_piston[extended=false,facing=west]');
      B.set(10, -2, 10, 'repeater[delay=1,facing=north,locked=false,powered=false]');
      B.chest(9, -3, 10, 'chest[facing=south,type=single,waterlogged=false]', 'chests/jungle_temple');
    })]);
  };

  // ---- mineshafts (MineshaftPieces: a room, corridors with supports / rails / cobwebs, crossings, stairs) ----
  T.mineshaft = (gen, name, def, cx, cz, r) => {
    const mesa = def.mineshaft_type === 'mesa';
    const x0 = cx * 16 + 2,
      z0 = cz * 16 + 2;
    if (!biomeOk(gen, def, cx * 16 + 8, 50, cz * 16 + 8)) return null;
    const PL = mesa ? 'dark_oak_planks' : 'oak_planks';
    const FE = (mesa ? 'dark_oak_fence' : 'oak_fence') + '[east=false,north=false,south=false,waterlogged=false,west=false]';
    const ops = [],
      boxes = [],
      carts = [];
    const free = b => !boxes.some(o => b[0] <= o[3] && b[3] >= o[0] && b[1] <= o[4] && b[4] >= o[1] && b[2] <= o[5] && b[5] >= o[2]);
    const D4 = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // north east south west
    const fill = (b, key, mode) => ops.push([b[0], b[1], b[2], b[3], b[4], b[5], key, mode || 0]);
    const room = [x0, 50, z0, x0 + 7 + r.nextInt(6), 54 + r.nextInt(6), z0 + 7 + r.nextInt(6)];
    boxes.push(room);
    fill([room[0], room[1], room[2], room[3], room[1], room[5]], 'dirt', 1);
    fill([room[0], room[1] + 1, room[2], room[3], room[4], room[5]], 'air');
    const queue = [];
    // exits along the room walls
    for (let side = 0; side < 4; side++) {
      const len = side % 2 === 0 ? room[3] - room[0] : room[5] - room[2];
      for (let k = r.nextInt(4); k + 3 <= len; k += 4 + r.nextInt(len)) {
        const sx = side === 0 || side === 2 ? room[0] + k : side === 1 ? room[3] + 1 : room[0] - 1;
        const sz = side === 1 || side === 3 ? room[2] + k : side === 2 ? room[5] + 1 : room[2] - 1;
        queue.push([sx, room[1] + 1, sz, side, 1]);
      }
    }
    let pieces = 0;
    while (queue.length && pieces < 64) {
      const [sx, sy, sz, dir, depth] = queue.shift();
      if (depth > 8 || Math.abs(sx - x0) > 80 || Math.abs(sz - z0) > 80) continue;
      const [dx, dz] = D4[dir],
        px = -dz,
        pz = dx; // forward and the perpendicular (right)
      const t = r.nextInt(100);
      const at = (f, s) => [sx + dx * f + px * s, sz + dz * f + pz * s];
      const bx = (f0, f1, s0, s1, y0, y1) => {
        const a = at(f0, s0),
          b = at(f1, s1);
        return [Math.min(a[0], b[0]), y0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), y1, Math.max(a[1], b[1])];
      };
      if (t >= 80) {
        // crossing
        const tall = r.nextInt(4) === 0,
          h = tall ? 6 : 2;
        const b = bx(0, 4, -1, 3, sy, sy + h);
        if (!free(b)) continue;
        boxes.push(b);
        pieces++;
        fill(bx(1, 3, -1, 3, sy, sy + h), 'air');
        fill(bx(0, 4, 0, 2, sy, sy + h), 'air');
        fill(bx(1, 3, -1, 3, sy - 1, sy - 1), PL, 3);
        fill(bx(0, 4, 0, 2, sy - 1, sy - 1), PL, 3);
        for (const [f, s] of [[1, 0], [3, 0], [1, 2], [3, 2]]) fill(bx(f, f, s, s, sy, sy + h), PL);
        queue.push([at(5, 0)[0], sy, at(5, 0)[1], dir, depth + 1]);
        queue.push([at(2, -2)[0], sy, at(2, -2)[1], dir + 3 & 3, depth + 1]);
        queue.push([at(2, 4)[0], sy, at(2, 4)[1], dir + 1 & 3, depth + 1]);
      } else if (t >= 70) {
        // stairs going down
        const b = bx(0, 8, 0, 2, sy - 5, sy + 2);
        if (!free(b)) continue;
        boxes.push(b);
        pieces++;
        fill(bx(0, 1, 0, 2, sy, sy + 2), 'air');
        fill(bx(7, 8, 0, 2, sy - 5, sy - 3), 'air');
        for (let i = 0; i < 5; i++) {
          fill(bx(2 + i, 2 + i, 0, 2, sy - i - 1, sy + 2 - i), 'air');
          fill(bx(2 + i, 2 + i, 0, 2, sy - i - 2, sy - i - 2), PL, 3);
        }
        queue.push([at(9, 0)[0], sy - 5, at(9, 0)[1], dir, depth + 1]);
      } else {
        // corridor: sections of five blocks with supports
        const n = 2 + r.nextInt(3),
          L = n * 5;
        const b = bx(0, L - 1, 0, 2, sy, sy + 2);
        if (!free(b)) continue;
        boxes.push(b);
        pieces++;
        const rails = r.nextInt(3) === 0,
          spider = !rails && r.nextInt(23) === 0;
        fill(b, 'air');
        fill(bx(0, L - 1, 0, 2, sy - 1, sy - 1), PL, 3);
        for (let i = 0; i < n; i++) {
          const f = 2 + i * 5;
          fill(bx(f, f, 0, 0, sy, sy + 1), FE);
          fill(bx(f, f, 2, 2, sy, sy + 1), FE);
          fill(bx(f, f, 0, 2, sy + 2, sy + 2), PL);
        }
        fill(b, 'cobweb', spider ? 5 : 4);
        // MineShaftCorridor.createChest: beside each support, 1 in 100 a chest minecart (decided per block in build)
        for (let i = 0; i < n; i++) {
          const f = 2 + i * 5;
          carts.push([...at(f - 1, 2), sy], [...at(f + 1, 0), sy]);
        }
        if (rails) fill(bx(0, L - 1, 1, 1, sy, sy), dir % 2 === 0 ? 'rail[shape=north_south,waterlogged=false]' : 'rail[shape=east_west,waterlogged=false]', 6);
        if (spider) fill(bx(L >> 1, L >> 1, 1, 1, sy, sy), 'spawner');
        const nx = at(L, 0),
          turn = r.nextInt(4);
        if (turn === 0) queue.push([at(L - 2, -1)[0], sy, at(L - 2, -1)[1], dir + 3 & 3, depth + 1]);else if (turn === 1) queue.push([at(L - 2, 3)[0], sy, at(L - 2, 3)[1], dir + 1 & 3, depth + 1]);else queue.push([nx[0], sy, nx[1], dir, depth + 1]);
      }
    }
    // MineshaftStructure: sink the whole thing below sea level
    const top = Math.max(...boxes.map(b => b[4])),
      span = top - Math.min(...boxes.map(b => b[1])) + 1;
    const lim = gen.sea - 10;
    let j = span + gen.minY + 1;
    if (j < lim) j += r.nextInt(lim - j);
    const dy = j - top;
    for (const o of ops) {
      o[1] += dy;
      o[4] += dy;
    }
    for (const b of boxes) {
      b[1] += dy;
      b[4] += dy;
    }
    for (const c of carts) c[2] += dy;
    const all = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])], boxes[0].slice());
    const piece = {
      kind: 'code',
      box: all,
      rigid: false,
      gld: 0,
      junctions: [],
      build: (cx0, cz0, minY, Hh, blocks, meta, getId, idx, out) => {
        const liquid = id => {
          const n = SG.ID_NAME[id];
          return n === 'water' || n === 'lava';
        };
        for (const o of ops) {
          const g = S(o[6]),
            id = SG.SMAP_ID(g),
            m = SG.SMAP_META(g);
          if (id < 0) continue;
          for (let x = Math.max(o[0], cx0); x <= Math.min(o[3], cx0 + 15); x++) for (let z = Math.max(o[2], cz0); z <= Math.min(o[5], cz0 + 15); z++) for (let y = Math.max(o[1], minY + 1); y <= Math.min(o[4], minY + Hh - 1); y++) {
            const k = idx(x, y, z),
              cur = blocks[k];
            if (liquid(cur)) continue;
            const mode = o[7];
            if (mode === 1 && !cur) continue; // dirt floor only on solid ground
            if (mode === 2 && cur === 0) continue; // room ceiling: only carve
            if (mode === 3 && cur && !liquid(cur)) continue; // floor planks only to bridge gaps
            if (mode === 4 && (y !== o[4] || H.JR(H.posSeed(x, y, z)).nextFloat() > 0.08)) continue; // a few cobwebs under the ceiling
            if (mode === 5 && H.JR(H.posSeed(x, y, z)).nextFloat() > 0.6) continue; // a cave-spider nest
            if ((mode === 4 || mode === 5) && cur) continue;
            if (mode === 6 && (H.JR(H.posSeed(x, y, z)).nextFloat() > 0.7 || !blocks[idx(x, y - 1, z)])) continue;
            blocks[k] = id;
            meta[k] = m;
            if (o[6] === 'spawner' && out) out.loot.push([x, y, z, 'spawner', 'cave_spider']); // (structures.js structureExtras)
          }
        }
        // chest minecarts: on air with something below, on a rail of a random shape (abandoned_mineshaft loot)
        if (out) for (const [x, z, y] of carts) {
          if (x < cx0 || x > cx0 + 15 || z < cz0 || z > cz0 + 15 || y <= minY || y >= minY + Hh - 1) continue;
          const rr = H.JR(H.posSeed(x, y, z));
          rr.nextFloat();
          if (rr.nextInt(100) !== 0 || blocks[idx(x, y, z)] || !blocks[idx(x, y - 1, z)]) continue;
          const g = S(rr.nextBoolean() ? 'rail[shape=north_south,waterlogged=false]' : 'rail[shape=east_west,waterlogged=false]');
          if (SG.SMAP_ID(g) < 0) continue;
          blocks[idx(x, y, z)] = SG.SMAP_ID(g);
          meta[idx(x, y, z)] = SG.SMAP_META(g);
          out.ent.push([x + 0.5, y + 0.0625, z + 0.5, 'minecart:chest', {
            loot: 'chests/abandoned_mineshaft'
          }]);
        }
      }
    };
    return start(name, def, [piece]);
  };
  SG.SMAP_ID = g => SG.smap[g * 2];
  SG.SMAP_META = g => SG.smap[g * 2 + 1];
})();
;try{window.__SRCS=window.__SRCS||{};window.__SRCS["js/structtypes.js"]=document.currentScript.textContent;}catch(e){}
