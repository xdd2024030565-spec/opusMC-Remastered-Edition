'use strict';
// ---------------------------------------------------------------------------
// OpusMC Remastered · 联机中转（bridge）
//
// 浏览器开不了 TCP，而真实的 Minecraft 服务器都是 TCP + Minecraft 协议。这个程序做两件事：
//   1. 把网页客户端的 WebSocket 连上来（ws://host:8780/ws）；
//   2. 用 minecraft-protocol 作为「客户端」连到真实服务器，把它的世界翻译成 OpusMC 客户端
//      能画的协议（states / login / 区块二进制帧 / block / pos / chat …）。
//
// 客户端协议见 js/net.js 的 NetClient 与 js/mp.js：它只发 {t:'hello'|'settings'|'tick'|'dig'|
// 'place'|'chat'|…}，只收 JSON 消息 + 两种二进制帧。这里不需要任何 HTTP API、房间或鉴权。
//
// 用法：
//   npm install
//   node server.js                  # 监听 8780
//   PORT=9000 node server.js
//   ALLOW_HOSTS=mc.example.com,play.example.com node server.js   # 只允许连这些服务器（防 SSRF）
//
// 网页那边：服务器列表会连 <当前域名>:8780/ws；部署到别处时用 ?proxy=wss://your-bridge/ws，
// 或在 js/mp-config.js 里写 window.MP_PROXY。
// ---------------------------------------------------------------------------

const { WebSocketServer } = require('ws');
const mc = require('minecraft-protocol');
const mcDataOf = require('minecraft-data');
const { buildStates } = require('./states');

