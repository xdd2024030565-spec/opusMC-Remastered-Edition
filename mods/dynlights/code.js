'use strict';

// 移动光源 (dynamic lights; our own, no one else's code or art): things that give light light up what is around them as
// they move, with and without 光影, and the light spreads the way a placed one does - one level a block, around corners,
// not through walls:
//   - a light-giving item held in either hand or worn on the head, by you, a mob or an armour stand (a torch 14, a
//     lantern / glowstone / lava bucket / jack o'lantern 15 ...: the light of the block it places, and a few items of
//     their own - blaze rods, glow berries, glowstone dust ...), the same lying on the ground or in an item frame
//   - anything burning (15), blazes, magma cubes, glow squids (not while dark), fireballs, dragon fireballs, spectral
//     arrows, eyes of ender, fireworks in flight, falling light blocks, a furnace minecart with fuel
//   - lit TNT (and a lit TNT minecart) and a swelling creeper: 关 / 简单 / 精致 (精致: TNT flashes, a creeper brightens
//     as it swells)
// Torches, campfires, lava buckets and the like go out under water. 视频设置 → 移动光源… : 关 / 流畅 / 平衡 / 精致
// (how often moving lights are redrawn: twice a second, four times, every frame), your own light, the others', under
// water, TNT, creepers. It is not in the world's light: mobs still spawn, crops don't grow by it. Single player only,
// as every mod (in a room: none).
//
// How: a 128 x 64 x 128 volume of block light around the player (vol, R8 3D texture on unit 15) holds the lights'
// levels. Each light has a BFS from its block, by the world's own rule (World.propagate: a step costs max(1, opacity),
// opacity 15 stops it), redone when it enters another block, when a block near it changes and every 2 s; a cell
// gets L + 0.5 - (the exact |dx|+|dy|+|dz| from the light to the cell's centre) - (the detour the BFS found), at most L,
// so a light moving inside its block moves smoothly and is about as bright as one placed in that block. Opaque blocks beside lit cells get the level of that cell - 1 (what a face
// of theirs shows). The terrain's fragment shaders (render.js CHUNK_FS and the 光影 pack's FXCHUNK_FS: both read
// v_light, .y the block light) take the cell in front of each face (the face's normal from the derivatives, half a
// block out), interpolated, and raise the block light to it - nothing is meshed again; particles too (the same
// program). Mobs, held and dropped items (Entity.lightAt) and chests / signs / campfire food / pets ... (World.getLight
// while the world is drawn) read the same volume.
(function () {
  const DEF = {
    mode: 3,
    self: true,
    ents: true,
    water: true,
    tnt: 2,
    creeper: 2
  };
  const cfg = g => {
    const s = g.settings || (g.settings = {});
    let c = s.dynLights;
    if (!c || typeof c !== 'object') c = s.dynLights = {};
    for (const k in DEF) if (c[k] === undefined) c[k] = DEF[k];
    return c;
  };
  const INTERVAL = [0, 500, 250, 0]; // ms between redraws of a moving light: 关, 流畅, 平衡, 精致 (every frame)
  const MAXL = 32; // the nearest this many lights
  let broken = false,
    fails = 0;
  const fail = (where, e) => {
    if (fails++ < 3) {
      console.warn('[移动光源]', where, e);
      try {
        if (typeof Telemetry !== 'undefined') Telemetry.event('dynlights_err', {
          where,
          msg: String(e && e.message || e).slice(0, 160)
        });
      } catch (x) {}
    }
    if (where !== 'compile') broken = true;
  };

  // ---- the volume ----
  const SX = 128,
    SY = 64,
    SZ = 128,
    SXZ = SX * SZ,
    UNIT = 15;
  const vol = new Uint8Array(SXZ * SY); // level * 17, at x + z * SX + y * SXZ (the texture: width x, height z, depth y)
  let ox = 0,
    oy = 0,
    oz = 0,
    placed = false;

  // ---- shaders ----
  const MARK = 'v_light = u_lightOv.z > 0.5 ? u_lightOv.xy : a_light;';
  const VDECL = '\nuniform vec3 u_dynO; out vec4 v_dynP; out vec3 v_dynV;\nvoid main(){';
  const VADD = ' v_dynP = vec4(wp.xyz - u_dynO, u_lightOv.z > 0.5 ? 0.0 : 1.0); v_dynV = u_cam - wp.xyz;';
  const F = n => n.toFixed(1);
  const FDECL = `
uniform mediump sampler3D u_dynVol; uniform float u_dynOn; in vec4 v_dynP; in vec3 v_dynV;
vec2 dynL;
void dynInit(){
  dynL = v_light;
  vec3 p = v_dynP.xyz, n = cross(dFdx(p), dFdy(p));
  if (u_dynOn > 0.5 && v_dynP.w > 0.5) {
    float ln = length(n);
    n = ln > 1e-10 ? n / ln : vec3(0.0, 1.0, 0.0);
    if (dot(n, v_dynV) < 0.0) n = -n;
    vec3 q = p + n * 0.5;
    if (all(greaterThan(q, vec3(0.5))) && all(lessThan(q, vec3(${F(SX - 0.5)}, ${F(SY - 0.5)}, ${F(SZ - 0.5)}))))
      dynL.y = max(dynL.y, textureLod(u_dynVol, q.xzy / vec3(${F(SX)}, ${F(SZ)}, ${F(SY)}), 0.0).r);
  }
}
#define v_light dynL
`;
  const progs = [];
  // (the program that was in use may have been deleted meanwhile - the start-up's one-off programs: using it again is
  // an INVALID_OPERATION)
  const restore = (gl, p) => gl.useProgram(p && gl.isProgram(p) ? p : null);
  if (typeof compile === 'function') {
    const comp = compile;
    compile = function (gl, vs, fs) {
      const okV = !broken && typeof vs === 'string' && vs.includes(MARK) && vs.includes('\nvoid main(){') && vs.includes('uniform vec3 u_cam') && /vec4 wp\b/.test(vs);
      if (!okV) return comp(gl, vs, fs);
      const okF = typeof fs === 'string' && fs.includes('in vec2 v_light;') && fs.split('void main(){').length === 2;
      const vs2 = vs.replace('\nvoid main(){', VDECL).replace(MARK, MARK + VADD);
      const fs2 = okF ? fs.replace('in vec2 v_light;', 'in vec2 v_light;' + FDECL).replace('void main(){', 'void main(){ dynInit();') : fs;
      let P;
      try {
        P = comp(gl, vs2, fs2);
      } catch (e) {
        fail('compile', e);
        return comp(gl, vs, fs);
      }
      if (okF && P && P.u && P.u.u_dynVol && P.u.u_dynOn) {
        const cur = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(P.p);
        gl.uniform1i(P.u.u_dynVol, UNIT);
        restore(gl, cur); // (on 0 it would clash with the tiles)
        progs.push({
          gl,
          P,
          on: 0,
          o: null
        });
      }
      return P;
    };
  }

  // ---- what gives light ----
  const EXTRA = {
    blaze_rod: 10,
    blaze_powder: 8,
    glowstone_dust: 8,
    glow_berries: 14,
    glow_ink_sac: 8,
    magma_cream: 8,
    nether_star: 14,
    fire_charge: 12,
    spectral_arrow: 6,
    ender_eye: 6,
    prismarine_crystals: 6,
    amethyst_shard: 4,
    sea_pickle: 6
  };
  const WET = /^(torch|soul_torch|copper_torch|campfire|soul_campfire|fire_charge|blaze_powder|lava_bucket)$/;
  const MOB = {
    blaze: 10,
    magma_cube: 8
  };
  const itemLum = new Map();
  const blockLum = (b, meta) => {
    if (!b) return 0;
    if (!b.stateLight) return b.light || 0;
    if (meta !== undefined) return b.stateLight[meta] | 0;
    // an item: the block as it is placed (its default state) - a campfire and a redstone torch lit, the light block 15;
    // candles, furnaces, lamps, bulbs, redstone ore unlit
    return /campfire$|^redstone_(wall_)?torch$|^light$/.test(b.key || '') ? Math.max(0, ...b.stateLight) : 0;
  };
  const lumOf = st => {
    if (!st || st.id === undefined || st.id === null) return 0;
    let v = itemLum.get(st.id);
    if (v === undefined) {
      const d = ITEMS[st.id];
      v = 0;
      if (d) {
        let b = d.block !== undefined ? BLOCKS[d.block] : null;
        if (!b && d.places && typeof BID !== 'undefined' && BID[d.places] !== undefined) b = BLOCKS[BID[d.places]];
        v = Math.max(blockLum(b), EXTRA[d.key] || 0);
        if (v && WET.test(d.key)) v = -v; // goes out under water
      }
      itemLum.set(st.id, v);
    }
    return v;
  };
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const lumOfEntity = (g, e, S, a) => {
    const me = e === g.player;
    if (me ? !S.self || g.mode === 'spectator' : !S.ents) return 0;
    const isLiving = typeof Living === 'function' && e instanceof Living;
    let wet = false;
    if (S.water) {
      if (me) wet = !!(g.headInWater || e.eyeInWater);else if (isLiving) wet = !!e.eyeInWater;else if (e.inWater) wet = true;else if (g.world && e.pos) {
        const x = Math.floor(e.pos[0]),
          y = Math.floor(e.pos[1] + (e.h || 0) * 0.5),
          z = Math.floor(e.pos[2]),
          id = g.world.getBlock(x, y, z);
        wet = id === WATER || !!WLOG[id] && g.world.isWaterlogged(x, y, z);
      }
    }
    const st = s => {
      const v = lumOf(s);
      return v < 0 ? wet ? 0 : -v : v;
    };
    let v = 0;
    if (e.fire > 0 && !e.fireproof && !e.inWater) v = 15;
    if (e.type && MOB[e.type]) v = Math.max(v, MOB[e.type]);
    if (e.type === 'glow_squid') v = Math.max(v, 8 * clamp01(1 - (e.darkT || 0) / 20));
    if (e.type === 'creeper' && e.fuse >= 0 && S.creeper) {
      const f = (e.prevFuse >= 0 ? e.prevFuse + (e.fuse - e.prevFuse) * a : e.fuse) / 30;
      v = Math.max(v, S.creeper === 1 ? 10 : 2 + 13 * clamp01(f));
    }
    const tnt = fuse => S.tnt === 1 ? 10 : Math.floor(fuse / 5) % 2 === 0 ? 15 : 10; // (精致: with its white flashes)
    if (S.tnt) {
      if (typeof PrimedTNT === 'function' && e instanceof PrimedTNT) v = Math.max(v, tnt(e.fuse));
      if (typeof Minecart === 'function' && e instanceof Minecart && e.kind === 'tnt' && e.primed !== undefined) v = Math.max(v, tnt(e.primed));
    }
    if (typeof Minecart === 'function' && e instanceof Minecart && e.kind === 'furnace' && e.fuel > 0) v = Math.max(v, 13);
    if (typeof Fireball === 'function' && e instanceof Fireball) v = Math.max(v, e.small ? 12 : 14);
    if (typeof DragonFireball === 'function' && e instanceof DragonFireball) v = Math.max(v, 12);
    if (typeof EyeOfEnder === 'function' && e instanceof EyeOfEnder) v = Math.max(v, 8);
    if (typeof FireworkRocket === 'function' && e instanceof FireworkRocket) v = Math.max(v, 10);
    if (typeof FallingBlock === 'function' && e instanceof FallingBlock) v = Math.max(v, blockLum(BLOCKS[e.blockId], e.meta | 0));
    if (typeof Arrow === 'function' && e instanceof Arrow) {
      if (e.tip && ITEMS[e.tip.id] && ITEMS[e.tip.id].key === 'spectral_arrow') v = Math.max(v, 8);
      if (e.snowball !== undefined) v = Math.max(v, st({
        id: e.snowball
      }));
    }
    if (e.inv && e.inv.slots) v = Math.max(v, st(e.inv.held), st(e.inv.slots[40]), st(e.inv.slots[36]));
    if (e.hand) v = Math.max(v, st(e.hand));
    if (e.offhand) v = Math.max(v, st(e.offhand));
    if (e.armorItems && e.armorItems[0]) v = Math.max(v, st(e.armorItems[0]));
    if (e.gear && e.type === 'armor_stand') v = Math.max(v, st(e.gear[3]), st(e.gear[4]), st(e.gear[5]));
    if (e.stack) v = Math.max(v, st(e.stack));
    if (e.item && (e.type === 'item_frame' || e.type === 'glow_item_frame')) v = Math.max(v, st(e.item));
    return Math.min(15, v);
  };

  // ---- one light's BFS (in a 37-block cube around its block) ----
  const R = 18,
    D = 2 * R + 1,
    D2 = D * D,
    D3 = D2 * D,
    MAXC = R - 1;
  const LX = new Int8Array(D3),
    LY = new Int8Array(D3),
    LZ = new Int8Array(D3),
    TX = new Uint8Array(D3);
  for (let i = 0; i < D3; i++) {
    const x = i % D,
      z = Math.floor(i / D) % D,
      y = Math.floor(i / D2);
    LX[i] = x - R;
    LY[i] = y - R;
    LZ[i] = z - R;
    TX[i] = Math.abs(x - R) + Math.abs(y - R) + Math.abs(z - R);
  }
  const STEPS = [1, -1, D, -D, D2, -D2];
  const dist = new Uint8Array(D3).fill(255),
    opc = new Uint8Array(D3),
    seenB = new Uint8Array(D3),
    touched = new Int32Array(D3);
  let nT = 0;
  const BK = [];
  for (let c = 0; c <= MAXC; c++) BK.push([]);
  let cw = null,
    ccx = 0,
    ccz = 0,
    cch = null;
  const opAt = (w, x, y, z) => {
    if (y < 0) return 15;
    if (y >= HEIGHT) return 0;
    const cx = x >> 4,
      cz = z >> 4;
    if (cw !== w || cx !== ccx || cz !== ccz) {
      cw = w;
      ccx = cx;
      ccz = cz;
      cch = w.chunks.get(ckey(cx, cz));
    }
    return cch ? OPACITY[cch.getB(y << 8 | (z & 15) << 4 | x & 15)] : 15;
  };
  const grow = a => {
    const b = new Uint32Array(a.length * 2);
    b.set(a);
    return b;
  };
  // rec.air: cell | (cost - its |dx|+|dy|+|dz|) << 16; rec.bnd: an opaque cell beside them | the air cell it was found from << 16
  const bfs = (rec, w) => {
    for (let i = 0; i < nT; i++) {
      const k = touched[i];
      dist[k] = 255;
      opc[k] = 0;
      seenB[k] = 0;
    }
    nT = 0;
    cw = null;
    const sx = rec.sx,
      sy = rec.sy,
      sz = rec.sz,
      maxC = Math.min(MAXC, Math.ceil(rec.L + 2));
    const s0 = R + R * D + R * D2;
    opc[s0] = 1 + opAt(w, sx, sy, sz);
    touched[nT++] = s0;
    if (opc[s0] - 1 < 15) {
      dist[s0] = 0;
      BK[0].push(s0);
    } else for (const s of STEPS) {
      // a light inside a block (a mob's middle in a slab ...): from the blocks beside it
      const k = s0 + s;
      opc[k] = 1 + opAt(w, sx + LX[k], sy + LY[k], sz + LZ[k]);
      touched[nT++] = k;
      if (opc[k] - 1 < 15) {
        dist[k] = 1;
        BK[1].push(k);
      }
    }
    let air = rec.air,
      bnd = rec.bnd,
      nA = 0,
      nB = 0;
    for (let c = 0; c <= maxC; c++) {
      const B = BK[c];
      for (let j = 0; j < B.length; j++) {
        const k = B[j];
        if (dist[k] !== c) continue;
        if (nA >= air.length) air = rec.air = grow(air);
        const ai = nA++;
        air[ai] = k | c - TX[k] << 16;
        if (c === maxC) continue;
        for (let d = 0; d < 6; d++) {
          const n = k + STEPS[d];
          let o = opc[n];
          if (!o) {
            o = opc[n] = 1 + opAt(w, sx + LX[n], sy + LY[n], sz + LZ[n]);
            touched[nT++] = n;
          }
          o--;
          if (o >= 15) {
            if (!seenB[n]) {
              seenB[n] = 1;
              if (nB >= bnd.length) bnd = rec.bnd = grow(bnd);
              bnd[nB++] = (n | ai << 16) >>> 0;
            }
            continue;
          }
          const nc = c + (o > 1 ? o : 1);
          if (nc <= maxC && nc < dist[n]) {
            dist[n] = nc;
            BK[nc].push(n);
          }
        }
      }
      B.length = 0;
    }
    for (let c = maxC + 1; c <= MAXC; c++) BK[c].length = 0;
    rec.nA = nA;
    rec.nB = nB;
    rec.bL = rec.L;
    rec.r = maxC + 1;
  };

  // ---- writing lights into the volume ----
  const tmp = new Float32Array(D3);
  const stamp = (rec, b) => {
    const L = rec.L,
      px = rec.x - ox,
      py = rec.y - oy,
      pz = rec.z - oz,
      cx = rec.sx - ox,
      cy = rec.sy - oy,
      cz = rec.sz - oz;
    const x0 = b[0],
      y0 = b[1],
      z0 = b[2],
      x1 = b[3],
      y1 = b[4],
      z1 = b[5],
      air = rec.air,
      bnd = rec.bnd;
    for (let i = 0, n = rec.nA; i < n; i++) {
      const a = air[i],
        k = a & 0xFFFF,
        vx = cx + LX[k],
        vy = cy + LY[k],
        vz = cz + LZ[k];
      const v = Math.min(L, L + 0.5 - (a >>> 16) - Math.abs(vx + 0.5 - px) - Math.abs(vy + 0.5 - py) - Math.abs(vz + 0.5 - pz));
      tmp[i] = v;
      if (v <= 0 || vx < x0 || vx >= x1 || vy < y0 || vy >= y1 || vz < z0 || vz >= z1) continue;
      const q = v >= 15 ? 255 : v * 17 + 0.5 | 0,
        j = vx + vz * SX + vy * SXZ;
      if (q > vol[j]) vol[j] = q;
    }
    for (let i = 0, n = rec.nB; i < n; i++) {
      const a = bnd[i],
        k = a & 0xFFFF,
        v = tmp[a >>> 16] - 1;
      if (v <= 0) continue;
      const vx = cx + LX[k],
        vy = cy + LY[k],
        vz = cz + LZ[k];
      if (vx < x0 || vx >= x1 || vy < y0 || vy >= y1 || vz < z0 || vz >= z1) continue;
      const q = v >= 15 ? 255 : v * 17 + 0.5 | 0,
        j = vx + vz * SX + vy * SXZ;
      if (q > vol[j]) vol[j] = q;
    }
  };
  // boxes: [x0, y0, z0, x1, y1, z1] in the volume's cells
  const boxOf = rec => {
    const r = rec.r,
      cx = rec.sx - ox,
      cy = rec.sy - oy,
      cz = rec.sz - oz;
    const b = [Math.max(0, cx - r), Math.max(0, cy - r), Math.max(0, cz - r), Math.min(SX, cx + r + 1), Math.min(SY, cy + r + 1), Math.min(SZ, cz + r + 1)];
    return b[0] < b[3] && b[1] < b[4] && b[2] < b[5] ? b : null;
  };
  const vbox = b => (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
  const meets = (a, b) => a[0] < b[3] && b[0] < a[3] && a[1] < b[4] && b[1] < a[4] && a[2] < b[5] && b[2] < a[5];
  const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
  const merge = list => {
    const out = [];
    for (let b of list) {
      for (let i = 0; i < out.length; i++) {
        const u = union(out[i], b);
        if (meets(out[i], b) || vbox(u) <= 1.3 * (vbox(out[i]) + vbox(b))) {
          out.splice(i, 1);
          b = u;
          i = -1;
        }
      }
      out.push(b);
    }
    return out;
  };
  const clearBox = b => {
    for (let y = b[1]; y < b[4]; y++) for (let z = b[2]; z < b[5]; z++) {
      const j = y * SXZ + z * SX;
      vol.fill(0, j + b[0], j + b[3]);
    }
  };

  // ---- the texture ----
  let tex = null,
    texGl = null;
  const withUnit = (gl, fn) => {
    const act = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    try {
      fn();
    } finally {
      gl.activeTexture(act);
    }
  };
  const send = (gl, boxes) => withUnit(gl, () => {
    const keys = [gl.UNPACK_ALIGNMENT, gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL];
    const keep = keys.map(k => gl.getParameter(k)),
      pbo = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
    if (pbo) gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, SX);
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, SZ);
    for (const b of boxes) {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, b[0]);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, b[2]);
      gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, b[1]);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, b[0], b[2], b[1], b[3] - b[0], b[5] - b[2], b[4] - b[1], gl.RED, gl.UNSIGNED_BYTE, vol);
    }
    keys.forEach((k, i) => gl.pixelStorei(k, typeof keep[i] === 'boolean' ? keep[i] : keep[i] | 0));
    if (pbo) gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, pbo);
  });
  const ensureTex = gl => {
    if (tex && texGl === gl && gl.isTexture(tex)) return false;
    tex = gl.createTexture();
    texGl = gl;
    withUnit(gl, () => {
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, SX, SZ, SY);
    });
    return true; // (all of vol to send)
  };

  // ---- each frame ----
  const recs = new Map(); // entity -> its light
  let curWorld = null,
    nz = null,
    count = 0,
    frame = 0;
  const update = (g, a) => {
    frame++;
    const r = g.renderer,
      gl = r && r.gl;
    if (!gl || gl.isContextLost()) return;
    const S = cfg(g),
      now = performance.now(),
      p = g.player;
    const on = !broken && S.mode > 0 && !g.net && g.state === 'play' && !!p && !!g.world;
    const dirty = [];
    if (g.world !== curWorld) {
      curWorld = g.world;
      for (const rec of recs.values()) if (rec.box) dirty.push(rec.box);
      recs.clear();
      placed = false;
    }
    // the lights of this frame, nearest first
    const cand = [];
    if (on) {
      const px = p.pos[0],
        py = p.pos[1],
        pz = p.pos[2];
      const look = e => {
        if (!e || e.dead || e.deathTime > 0 || !e.pos) return;
        const v = lumOfEntity(g, e, S, a);
        if (v <= 0) return;
        const q = e.ipos ? e.ipos(a) : e.pos,
          h = e.h || 0;
        const y = q[1] + (e === p ? Math.min(1.2, h * 0.66) : typeof Living === 'function' && e instanceof Living ? h * 0.66 : h * 0.5);
        const d2 = (q[0] - px) ** 2 + (y - py) ** 2 + (q[2] - pz) ** 2;
        if (d2 < 96 * 96) cand.push({
          e,
          d2,
          x: q[0],
          y,
          z: q[2],
          L: v
        });
      };
      look(p);
      for (const e of g.entities || []) if (e !== p) look(e);
      // (the 灯笼小精灵 pet floating by the player - cosmetics.js: a light of its own; not with 自己 off)
      if (S.self !== false && typeof Cosmetics !== 'undefined' && Cosmetics.lights) for (const s of Cosmetics.lights(g)) {
        const d2 = (s.x - px) ** 2 + (s.y - py) ** 2 + (s.z - pz) ** 2;
        if (d2 < 96 * 96) cand.push({
          e: s.key,
          d2,
          x: s.x,
          y: s.y,
          z: s.z,
          L: s.L
        });
      }
      cand.sort((u, w) => u.d2 - w.d2);
      if (cand.length > MAXL) cand.length = MAXL;
      // the volume follows the player (in steps of 8; what was drawn at the old place is cleared)
      const bx = Math.floor(px),
        by = Math.floor(py),
        bz = Math.floor(pz);
      if (!placed || Math.abs(bx - (ox + SX / 2)) > 16 || Math.abs(by - (oy + SY / 2)) > 8 || Math.abs(bz - (oz + SZ / 2)) > 16) {
        if (nz) dirty.push(nz);
        for (const rec of recs.values()) {
          rec.box = null;
          rec.force = true;
        }
        ox = (bx & ~7) - SX / 2;
        oy = (by & ~7) - SY / 2;
        oz = (bz & ~7) - SZ / 2;
        placed = true;
      }
    }
    for (const c of cand) {
      let rec = recs.get(c.e);
      if (!rec) {
        rec = {
          air: new Uint32Array(2048),
          bnd: new Uint32Array(1024),
          nA: -1,
          nB: 0,
          box: null,
          t: 0,
          tB: 0,
          bDirty: false,
          force: true
        };
        recs.set(c.e, rec);
      }
      rec.f = frame;
      rec.lx = c.x;
      rec.ly = c.y;
      rec.lz = c.z;
      rec.lL = c.L;
    }
    for (const [e, rec] of recs) if (rec.f !== frame) {
      if (rec.box) dirty.push(rec.box);
      recs.delete(e);
    }
    const iv = INTERVAL[S.mode] || 0,
      t0 = performance.now();
    let budget = 4;
    for (const c of cand) {
      const rec = recs.get(c.e),
        first = rec.nA < 0;
      const moved = first || rec.force || Math.abs(rec.lx - rec.x) + Math.abs(rec.ly - rec.y) + Math.abs(rec.lz - rec.z) > 0.004 || rec.lL !== rec.L;
      let want = rec.force || first || moved && (iv === 0 || now - rec.t >= iv);
      const cx = Math.floor(rec.lx),
        cy = Math.floor(rec.ly),
        cz = Math.floor(rec.lz);
      const needB = first || rec.bDirty || now - rec.tB > 2000 || want && (cx !== rec.sx || cy !== rec.sy || cz !== rec.sz || Math.ceil(rec.lL) !== Math.ceil(rec.bL));
      if (needB && (c.e === p || budget > 0 && performance.now() - t0 < 3)) {
        if (c.e !== p) budget--;
        rec.sx = cx;
        rec.sy = cy;
        rec.sz = cz;
        rec.L = rec.lL;
        bfs(rec, g.world);
        rec.tB = now + Math.random() * 300;
        rec.bDirty = false;
        want = true;
      }
      if (want && rec.nA >= 0) {
        if (rec.box) dirty.push(rec.box);
        rec.x = rec.lx;
        rec.y = rec.ly;
        rec.z = rec.lz;
        rec.L = rec.lL;
        rec.t = now;
        rec.force = false;
        rec.box = boxOf(rec);
        if (rec.box) dirty.push(rec.box);
      }
    }
    // redraw what changed
    const fresh = ensureTex(gl);
    let boxes = dirty.length ? merge(dirty) : [];
    for (const b of boxes) {
      clearBox(b);
      for (const rec of recs.values()) if (rec.box && rec.nA >= 0 && meets(rec.box, b)) stamp(rec, b);
    }
    if (fresh) boxes = [[0, 0, 0, SX, SY, SZ]];
    if (boxes.length) send(gl, boxes);
    nz = null;
    count = 0;
    for (const rec of recs.values()) if (rec.box) {
      nz = nz ? union(nz, rec.box) : rec.box.slice();
      count++;
    }
    // the programs: on / off and where the volume is
    const onN = count ? 1 : 0;
    let cur = null;
    for (let i = progs.length - 1; i >= 0; i--) {
      const pr = progs[i];
      if (pr.gl !== gl) continue;
      if (!gl.isProgram(pr.P.p)) {
        progs.splice(i, 1);
        continue;
      }
      const o = pr.o;
      if (pr.on === onN && (!onN || o && o[0] === ox && o[1] === oy && o[2] === oz)) continue;
      if (cur === null) cur = gl.getParameter(gl.CURRENT_PROGRAM);
      gl.useProgram(pr.P.p);
      gl.uniform1f(pr.P.u.u_dynOn, onN);
      pr.on = onN;
      if (onN && pr.P.u.u_dynO) {
        gl.uniform3f(pr.P.u.u_dynO, ox, oy, oz);
        pr.o = [ox, oy, oz];
      }
    }
    if (cur !== null) restore(gl, cur);
    if (onN) withUnit(gl, () => {}); // (bound on its unit every frame)
  };

  // ---- the light the volume gives at a point (block light 0..15) ----
  const cellLv = (x, y, z) => {
    const vx = x - ox,
      vy = y - oy,
      vz = z - oz;
    if (vx < 0 || vy < 0 || vz < 0 || vx >= SX || vy >= SY || vz >= SZ) return 0;
    return vol[vx + vz * SX + vy * SXZ] / 17;
  };
  const pointLv = (x, y, z) => {
    const X = x - 0.5,
      Y = y - 0.5,
      Z = z - 0.5,
      i = Math.floor(X),
      j = Math.floor(Y),
      k = Math.floor(Z),
      u = X - i,
      v = Y - j,
      w = Z - k;
    let s = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1,
        dy = c >> 1 & 1,
        dz = c >> 2;
      s += cellLv(i + dx, j + dy, k + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return s;
  };
  let drawing = false;
  self.DynLights = {
    get count() {
      return count;
    },
    cellLv,
    pointLv,
    recs,
    vol,
    progs,
    cfg,
    origin: () => [ox, oy, oz],
    lumOfEntity
  };
  if (typeof Game === 'function') {
    const render = Game.prototype.render;
    Game.prototype.render = function (a, now) {
      try {
        update(this, a !== null && a !== void 0 ? a : 1);
      } catch (e) {
        fail('update', e);
        count = 0;
      }
      drawing = true;
      try {
        return render.call(this, a, now);
      } finally {
        drawing = false;
      }
    };
  }
  if (typeof UI === 'function' && UI.prototype.draw) {
    // (the interface, F3 among it, shows the world's own light)
    const draw = UI.prototype.draw;
    UI.prototype.draw = function (...args) {
      const was = drawing;
      drawing = false;
      try {
        return draw.apply(this, args);
      } finally {
        drawing = was;
      }
    };
  }
  // chests, signs, bells, campfire food, pets, rain ...: what is drawn with the world's light where it is
  if (typeof World === 'function') {
    const getLight = World.prototype.getLight;
    World.prototype.getLight = function (x, y, z) {
      const l = getLight.call(this, x, y, z);
      if (!drawing || !count || this !== curWorld) return l;
      const b = Math.round(cellLv(x, y, z));
      return b > (l & 15) ? l & 0xF0 | b : l;
    };
    // a block changed near a light: its BFS again
    const setBlock = World.prototype.setBlock;
    World.prototype.setBlock = function (x, y, z, id, meta, flags) {
      const ok = setBlock.call(this, x, y, z, id, meta, flags);
      if (ok && recs.size && this === curWorld) for (const rec of recs.values()) if (Math.abs(x - rec.sx) <= R && Math.abs(y - rec.sy) <= R && Math.abs(z - rec.sz) <= R) rec.bDirty = true;
      return ok;
    };
  }
  // mobs, items lying about, your hand: the light where they are
  if (typeof Entity === 'function') {
    const la = Entity.prototype.lightAt;
    Entity.prototype.lightAt = function () {
      const L = la.call(this);
      if (count && this.world === curWorld) {
        const b = pointLv(this.pos[0], this.pos[1] + (this.h || 0) * 0.5, this.pos[2]) / 15;
        if (b > L[1]) L[1] = b;
      }
      return L;
    };
  }

  // ---- 视频设置 → 移动光源… ----
  if (typeof OptionsListScreen === 'function') {
    const MODES = ['关', '流畅', '平衡', '精致'],
      LV = ['关', '简单', '精致'];
    const options = OptionsListScreen.prototype.options;
    OptionsListScreen.prototype.options = function () {
      const g = this.game;
      if (this.page === 'dynlights') {
        const c = cfg(g),
          onoff = v => v ? '开' : '关';
        const bt = (label, fn, tip, wide) => ({
          label,
          wide,
          tip,
          onClick: () => {
            fn();
            g.saveSettings();
          }
        });
        return [bt(() => '移动光源：' + MODES[c.mode], () => c.mode = (c.mode + 1) % 4, ['拿着火把这类发光物品，周围跟着亮', '流畅：每秒更新 2 次　平衡：每秒 4 次', '精致：每帧都更新（最平滑）'], true), bt(() => '自己发光：' + onoff(c.self), () => c.self = !c.self, ['你手里、头上的发光物品照亮周围']), bt(() => '其他光源：' + onoff(c.ents), () => c.ents = !c.ents, ['生物拿着的、掉在地上的、物品展示框里的发光物品', '着火的生物、烈焰人、岩浆怪、发光鱿鱼、火球、光灵箭……']), bt(() => '水下熄灭：' + onoff(c.water), () => c.water = !c.water, ['火把、营火、岩浆桶这类在水下不发光']), bt(() => '点燃的 TNT：' + LV[c.tnt], () => c.tnt = (c.tnt + 1) % 3, ['简单：一直发光', '精致：随着闪白一明一暗']), bt(() => '苦力怕引爆：' + LV[c.creeper], () => c.creeper = (c.creeper + 1) % 3, ['简单：膨胀时发光', '精致：越接近爆炸越亮'])];
      }
      const o = options.call(this);
      if (this.page === 'video' && Array.isArray(o)) o.push({
        label: '移动光源…',
        tip: ['模组「移动光源」的设置'],
        onClick: () => g.ui.open(new OptionsListScreen(g, this, '移动光源', 'dynlights'))
      });
      return o;
    };
  }
})();
