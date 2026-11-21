#!/usr/bin/env python3
# 从 opusmc-source/index.html 抽取「非内联大数据」部分，生成精简 index.html
# 做法：按 script 块切分，丢弃 mods data / bundle / armor / __MODFILES 等内联大数据块，
#      用真实 js/*.js 与 mods/<id>/*.js 外链替代；其余内联小脚本（shim/标题动画/fflate/模组导入/armor穿戴层）保留。
import re, io, os, sys

SRC = '/root/workspace/opusmc-source/index.html'
OUT = '/root/workspace/opusMC-Remastered-Edition/index.html'

h = open(SRC, encoding='utf-8').read()

# --- 1. 切出所有 script 块 ---
blocks = []
for m in re.finditer(r'<script\b[^>]*>', h):
    st = m.start()
    en = h.find('</script>', m.end())
    if en < 0:
        break
    src = re.search(r'src="([^"]*)"', m.group(0))
    blocks.append(dict(a=st, b=en + 9, src=src.group(1) if src else None))

# --- 2. 需要丢弃的内联大数据块（按起始内容识别）---
DROP_PREFIX = [
    '<script>window.__MODFILES={"mods/',
    "<script> /* ==== mods data ==== */",
    "<script>window.__BUILTIN_MODS = [",
    "<script> /* ==== tconstruct bundle (inline) ==== */",
    "<script> /* ==== farmersdelight bundle (inline) ==== */",
    "<script> /* ==== mods code ==== */",
]
# 需要保留的内联块（其余大块默认丢弃）
KEEP_MARK = [
    '/* ==== YYMC 标题背景动画',     # 标题星空动画
    '/* ==== fflate (zip 解包) ==== */',
    '/* ==== YYMC 模组导入 ==== */',
    '/* 沉浸盔甲：20 张专属穿戴层贴图',
    '/* 本地版：联机服务地址见',
    '/* YYMC 用户模组：数据段 */',
    '// the loading bar:',
]

def block_text(B):
    return h[B['a']:B['b']]

def is_drop(B):
    t = block_text(B)
    if B['src']:
        return False
    for p in DROP_PREFIX:
        if t.startswith(p):
            return True
    return False

# --- 3. 组装输出 ---
out = []
pos = 0
mods_injected_data = False
mods_injected_code = False
seen_modapi = False

def emit_script(fname):
    return '<script src="%s"></script>\n' % fname

for B in blocks:
    # 块之间的 HTML（doctype/head/style/body 元素）
    out.append(h[pos:B['a']])
    pos = B['b']

    if is_drop(B):
        # 丢弃：mods data 段由 Mods.stage 动态注入；bundle 由 mods code 里的 document.write 加载
        continue

    if B['src']:
        s = B['src']
        if s == 'js/cloudsave.js':
            out.append(emit_script('js/cloud-github.js'))
        elif s.startswith('mods/'):
            # bundle 的 document.write 字符串内部伪标签，丢弃（真加载由 code.js 做）
            continue
        else:
            out.append(emit_script(s))
        if s == 'js/modapi.js':
            # modapi 之后立刻注入各 mod 的 data.js（等价于原内联 mods data 段的位置与时机）
            out.append("<script>Mods.stage('data');</script>\n")
            mods_injected_data = True
        if s == 'js/mods_ui.js':
            out.append("<script>Mods.stage('code');</script>\n")
            mods_injected_code = True
        continue

    t = block_text(B)
    if any(k in t for k in KEEP_MARK):
        out.append(t)
        out.append('\n')
    # 其余内联块（兼容 shim / 缩放 / 遥测 / 启动计数等小脚本）也保留
    elif len(t) < 40000:
        out.append(t)
        out.append('\n')

out.append(h[pos:])

res = ''.join(out)

# --- 4. 检查注入点 ---
if 'Mods.stage(\'data\')' not in res:
    print('!! 缺少 Mods.stage(data) 注入点', file=sys.stderr)
if 'Mods.stage(\'code\')' not in res:
    print('!! 缺少 Mods.stage(code) 注入点', file=sys.stderr)

open(OUT, 'w', encoding='utf-8').write(res)
print('写入', OUT, len(res), 'bytes (原', len(h), ')')