const PORT = +(process.env.PORT || 8780);
const HOST = process.env.HOST || '0.0.0.0';
// 允许连的目标服务器（逗号分隔）；留空 = 不限制（本机自用；放到公网请务必填）
const ALLOW_HOSTS = String(process.env.ALLOW_HOSTS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// 默认连哪个 MC 版本：不填就问服务器（ping），以服务器为准
const DEFAULT_VERSION = process.env.MC_VERSION || '';
const MAX_CLIENTS = +(process.env.MAX_CLIENTS || 32);
const LOG = process.env.QUIET ? () => {} : (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let live = 0;

// ---------------------------------------------------------------------------
// 方块状态表：把 MC 的 stateId（数字）变成客户端认识的 "minecraft:xxx[prop=v]"
// ---------------------------------------------------------------------------
const stateCache = new Map(); // version -> {list, count}
function statesFor(version) {
  let s = stateCache.get(version);
  if (!s) {
    s = buildStates(version);
    stateCache.set(version, s);
    LOG('states built for', version, '->', s.length, 'entries');
  }
  return s;
}

// ---------------------------------------------------------------------------
// 一个网页客户端 <-> 一台真实服务器
// ---------------------------------------------------------------------------
class Session {
  constructor(ws, hello) {
    this.ws = ws;
    this.name = String(hello.name || 'Player').slice(0, 16) || 'Player';
    this.rd = Math.max(2, Math.min(32, hello.rd | 0 || 6));
    this.closed = false;
    this.client = null;
    this.version = '';
    this.states = null;
    this.stateIndex = new Map(); // "minecraft:stone" -> stateId（用于反向）
    this.entityId = 1;
    this.chunkQueue = [];
    this.chunkTimer = null;
    // 客户端发来的东西先缓冲，直到进世界
    this.playerPos = [0.5, 64, 0.5];
    this.ready = false;
  }

  send(o) {
    if (this.closed || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(o)); } catch (e) {}
  }

  sendBinary(buf) {
    if (this.closed || this.ws.readyState !== 1) return;
    try { this.ws.send(buf, { binary: true }); } catch (e) {}
  }

  fail(msg) {
    if (this.closed) return;
    this.send({ t: 'error', msg });
    LOG('session fail:', msg);
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.client && this.client.end('bridge closed'); } catch (e) {}
    try { this.ws.close(); } catch (e) {}
    live = Math.max(0, live - 1);
  }

  // ---- 连到真实服务器 ------------------------------------------------------
  async connect(host, port) {
    if (ALLOW_HOSTS.length && !ALLOW_HOSTS.includes(String(host).toLowerCase())) {
      return this.fail('这个中转不允许连接 ' + host + '（管理员可设 ALLOW_HOSTS）');
    }
    LOG('connect', host + ':' + port, 'as', this.name);
    // 先 ping 一次拿版本与 MOTD（也给网页的服务器列表用），再按那个版本登录
    let info = null;
    try {
      info = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('ping 超时')), 8000);
        try {
          mc.ping({ host, port, closeTimeout: 6000 }, (err, r) => {
            clearTimeout(t);
            if (err) rej(err); else res(r);
          });
        } catch (e) { clearTimeout(t); rej(e); }
      });
    } catch (e) {
      LOG('ping failed (continue anyway):', e.message);
    }
    // MOTD 里的版本名经常骗人（"Velocity 1.7.2-26.3" 其实是 1.21.11；"Requires MC 1.8 / 1.21" 也可能只收新版本）。
    // 唯一可靠的是 ping 回包里的协议号。
    const proto = info && info.version && info.version.protocol;
    const usable = DEFAULT_VERSION || versionByProtocol(proto) || pickVersion(info && info.version && info.version.name);
    LOG('target proto:', proto, 'name:', info && info.version && info.version.name, '-> using', usable);
    this.version = usable;
    this.states = statesFor(usable);
    this.stateByKey = new Map();
    for (let i = this.states.length - 1; i >= 0; i--) this.stateByKey.set(this.states[i], i);

    let client;
    try {
      client = mc.createClient({
        host, port,
        username: this.name,
        auth: 'offline',
        version: usable,
        hideErrors: true,
        brand: 'OpusMC-Remastered'
      });
    } catch (e) {
      return this.fail('连不上 ' + host + ':' + port + '：' + e.message);
    }
    this.client = client;

    client.on('error', e => {
      LOG('client error:', e.message);
      this.fail('服务器连接出错：' + e.message);
    });
    client.on('end', reason => {
      if (this.closed) return;
      this.send({ t: 'kick', reason: reason || '服务器关闭了连接' });
      this.close();
    });
    client.on('kick_disconnect', p => {
      this.send({ t: 'kick', reason: chatText(p.reason) });
      this.close();
    });
    // 新版 minecraft-protocol 的正版服拒绝包叫 disconnect（不是 kick_disconnect），
    // 不监听的话玩家只会看到裸 "socketClosed"，看不到真实原因（如"未登录微软账号"）。
    client.on('disconnect', p => {
      this.send({ t: 'kick', reason: chatText(p && p.reason) || '服务器断开了连接' });
      this.close();
    });
    // minecraft-protocol@1.68 的客户端侧进世界后发 success → playerJoin，
    // **不发 login**（login 只在服务端侧）。只听 login 会导致永远不进世界。
    // 两个事件都监听以兼容不同版本；enterWorld 内部有 this.ready 防重入。
    const enter = () => this.enterWorld();
    client.on('success', enter);
    client.on('playerJoin', enter);
    client.on('packet', (data, meta) => {
      try { this.onPacket(data, meta); } catch (e) { /* 单个包出错不影响别的 */ }
    });
    client.on('state', s => LOG('  state:', s));
  }

  // ---- 进世界：把客户端的 enterWorld 需要的东西一次发过去 -------------------
  enterWorld() {
    if (this.ready || this.closed) return; // success 与 playerJoin 可能都触发，只进一次世界
    const c = this.client;
    LOG('logged in; dimension:', c.game && c.game.dimension);
    this.ready = true;
    // 1) states 必须先发（客户端的 onBinary 在 stateMap 空时直接 return）
    this.send({ t: 'states', list: this.states });
    // 2) login：dimension 名要在客户端的三个维度之一
    const dim = dimOf(c.game && c.game.dimension);
    this.entityId = (c.entity && c.entity.id) || 1;
    this.send({
      t: 'login',
      eid: this.entityId,
      dim,
      minY: -64,
      mode: 'survival'
    });
    // 3) 传送到服务器给的位置（否则客户端从 (0.5,100,0.5) 掉下去）
    const p = this.playerPosFromServer();
    this.send({ t: 'pos', x: p[0], y: p[1], z: p[2], yaw: 0, pitch: 0, rel: {}, id: 1 });
    // 4) 让客户端知道世界高度（gen 2 = 384 高）
    // （客户端在 login 里拿 minY，自己按 SECTIONS=24 走）
    this.send({ t: 'time', day: 0, rate: 20 });
    // 5) 天气、血量、背包
    this.send({ t: 'health', hp: 20, food: 20, sat: 5 });
    this.send({ t: 'xp', level: 0, bar: 0 });
    this.send({ t: 'players', list: [{ uuid: String(this.entityId), name: this.name }] });
  }

  playerPosFromServer() {
    const c = this.client;
    const e = c && c.entity;
    if (e && e.position) return [e.position.x, e.position.y, e.position.z];
    if (c && c.game && c.game.position) return [c.game.position.x, c.game.position.y, c.game.position.z];
    return this.playerPos;
  }

  // ---- 服务器发来的包 -> OpusMC 协议 --------------------------------------
  onPacket(data, meta) {
    const n = meta.name;
    const c = this.client;
    switch (n) {
      case 'position':
        this.playerPos = [data.x, data.y, data.z];
        // 服务器要求传送（刚进世界 / 重生）
        this.send({ t: 'pos', x: data.x, y: data.y, z: data.z, yaw: data.yaw || 0, pitch: data.pitch || 0, rel: data.flags ? {} : {}, id: 1 });
        break;
      case 'update_time':
        this.send({ t: 'time', day: data.time !== undefined ? (data.time % 24000) : 0, rate: 20 });
        break;
      case 'game_state_change':
        if (data.reason === 1) this.send({ t: 'rain', on: !!data.gameMode });
        else if (data.reason === 2) this.send({ t: 'rain', level: data.gameMode / 20 });
        else if (data.reason === 3) {
          const modes = ['survival', 'creative', 'adventure', 'spectator'];
          this.send({ t: 'mode', mode: modes[data.gameMode] || 'survival' });
        }
        break;
      case 'chat':
      case 'system_chat':
        this.send({ t: 'chat', text: chatText(data.message !== undefined ? data.message : data.content), color: '#FFFFFF' });
        break;
      case 'player_chat':
        this.send({ t: 'chat', text: chatText(data.unsignedChatContent || data.signedChatContent || data.message), color: '#FFFFFF' });
        break;
      case 'player_info':
        this.onPlayerInfo(data);
        break;
      case 'named_entity_spawn':
        this.send({
          t: 'spawn', id: data.entityId, type: 'player',
          x: (data.x || 0) / 32, y: (data.y || 0) / 32, z: (data.z || 0) / 32,
          uuid: data.playerUUID, name: data.playerUUID
        });
        break;
      case 'entity_move_look':
      case 'rel_entity_move':
        this.send({
          t: 'move', id: data.entityId,
          x: (data.dX || 0) / 32, y: (data.dY || 0) / 32, z: (data.dZ || 0) / 32,
          yaw: data.yaw, pitch: data.pitch, tp: n !== 'rel_entity_move'
        });
        break;
      case 'entity_teleport':
        this.send({ t: 'move', id: data.entityId, x: data.x, y: data.y, z: data.z, yaw: data.yaw, pitch: data.pitch, tp: true });
        break;
      case 'entity_head_rotation':
        this.send({ t: 'head', id: data.entityId, yaw: data.headYaw });
        break;
      case 'entity_destroy':
        this.send({ t: 'remove', ids: data.entityIds || [] });
        break;
      case 'block_change':
        this.send({ t: 'block', x: data.location.x, y: data.location.y, z: data.location.z, s: this.stateOf(data.type) });
        break;
      case 'multi_block_change':
        this.onMultiBlockChange(data);
        break;
      case 'map_chunk':
        this.onMapChunk(data);
        break;
      case 'update_health':
        this.send({ t: 'health', hp: data.health, food: 20, sat: 5 });
        break;
      case 'experience':
        this.send({ t: 'xp', level: data.level, bar: data.experience });
        break;
      case 'respawn':
        this.send({ t: 'respawn', eid: this.entityId, dim: dimOf(data.worldName !== undefined ? data.worldName : data.dimension), minY: -64, mode: 'survival' });
        break;
      case 'unload_chunk':
        this.send({ t: 'unload', cx: data.chunkX, cz: data.chunkZ });
        break;
      default:
        break;
    }
  }

  stateOf(stateId) {
    // MC 的 stateId 就是 states 数组下标
    return stateId | 0;
  }

  onPlayerInfo(d) {
    const add = d.added ? d.data.filter(x => x.uuid !== this.uuid) : [];
    if (!add.length) return;
    for (const p of add) {
      this.send({
        t: 'spawn', id: 0, type: 'player', x: 0, y: 0, z: 0,
        uuid: p.uuid, name: p.name || p.uuid
      });
    }
  }

  onMultiBlockChange(d) {
    const list = [];
    for (const r of d.records || []) {
      const pos = r.location || r.position || r.pos;
      if (!pos) continue;
      list.push(pos.x, pos.y, pos.z, this.stateOf(r.blockId !== undefined ? r.blockId : r.stateId));
    }
    if (list.length) this.send({ t: 'blocks', list });
  }

  // ---- 区块：MC 的分段格式 -> OpusMC 的调色板二进制帧 ---------------------
  onMapChunk(d) {
    const buf = this.encodeChunk(d);
    if (buf) this.sendBinary(buf);
  }

  // OpusMC 客户端 onBinary 要的格式：
  //   u8 type(1) | i32 cx | i32 cz | u8 n(段数)
  //   每段：u16 len + len×u16 调色板 + (len>1 ? 4096×(u8|u16) 索引) + u8 flags(+光照)
  //   末尾 256B biome
  encodeChunk(d) {
    // 实测（子代理 92c3292a）：minecraft-protocol@1.68.0 的 map_chunk 里
    // chunkData 是裸 Buffer（24 section×179B=4296B），不是 {sections} 对象。
    // 必须用 prismarine-chunk 把它解析成 24 个 section，再逐段取出 4096 个 stateId。
    const SECTIONS = 24; // gen2: minY=-64 .. 320
    let cx, cz;
    if (d.chunkX !== undefined) { cx = d.chunkX; cz = d.chunkZ; }
    else if (d.x !== undefined) { cx = d.x; cz = d.z; }
    else return null;
    if (!Buffer.isBuffer(d.chunkData)) return null;
    let ch;
    try {
      const C = require('prismarine-chunk')(this.version || '1.21.4');
      ch = new C();
      ch.load(d.chunkData); // Buffer -> 24 sections + biomes
    } catch (e) { return null; }

    const out = { cx, cz, sections: [] };
    for (let s = 0; s < SECTIONS; s++) {
      const container = ch.sections[s] && ch.sections[s].data;
      if (!container) { out.sections.push(null); continue; }
      const ids = new Uint16Array(4096);
      try {
        // container.get(i) 已统一处理 single/indirect/direct 三种容器；
        // i 是 block index = (y&15)<<8 | (z&15)<<4 | (x&15)，与客户端索引序一致。
        for (let i = 0; i < 4096; i++) ids[i] = container.get(i);
      } catch (e) { out.sections.push(null); continue; }
      // 调色板压缩（stateId 就是 states 数组下标，客户端 map[raw] 会翻译成方块）
      const pal = [], idxOf = new Map(), idx = new Uint16Array(4096);
      for (let i = 0; i < 4096; i++) {
        const sid = ids[i];
        let k = idxOf.get(sid);
        if (k === undefined) { k = pal.length; pal.push(sid); idxOf.set(sid, k); }
        idx[i] = k;
      }
      out.sections.push({ pal, idx });
    }
    return packChunkFrame(out);
  }

  // ---- 客户端 -> 服务器 ---------------------------------------------------
  onClientMessage(m) {
    const c = this.client;
    if (!c || this.closed) return;
    try {
      switch (m.t) {
        case 'settings':
          // render distance：1.18+ 用 client_information，老版本用 settings
          try {
            c.write('settings', { locale: 'zh_CN', viewDistance: Math.min(32, this.rd), chatColors: true, skinParts: 0x7f, mainHand: 1 });
          } catch (e) {
            try { c.write('client_information', { locale: 'zh_CN', viewDistance: Math.min(32, this.rd), chatColors: true, skinParts: 0x7f, mainHand: 1, enableTextFiltering: false, allowServerListings: true }); } catch (e2) {}
          }
          break;
        case 'tpok':
          break;
        case 'tick': {
          // 客户端权威移动：把它的位置写给服务器
          const p = m.pos || [];
          try {
            c.write('position_look', {
              x: p[0], y: p[1], z: p[2],
              yaw: p[3], pitch: p[4], onGround: !!p[5]
            });
          } catch (e) {}
          break;
        }
        case 'dig':
          try {
            c.write('block_dig', { status: m.status === 2 ? 2 : 0, location: { x: m.x, y: m.y, z: m.z }, face: m.face | 0 });
          } catch (e) {}
          break;
        case 'place':
          try {
            c.write('block_place', {
              location: { x: m.x, y: m.y, z: m.z }, face: m.face | 0,
              hand: 0, cursorX: 0.5, cursorY: 0.5, cursorZ: 0.5, insideBlock: false, sequence: 0
            });
          } catch (e) {}
          break;
        case 'swing':
          try { c.write('arm_animation', { hand: 0 }); } catch (e) {}
          break;
        case 'chat':
          try { c.write('chat', { message: String(m.text || '').slice(0, 256) }); } catch (e) {}
          break;
        case 'held':
          try { c.write('held_item_slot', { slotId: m.slot | 0 }); } catch (e) {}
          break;
        case 'ping':
          this.send({ t: 'pong', i: m.i });
          break;
        default:
          break;
      }
    } catch (e) {
      LOG('client->server failed for', m.t, e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

// 把 chat message（可能是字符串、JSON、或 {text,extra}）变成纯文本
function chatText(m) {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  if (typeof m.text === 'string') {
    let s = m.text;
    for (const e of m.extra || []) s += chatText(e);
    return s;
  }
  if (Array.isArray(m)) return m.map(chatText).join('');
  if (typeof m.toString === 'function') return String(m);
  return '';
}

function dimOf(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('nether')) return 'nether';
  if (s.includes('end')) return 'end';
  return 'overworld';
}

// 从 "Requires MC 1.8 / 1.21" 或 "Paper 1.21.4" 里挑一个 minecraft-protocol 支持的版本
// 用协议号精确反查版本（minecraft-data 的 d.version.version 就是协议号）
let protoMap = null;
function versionByProtocol(proto) {
  if (!proto) return null;
  if (!protoMap) {
    protoMap = new Map();
    for (const v of mc.supportedVersions) {
      try {
        const d = mcDataOf(v);
        if (d && d.version && d.version.version) protoMap.set(d.version.version, v);
      } catch (e) {}
    }
  }
  return protoMap.get(proto) || null;
}

function pickVersion(s) {
  if (!s) return '1.21.4';
  const supported = Object.values(mc.supportedVersions);
  const nums = String(s).match(/\d+\.\d+(\.\d+)?/g) || [];
  // 先找完全匹配的
  for (const n of nums) if (supported.includes(n)) return n;
  // 再找同主次的
  for (const n of nums) {
    const mm = n.match(/^(\d+\.\d+)/);
    if (mm) {
      const hit = supported.filter(v => v.startsWith(mm[1] + '.') || v === mm[1]);
      if (hit.length) return hit.sort().pop();
    }
  }
  return '1.21.4';
}

// 从 BitArray / Buffer 里读 bits
function readBits(data, bitOffset, bits) {
  if (!data) return 0;
  if (typeof data.get === 'function') return data.get(bitOffset / bits | 0) | 0;
  const buf = data;
  let v = 0, got = 0, byte = bitOffset >> 3, shift = bitOffset & 7;
  while (got < bits) {
    const b = buf[byte] || 0;
    v |= ((b >> shift) & 0xff) << got;
    got += 8 - shift;
    shift = 0;
    byte++;
  }
  return v & ((1 << bits) - 1);
}

// 把区块打包成客户端要的二进制帧。
// 必须与 js/net.js 的 onBinary 逐字节对齐（那里是权威）：
//   len u16 | len×u16 调色板 | 仅当 len>1 时 4096×(u8 若 len<=256 否则 u16) 索引
//   | flags u8 | 仅当 flags&1 时 2048B 天光 | 仅当 flags&2 时 2048B 方块光
// 之后 24 段写完，末尾 256B biome。
// 关键：len=1 时没有索引区；flags=0 时没有光照区——多写一个字节后面全错位。
// 光照全交给客户端补（noSky -> 0xF0 满天空光），所以这里 flags 恒为 0。
function packChunkFrame(c) {
  const SECTIONS = 24;
  const parts = [];
  const head = Buffer.alloc(10);
  head[0] = 1; // type: 方块（客户端据此 new Chunk）
  head.writeInt32LE(c.cx | 0, 1);
  head.writeInt32LE(c.cz | 0, 5);
  head[9] = SECTIONS;
  parts.push(head);
  for (let s = 0; s < SECTIONS; s++) {
    const sec = c.sections[s];
    if (!sec || !sec.pal || !sec.pal.length) {
      // 空段：len=1、palette[0]=air(0)、无索引、flags=0 => 共 5 字节
      const b = Buffer.alloc(5);
      b.writeUInt16LE(1, 0);
      b.writeUInt16LE(0, 2);
      b[4] = 0; // flags
      parts.push(b);
      continue;
    }
    const pal = sec.pal, idx = sec.idx;
    const len = pal.length;
    const useU8 = len <= 256;
    const body = Buffer.alloc(2 + len * 2 + (len > 1 ? (useU8 ? 4096 : 8192) : 0) + 1);
    let o = 0;
    body.writeUInt16LE(len, o); o += 2;
    for (let i = 0; i < len; i++) { body.writeUInt16LE(pal[i] & 0xffff, o); o += 2; }
    if (len > 1) {
      if (useU8) { for (let i = 0; i < 4096; i++) body[o + i] = (idx && idx[i] || 0) & 0xff; o += 4096; }
      else { for (let i = 0; i < 4096; i++) { body.writeUInt16LE((idx && idx[i]) || 0, o); o += 2; } }
    }
    body[o] = 0; // flags: 无光照数据，客户端自动补 0xF0 满天空光
    parts.push(body);
  }
  const biome = Buffer.alloc(256); // 全 0 => client 用 VB_BASE
  parts.push(biome);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// WebSocket 服务
// ---------------------------------------------------------------------------
function startServer() {
const wss = new WebSocketServer({ port: PORT, host: HOST, maxPayload: 8 * 1024 * 1024 });
LOG('bridge listening on ws://' + HOST + ':' + PORT + '/ws  (ALLOW_HOSTS=' + (ALLOW_HOSTS.join(',') || '*') + ')');

wss.on('connection', (ws, req) => {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (live >= MAX_CLIENTS) {
    try { ws.send(JSON.stringify({ t: 'error', msg: '中转已满，稍后再试' })); ws.close(); } catch (e) {}
    return;
  }
  live++;
  LOG('ws from', ip, 'live=' + live);
  let session = null;
  let greeted = false;

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return; // 客户端不发二进制
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }

    // 服务器列表的 ping：{t:'ping', host, port}
    if (m.t === 'ping') {
      if (ALLOW_HOSTS.length && !ALLOW_HOSTS.includes(String(m.host).toLowerCase())) {
        ws.send(JSON.stringify({ t: 'error', msg: '不允许连接 ' + m.host }));
        return;
      }
      const t0 = Date.now();
      mc.ping({ host: m.host, port: m.port || 25565, closeTimeout: 6000 }, (err, r) => {
        if (ws.readyState !== 1) return;
        if (err || !r) { ws.send(JSON.stringify({ t: 'ping', online: -1 })); return; }
        ws.send(JSON.stringify({
          t: 'ping',
          online: r.players ? r.players.online : 0,
          max: r.players ? r.players.max : 0,
          version: r.version ? r.version.name : '',
          motd: chatText(r.description).slice(0, 80),
          ms: Date.now() - t0
        }));
      });
      return;
    }

    // 真正要进服务器
    if (m.t === 'hello') {
      if (greeted) return;
      greeted = true;
      // 目标主机两种来源：hello 消息里带（m.host），或 WebSocket URL 查询串
      // （js/mp.js 的 ws() 把 host/port 拼在 ?host=&port= 上）。
      // 必须先合并查询串再判空——否则前端只发查询串时会被误判「没有服务器地址」。
      const u = new URL(req.url, 'ws://x');
      const h = u.searchParams.get('host') || m.host || m.server || '';
      const p = +(u.searchParams.get('port') || m.port || 25565);
      if (!h) {
        ws.send(JSON.stringify({ t: 'error', msg: '没有服务器地址' }));
        ws.close();
        return;
      }
      session = new Session(ws, m);
      session.connect(h, p).catch(e => session.fail('连接失败：' + e.message));
      return;
    }

    if (session) session.onClientMessage(m);
  });

  ws.on('close', () => {
    LOG('ws closed, live=' + (live - 1));
    if (session) session.close(); else live = Math.max(0, live - 1);
  });
  ws.on('error', () => {
    if (session) session.close(); else live = Math.max(0, live - 1);
  });
});

process.on('SIGINT', () => { LOG('bye'); process.exit(0); });
}

// 直接运行时才真正监听端口；被 require 时只导出工具函数（供验证脚本用）
if (require.main === module) startServer();
module.exports = { packChunkFrame, Session, statesFor, pickVersion, versionByProtocol, chatText, dimOf };

