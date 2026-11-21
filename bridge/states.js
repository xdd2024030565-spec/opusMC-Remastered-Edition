// 从 minecraft-data 生成方块状态字符串表：stateId 就是数组下标。
// 客户端的 states 消息要的就是这套 "minecraft:xxx[prop=v]"，它的 mapVanillaState() 能认。
const mcData = require('minecraft-data');

function buildStates(version) {
  const d = mcData(version);
  const n = d.blocksArray.reduce((a, x) => Math.max(a, x.maxStateId), 0) + 1;
  const out = new Array(n);
  out[0] = 'minecraft:air';
  for (const b of d.blocksArray) {
    if (!b.states || b.states.length === 0) {
      for (let s = b.minStateId; s <= b.maxStateId; s++)
        out[s] = 'minecraft:' + b.name;
    } else {
      for (let s = b.minStateId; s <= b.maxStateId; s++) {
        const props = stateProps(d, b, s);
        out[s] = 'minecraft:' + b.name + (props ? '[' + props + ']' : '');
      }
    }
  }
  return out;
}

function stateProps(d, b, sid) {
  // minecraft-data 的 states: [{name, type, num_values, values?}]
  // MC 编码顺序：后面的属性变化快，所以从后往前反推
  let idx = sid - b.minStateId;
  const parts = [];
  for (let i = b.states.length - 1; i >= 0; i--) {
    const st = b.states[i];
    const cnt = st.type === 'bool' ? 2 : (st.num_values || (st.values || []).length || 1);
    const v = idx % cnt;
    idx = Math.floor(idx / cnt);
    parts.unshift(st.name + '=' + (st.type === 'bool'
      ? (v ? 'true' : 'false')
      : (st.values ? st.values[v] : String(v))));
  }
  return parts.join(',');
}

module.exports = { buildStates, stateProps };
