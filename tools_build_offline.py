#!/usr/bin/env python3
"""把 index.html（多文件站点）打成单文件 opusmc-offline.html：所有 js/*.js 内联，顺便让区块线程在 file:// 下也能启动。

用法：python3 tools_build_offline.py [输出文件名]
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else 'opusmc-offline.html'

WORKER_FILES = ['assets.js', 'util.js', 'worldgen_data.js', 'worldgen.js', 'blockdata.js', 'blocks.js', 'world.js',
                'mesher.js', 'models.js', 'vmodels.js', 'structures_data.js', 'structgen.js', 'structtypes.js',
                'features.js', 'trees.js', 'chunk_worker.js']


def read(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


def script_text(name):
    """读取 js/<name>；它被包在 <script> 里时不能出现未被转义的 </script>。"""
    return read('js/' + name).replace('</script', '<\\/script')


def collect_worker():
    """worker 需要的脚本：只取存在的那几个，缺失的在 worker 里会报出名字。"""
    out = {}
    for name in WORKER_FILES:
        p = os.path.join(ROOT, 'js', name)
        if os.path.exists(p):
            out[name] = read('js/' + name)
    # 模组 data.js 的源码：页面把它们内嵌在「mods data」段里，worker 用 importScripts 取同一份
    for key, text in mod_sources().items():
        out['../' + key] = text
    return out


def mod_sources():
    """从 index.html 的「mods data」段取回每个模组的 data.js 文本（页面的 document.write 就是用它注册的）。"""
    s = read('index.html')
    i = s.find('/* ==== mods data ==== */')
    j = s.find('</script>', i)
    seg = s[i:j]
    pat = re.compile(r';try\{window\.__SRCS=window\.__SRCS\|\|\{\};window\.__SRCS\["(mods/[^"]+)"\]='
                     r'document\.currentScript\.textContent;\}catch\(e\)\{\}\s*;?')
    out, start = {}, 0
    for m in pat.finditer(seg):
        out[m.group(1)] = seg[start:m.start()]
        start = m.end()
    return out


CW_BOOT = r"""
<script>
/* 本地单文件版：区块线程的脚本随页面内嵌在 window.__CW_SRCS。
   file:// 下浏览器不允许 new Worker('js/chunk_worker.js')，页面里的变量也进不了 worker，
   所以每个脚本各做成一个 data: URL，worker 用 importScripts 取它们：跑的是真正的脚本，
   没有把十几 MB 的源码当字符串 eval。 */
(function () {
  'use strict';
  var CW = window.__CW_SRCS;
  var Native = window.Worker;
  if (!CW || !Native || window.__CW_PATCHED) return;
  window.__CW_PATCHED = true;

  // data: URL 里不能有 % 和 #，编码交给 encodeURIComponent
  function dataUrl(name) {
    return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(CW[name]);
  }

  var urls = {};
  for (var f in CW) urls[f] = dataUrl(f);

  var BOOT = [
    'var __u = ' + JSON.stringify(urls) + ';',
    'var __native = importScripts;',
    'self.importScripts = function () {',
    '  var a = [];',
    '  for (var i = 0; i < arguments.length; i++) {',
    '    var n = String(arguments[i]).replace(/^\\.\\//, "");',
    '    if (!__u[n]) throw new Error("missing worker script " + n);',
    '    a.push(__u[n]);',
    '  }',
    '  __native.apply(self, a);',
    '};',
    '(function () {',
    '  var ids = self.__CW_MODS ? self.__CW_MODS.split(",").filter(function (x) { return /^[a-z0-9_]{1,32}$/.test(x); }) : [];',
    '  for (var i = 0; i < ids.length; i++) {',
    '    var n = "../mods/" + ids[i] + "/data.js";',
    '    if (__u[n]) __native.call(self, __u[n]);',
    '  }',
    '})();',
    '__native.call(self, __u["chunk_worker.js"]);',
    ''
  ].join('\n');

  var patched = function (url, opts) {
    if (typeof url !== 'string' || url.indexOf('js/chunk_worker.js') !== 0) return new Native(url, opts);
    var q = /[?&]mods=([a-z0-9_,]+)/.exec(url);
    var head = 'self.__CW_MODS = ' + JSON.stringify(q ? q[1] : '') + ';\n';
    var bootUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(head + BOOT);
    try { return new Native(bootUrl, opts); } catch (e) {
      console.error('[CW] worker 启动失败', e);
      throw e;
    }
  };
  patched.prototype = Native.prototype;
  window.Worker = patched;
})();
</script>
"""






def main():
    html = read('index.html')

    # 1) 所有 <script src="js/x.js"> 换成内联
    missing = []

    def inline(m):
        name = m.group(1)
        p = os.path.join(ROOT, 'js', name)
        if not os.path.exists(p):
            missing.append(name)
            return m.group(0)
        return '<script>\n' + script_text(name) + '\n</script>'

    html = re.sub(r'<script src="js/([^"?]+)(?:\?[^"]*)?"></script>', inline, html)
    if missing:
        print('缺少的脚本:', missing)

    # 2) 区块线程脚本字典 + worker 构造替换（放在 mods.js 之前，Worker 在任何世界生成前就已被接管）
    # 补丁必须在游戏创建区块线程之前执行：放到 body 里第一个脚本之前
    cw = collect_worker()
    boot = '<script>window.__CW_SRCS=' + json_dump(cw) + ';</script>\n' + CW_BOOT
    anchor = '<script>window.__MODFILES='
    if anchor not in html:
        raise SystemExit('找不到内嵌脚本锚点，打包中止')
    html = html.replace(anchor, boot + anchor, 1)

    with open(os.path.join(ROOT, OUT), 'w', encoding='utf-8') as f:
        f.write(html)
    print('%s  %.1f MB' % (OUT, os.path.getsize(os.path.join(ROOT, OUT)) / 1048576))


def json_dump(obj):
    import json
    return json.dumps(obj, ensure_ascii=False)


if __name__ == '__main__':
    main()
