/* ==== mods code ==== */
'use strict';
// 离线包补回：SDK 在模组 code 之前收尾（注册方块/物品编号与贴图）
if (self.OpusMC) OpusMC._finish();

// 匠魂 Tinkers' Construct (SlimeKnights, MIT licence) - how it plays (its data: data.js; its tool system: tools.js)
// (bundle.js - made by tools/mods/tconstruct_build.py - is tools.js, this file and the rest of its scripts in one: one
// request; this file alone asks for it, before main.js - document.write keeps the order)
if (!self.TCON) {
  document.write('<script src="mods/tconstruct/bundle.js"><\/script>');
} else (function () {
  // its own tab in the creative inventory, with the seared bricks on it
  if (typeof CREATIVE_TABS !== 'undefined' && !CREATIVE_TABS.some(t => t.id === 'tconstruct')) CREATIVE_TABS.push({
    id: 'tconstruct',
    name: '匠魂',
    icon: 'seared_bricks',
    get items() {
      return creativeTabItems('tconstruct');
    }
  });

  // ---- the credits (MIT: its copyright notice and licence; its sounds' authors, CC BY 3.0 / CC0): pages of their own
  // in 制作人员名单与致谢 ----
  window.addEventListener('load', () => {
    if (typeof HELP_PAGES === 'undefined' || HELP_PAGES.some(p => p.tc) || typeof Font === 'undefined') return;
    const wrap = text => {
      const out = [];
      for (const para of String(text || '').split('\n')) {
        let cur = '';
        for (const word of para.split(' ')) {
          const t = cur ? cur + ' ' + word : word;
          if (Font.width(t) > 300 && cur) {
            out.push(cur);
            cur = word;
          } else cur = t;
        }
        out.push(cur);
      }
      return out;
    };
    const pages = (title, lines) => {
      for (let i = 0; i < lines.length; i += 18) HELP_PAGES.push({
        tc: true,
        title,
        lines: lines.slice(i, i + 18)
      });
    };
    pages("模组：匠魂 Tinkers' Construct", ["匠魂 Tinkers' Construct 由 SlimeKnights 制作，", '代码、贴图和数据按 MIT 许可使用（全文如下，', '模组包里另附 LICENSE.txt）。', '', ...wrap(String(self.TCON.license).replace(/([^\n])\n(?!\n)/g, '$1 '))]);
    pages('匠魂的音效', ['匠魂的音效来自 freesound.org，', '按 CC BY 3.0 或 CC0 使用：', '', ...wrap(self.TCON.soundCredits)]);
  });

  // ---- the chests (TinkersChestBlockEntity, PartChestBlockEntity, CastChestBlockEntity) ----
  // 256 places, shown as many as are used plus one (ScalingChestItemHandler); the tinkers' chest takes anything, 16 a
  // place; the part chest tool parts, 8 a place; the cast chest casts, 4 a place - those two keep one kind of item in
  // one place (another of it can only join it)
  const CHESTS = {
    tinkers_chest: {
      max: 16,
      tag: null,
      unique: false
    },
    part_chest: {
      max: 8,
      tag: 'tconstruct:chest_parts',
      unique: true
    },
    cast_chest: {
      max: 4,
      tag: 'tconstruct:casts',
      unique: true
    }
  };
  const SIZE = 256;
  const inTag = (tag, id) => itemIds('#' + tag).includes(id);
  class TinkerChestScreen extends ContainerScreen {
    constructor(game, be, rule, title) {
      super(game, 'generic_54', 176, 114 + 6 * 18, title);
      this.be = be;
      this.rule = rule;
      this.rows = 6;
      this.scroll = 0;
      for (let r = 0; r < 6; r++) for (let c = 0; c < 9; c++) {
        const k = r * 9 + c,
          at = () => this.scroll * 9 + k;
        this.slots.push({
          x: 8 + c * 18,
          y: 18 + r * 18,
          group: 'container',
          max: rule.max,
          get: () => at() < this.visual() ? be.slots[at()] : null,
          set: s => {
            be.slots[at()] = s;
          },
          accept: st => at() < this.visual() && this.accepts(at(), st)
        });
      }
      this.addPlayerSlots(31 + 6 * 18, 89 + 6 * 18);
      game.openChests.add(be.pos.join(','));
    }
    // the places shown: up to the last one used, plus one empty
    visual() {
      let n = 0;
      for (let i = 0; i < SIZE; i++) if (this.be.slots[i]) n = i + 1;
      return Math.min(SIZE, Math.max(1, n + 1));
    }
    accepts(i, st) {
      const R = this.rule;
      if (R.tag && !inTag(R.tag, st.id)) return false;
      if (R.unique) for (let j = 0; j < SIZE; j++) {
        const o = this.be.slots[j];
        if (o && j !== i && o.id === st.id) return false;
      }
      return true;
    }
    wheel(ui, d) {
      const rows = Math.ceil(this.visual() / 9);
      this.scroll = clamp(this.scroll + Math.sign(d), 0, Math.max(0, rows - 6));
    }
    owns(be) {
      return be === this.be;
    }
    drawBase(ui) {
      ui.dim(0.6);
      const c = ui.ctx,
        im = ui.img.generic_54,
        top = 17 + 6 * 18;
      c.drawImage(im, 0, 0, 176, top, this.x, this.y, 176, top);
      c.drawImage(im, 0, 126, 176, 96, this.x, this.y + top, 176, 96);
      // the places not open yet: darker
      const vis = this.visual();
      c.fillStyle = 'rgba(0,0,0,0.45)';
      for (let k = 0; k < 54; k++) if (this.scroll * 9 + k >= vis) c.fillRect(this.x + 7 + k % 9 * 18, this.y + 17 + Math.floor(k / 9) * 18, 18, 18);
      Font.draw(c, this.title, this.x + 8, this.y + 6, '#404040', false);
      const rows = Math.ceil(vis / 9),
        pg = this.scroll + 1 + '/' + Math.max(1, rows - 5);
      if (rows > 6) Font.draw(c, pg, this.x + 168 - Font.width(pg), this.y + 6, '#404040', false);
      Font.draw(c, '物品栏', this.x + 8, this.y + top + 3, '#404040', false);
    }
    close() {
      this.game.markBlockEntity(this.be);
      this.game.openChests.delete(this.be.pos.join(','));
      const p = this.be.pos;
      Sound.chest([p[0] + 0.5, p[1] + 0.5, p[2] + 0.5], false);
    }
  }
  self.TinkerChestScreen = TinkerChestScreen;
  for (const [key, rule] of Object.entries(CHESTS)) {
    const id = typeof BID !== 'undefined' ? BID[key] : undefined;
    if (id === undefined) continue;
    BLOCKS[id].onUse = function (g, x, y, z) {
      if (g.net) return false;
      const be = g.getBlockEntity(x, y, z, 'chest');
      if (be.slots.length < SIZE) be.slots = be.slots.concat(new Array(SIZE - be.slots.length).fill(null));
      g.ui.open(new TinkerChestScreen(g, be, rule, BLOCKS[id].cn));
      Sound.chest([x + 0.5, y + 0.5, z + 0.5], true);
      return true;
    };
  }
})();
