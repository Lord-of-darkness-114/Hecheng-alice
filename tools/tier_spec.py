"""列出 8 个阶级的半径，并算出建议的贴图尺寸。

用法：
    python tools/tier_spec.py
"""
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'shared' / 'config.js'

text = CONFIG.read_text(encoding='utf-8')
# 注意：G.ASSETS 里也有一个 tiers 数组（贴图路径），要取 G.THEME 里那个带 name 的
idx = text.find("name: '")
block = text[idx:]
end = block.find('\n    ]')
block = block[:end if end > 0 else len(block)]

rows = []
for line in block.splitlines():
    m = re.search(r"name:\s*'([^']+)'.*?radius:\s*(\d+)", line)
    if m:
        rows.append((m.group(1), int(m.group(2))))

print('阶  角色名       逻辑半径   最大屏幕直径(3x屏)   建议贴图边长')
print('-' * 66)
for i, (name, r) in enumerate(rows, start=1):
    maxd = r * 2 * 3                      # 3 倍屏时的物理像素直径
    size = 256
    while size < maxd:
        size *= 2
    print('%d   %-10s  %4d px      %5d px           %d x %d' % (i, name, r, maxd, size, size))

print()
print('说明：')
print('  · drawBall 会把整张**方形**贴图缩放到 (半径 + pad) × 2，pad = 半径 × 0.22')
print('  · 所以贴图里的球体要**占满整个画布**，四周不要自己留透明边')
print('  · 图会被轻微缩放（小阶缩得少、大阶缩得多），矢量感的画法最耐缩')
