"""生成两张**测试用**贴图，用来验证「背景层 + 场地框」的贴图管线通了。

这不是最终素材，只是替身：
  bg.png     1440x2560 的背景图
  frame.png  692x1076 的场地框（中间透明，球会从透明处露出来）

验证完可以删掉，游戏会自动回退到代码画的占位背景/底色。
想再生成一次就重跑本脚本。

用法：
    python tools/gen_placeholder_art.py
"""
import math
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("需要 Pillow：pip install Pillow")
    sys.exit(1)

DESIGN_W, DESIGN_H = 720, 1280
PAD_X, TOP, BOTTOM = 14, 190, 14
CEIL_OFFSET = 34
CORNER = 18
FIELD_W = DESIGN_W - PAD_X * 2
FIELD_H = DESIGN_H - TOP - BOTTOM
SS = 2       # 超采样，圆角和描边更干净


def gen_bg(path):
    """背景图：上暖下冷的夜色 + 顶部烛光 + 一点石壁纹理"""
    W, H = 1440, 2560
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        # 从暗紫 -> 近黑
        r = int(30 * (1 - t) + 8 * t)
        g = int(22 * (1 - t) + 6 * t)
        b = int(40 * (1 - t) + 12 * t)
        for x in range(W):
            px[x, y] = (r, g, b)

    d = ImageDraw.Draw(img, "RGBA")
    # 顶部烛光
    for i in range(40):
        k = i / 40.0
        rad = int(W * (0.15 + 0.5 * k))
        alpha = int(26 * (1 - k))
        d.ellipse([W / 2 - rad, -rad * 0.5, W / 2 + rad, rad * 0.6],
                  fill=(201, 162, 39, alpha))
    # 两侧石壁竖纹
    for x in range(0, W, 46):
        a = 14 if (x // 46) % 2 == 0 else 6
        d.line([(x, 0), (x, H)], fill=(120, 100, 80, a))
    # 底部渐隐到更黑（球堆在这，压暗一点更耐看）
    for i in range(360):
        y = H - 360 + i
        d.line([(0, y), (W, y)], fill=(4, 3, 6, int(150 * (i / 360.0))))
    img.save(path)
    return W, H


def gen_frame(path):
    """场地框：透明中间 + 金色双线 + 四角装饰，圆角与代码一致"""
    W, H = FIELD_W * SS, FIELD_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    r = CORNER * SS

    # 场地底色：很淡的一层，让球堆有个"池子"的感觉
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=r, fill=(18, 12, 20, 150))
    # 双线描边
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=r, outline=(196, 158, 88, 210), width=3 * SS)
    d.rounded_rectangle([6 * SS, 6 * SS, W - 1 - 6 * SS, H - 1 - 6 * SS], radius=max(2, r - 6 * SS),
                        outline=(196, 158, 88, 90), width=1 * SS)
    # 四角小装饰
    for (cx, cy, sx, sy) in [(0, 0, 1, 1), (W - 1, 0, -1, 1), (0, H - 1, 1, -1), (W - 1, H - 1, -1, -1)]:
        L = 46 * SS
        o = 14 * SS
        d.line([(cx + sx * o, cy + sy * o), (cx + sx * (o + L), cy + sy * o)],
               fill=(232, 205, 140, 220), width=2 * SS)
        d.line([(cx + sx * o, cy + sy * o), (cx + sx * o, cy + sy * (o + L))],
               fill=(232, 205, 140, 220), width=2 * SS)

    img = img.resize((FIELD_W, FIELD_H), Image.LANCZOS)
    img.save(path)
    return FIELD_W, FIELD_H


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), 'web', 'assets')
    os.makedirs(out, exist_ok=True)
    a = gen_bg(os.path.join(out, 'bg.png'))
    b = gen_frame(os.path.join(out, 'frame.png'))
    print("bg.png     %d x %d" % a)
    print("frame.png  %d x %d" % b)
    print("输出目录：%s" % out)
    print("（这是测试贴图，随时可以删掉换成你自己的）")


if __name__ == '__main__':
    main()
