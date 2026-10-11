"""临时诊断脚本 v2：量"球体可见圆"的真实直径。

v1 用 alpha.getbbox() 量，会被四角极淡的光晕骗成"占满画布"。
这里改成沿中线扫描 alpha 阈值，看球体实心部分到底多大。
"""
import os
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def scan(alpha_px, size, threshold):
    """沿水平中线、垂直中线找 alpha>threshold 的范围，返回直径（像素）"""
    w, h = size
    cx, cy = w // 2, h // 2
    xs = [x for x in range(w) if alpha_px[x, cy] > threshold]
    ys = [y for y in range(h) if alpha_px[cx, y] > threshold]
    if not xs or not ys:
        return 0, 0
    return (xs[-1] - xs[0] + 1), (ys[-1] - ys[0] + 1)

print("tier  画布      角alpha  直径@32   直径@128   可见占比@32  ballArtScale应设为")
print("-" * 82)
for i in range(1, 9):
    p = os.path.join(root, 'web', 'assets', 'tiers', 'tier%d.webp' % i)
    if not os.path.exists(p):
        print("tier%d 缺失" % i)
        continue
    im = Image.open(p).convert('RGBA')
    w, h = im.size
    alpha = im.split()[3]
    ap = alpha.load()
    corner = ap[0, 0]
    d32 = scan(ap, (w, h), 32)[0]
    d128 = scan(ap, (w, h), 128)[0]
    ratio = d32 / float(w)
    # 让"可见球"等于碰撞直径，需要乘以 1/ratio
    print("tier%d  %4dx%-4d  %3d      %4d      %4d       %.3f        x%.3f"
          % (i, w, h, corner, d32, d128, ratio, 1.0 / ratio))
print()
print("ballArtScale 该设成几 = 让可见球直径等于碰撞直径所需倍数（上表最后一列）。")
