'use strict';

// 农夫乐事教程地图 (hidden in mods/index.json: downloaded with 农夫乐事, opened from its card on the 模组 screen): no blocks, items or tiles of its own; its
// play (code.js) builds the map in the world it is on and gives /demo
(function () {
  const S = self;
  if (S.Mods) Mods.register('fddemo', {
    name: '农夫乐事教程地图',
    blocks: 0,
    items: 0,
    tiles: 0
  });
})();
