"""检查警戒线是否变淡：比较判定线那一行与它上方背景的亮度差。

用法：
    python tools/check_ceiling.py <截图路径>
"""
import pathlib
import sys

from PIL import Image

im = Image.open(sys.argv[1]).convert('RGB')
W, H = im.size
S = W / 720.0
y = int(156 * S)                      # 逻辑 y=156 就是警戒线
xs = list(range(int(80 * S), int(140 * S), 3))


def row_avg(dy):
    return sum(sum(im.getpixel((x, y + dy))) // 3 for x in xs) // len(xs)


line = row_avg(0)
above = row_avg(-6)
below = row_avg(6)
print('截图 %dx%d  scale=%.3f' % (W, H, S))
print('  警戒线那一行 (y=%d)  平均亮度 %d' % (y, line))
print('  上方 6px 背景         平均亮度 %d' % above)
print('  下方 6px 背景         平均亮度 %d' % below)
print('  差值（越小说明线越淡）: 上 %+d / 下 %+d' % (line - above, line - below))
