"""做一个「球描边方案」的示意图，并合成到真实游戏截图里。

用一个占位头像（几何色块）模拟 8 张不同的描边方案，放进实际球堆位置，
方便直观比较哪种描边在暗红背景上更容易分辨。

用法：
    python tools/stroke_preview.py <游戏截图路径> <输出图片路径>
"""
import math
import sys

from PIL import Image, ImageDraw, ImageFont

SRC = sys.argv[1]
OUT = sys.argv[2]

shot = Image.open(SRC).convert('RGB')
W, H = shot.size
S = W / 720.0

# 8 种方案：(说明, 方案类型, 主色)
#   方案 single_black  = 单层近黑
#   方案 single_theme  = 单层主题色
#   方案 double        = 外黑 + 内主题色
PLANS = [
    ('单层 近黑',        'single_black', (146, 66, 54)),
    ('单层 主题色',      'single_theme', (146, 66, 54)),
    ('双层 外黑6+内色10', 'double',       (146, 66, 54)),
    ('双层 外黑10+内色14', 'double',      (146, 66, 54)),
    ('双层 内色偏亮',     'double',       (200, 110, 90)),
    ('双层 内色偏暗',     'double',       (100, 44, 36)),
]


def draw_ball(size, plan, color):
    """画一个模拟球：方形底 + 圆形头像占位 + 描边"""
    SS = 2
    px = size * SS
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = px // 2

    # 圆形底色（角色主题色压暗）
    base = tuple(int(c * 0.55) for c in color)
    d.ellipse([1, 1, px - 2, px - 2], fill=base)

    # 头像占位：中间一块浅色 + 两个"眼睛"，用来判断头像有没有被描边挤小
    fg = tuple(min(255, int(c * 1.5)) for c in color)
    m = px * 0.16
    d.ellipse([m, m, px - m, px - m], fill=tuple(min(255, c + 60) for c in fg))
    er = px * 0.045
    for ex in (0.38, 0.62):
        d.ellipse([px * ex - er, px * 0.42 - er, px * ex + er, px * 0.42 + er],
                  fill=(30, 20, 18))
    d.arc([px * 0.36, px * 0.56, px * 0.64, px * 0.72], 200, 340,
          fill=(30, 20, 18), width=max(1, int(px * 0.012)))

    # —— 描边 ——
    def ring(width, col):
        for k in range(width):
            rr = r - 1 - k
            if rr < 2:
                break
            d.ellipse([r - rr, r - rr, r + rr, r + rr], outline=col, width=1)

    if plan == 'single_black':
        ring(int(size * 0.035), (18, 8, 10, 255))
    elif plan == 'single_theme':
        ring(int(size * 0.035), color + (255,))
    else:  # double
        outer = int(size * 0.014)          # 外黑 6~10px（512 折算）
        inner = int(size * 0.024)          # 内色 10~14px
        ring(outer, (18, 8, 10, 255))
        # 内层往里挪，紧贴外层内侧
        for k in range(inner):
            rr = r - 1 - outer - k
            if rr < 2:
                break
            d.ellipse([r - rr, r - rr, r + rr, r + rr], outline=color + (255,), width=1)

    return im.resize((size, size), Image.LANCZOS)


# 摆放：左侧两列，背景是暗红剧场（最能看出分辨度）
COLS = [(46, 430), (46, 530), (46, 630), (250, 430), (250, 530), (250, 630)]
BALL = 104
for i, (label, plan, color) in enumerate(PLANS):
    ball = draw_ball(BALL, plan, color)
    s = int(BALL * S)
    ball = ball.resize((s, s), Image.LANCZOS)
    cx, cy = COLS[i]
    shot.paste(ball, (int(cx * S) - s // 2, int(cy * S) - s // 2), ball)

# 标注
try:
    f = ImageFont.truetype('msyh.ttc', max(13, int(15 * S)))
except Exception:
    f = ImageFont.load_default()
d = ImageDraw.Draw(shot)
for (label, plan, color), (cx, cy) in zip(PLANS, COLS):
    d.text((int(cx * S) - int(52 * S), int(cy * S) + int(BALL * 0.62 * S)), label,
           font=f, fill=(240, 230, 200))

shot.save(OUT, quality=94)
print('已生成 %s' % OUT)
