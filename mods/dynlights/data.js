'use strict';

// 移动光源 - no blocks, items or tiles of its own: it only says what it is (its play: code.js)
(function () {
  const S = self;
  if (S.Mods) Mods.register('dynlights', {
    name: '移动光源',
    blocks: 0,
    items: 0,
    tiles: 0
  });
})();
