'use strict';

// 夜视 (our own, no one else's code or art): a world with it on is lit as under a night vision potion that never ends -
// caves, the night, the nether as bright as their brightest light allows. The sky, the stars and the fog keep their
// time of day; blindness and darkness still close in. Single player only, as every mod (in a room: the potion's own).
(function () {
  if (typeof nightVisionScale !== 'function') return;
  const potion = nightVisionScale;
  const on = () => !(self.game && self.game.net);
  // the vanilla light table (render.js updateLightmap) and the shader pack both read it (env.nightVision): always full,
  // without the potion's flicker in its last seconds
  nightVisionScale = function (p) {
    const v = potion(p);
    return on() ? Math.max(v, 1) : v;
  };
  // 光影: the pack's night vision is a dim blue floor light (fxShade minL, 0.5 0.5 0.75 at 1), a dark cave came out at
  // three quarters of the vanilla one; twice it is as bright as vanilla's (11-08: a sealed stone room at midnight, mean
  // luma 10 bare -> 100 vanilla, 74 -> 102 光影 低 to 极限), the noon sun outside 7% more, faces keep their shading
  const K = 2;
  if (typeof ShaderPack === 'function' && ShaderPack.prototype.setLightUniforms) {
    const slu = ShaderPack.prototype.setLightUniforms;
    ShaderPack.prototype.setLightUniforms = function (P) {
      slu.call(this, P);
      const nv = this.env && this.env.nightVision,
        A = this.A;
      if (nv > 0 && on() && P.u.u_tf2) this.r.gl.uniform4f(P.u.u_tf2, A.vsB, nv * K, A.invNoon2, A.dim);
    };
  }
})();
