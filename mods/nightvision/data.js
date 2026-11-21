'use strict';

// 夜视 - no blocks, items or tiles of its own: it only says what it is (its play: code.js)
(function () {
  const S = self;
  if (S.Mods) Mods.register('nightvision', {
    name: '夜视',
    blocks: 0,
    items: 0,
    tiles: 0
  });
})();
