"""生成美术出图用的模板/参考图。

这些不是最终素材，是给美工（或你自己）对照规格用的：
  bg_template.png     背景图模板：1440x2560，标出「安全区」和会被裁掉的边
  frame_reference.png 场地框参考：692x1076，标出圆角位置和警戒线高度

用法：
    python tools/gen_art_templates.py
"""
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("需要 Pillow：pip install Pillow")
    sys.exit(1)

# —— 与 shared/config.js 保持一致的常量 ——
DESIGN_W, DESIGN_H = 720, 1280
PAD_X, TOP, BOTTOM = 14, 190, 14
CEIL_OFFSET = 34
CORNER = 18
FIELD_W = DESIGN_W - PAD_X * 2          # 692
FIELD_H = DESIGN_H - TOP - BOTTOM       # 1076
SCALE = 2                               # 背景图按 2 倍出
CEIL_Y_IN_FIELD = -CEIL_OFFSET          # 警戒线在场地矩形里的相对 y（负 = 在框外上方）

SAFE_X = 0.10      # 手机 20:9 时左右最多各裁 10%
SAFE_Y = 0.13      # 平板竖屏时上下最多各裁 13%


def load_font(size, bold=False):
    """Windows 上找一个带中文的字体，找不到就退回默认（英文仍可读）"""
    names = ["msyhbd.ttc" if bold else "msyh.ttc", "simhei.ttf", "simsun.ttc"]
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except Exception:
            continue
    return ImageFont.load_default()


def gen_bg_template(path):
    W, H = DESIGN_W * SCALE, DESIGN_H * SCALE
    img = Image.new("RGB", (W, H), (24, 20, 30))
    d = ImageDraw.Draw(img, "RGBA")

    # 竖向渐变，模拟"上暖下冷"的氛围底
    for y in range(H):
        t = y / (H - 1)
        r = int(24 + 26 * (1 - t))
        g = int(20 + 12 * (1 - t))
        b = int(30 + 34 * (1 - t))
        d.line([(0, y), (W, y)], fill=(r, g, b))

    # 会被裁掉的两个侧边（红色斜纹）
    cut = int(W * SAFE_X)
    for x in range(cut):
        if (x // 8) % 2 == 0:
            d.line([(x, 0), (x, H)], fill=(150, 40, 40, 90))
            d.line([(W - 1 - x, 0), (W - 1 - x, H)], fill=(150, 40, 40, 90))
    for y in range(int(H * SAFE_Y)):
        if (y // 8) % 2 == 0:
            d.line([(0, y), (W, y)], fill=(150, 90, 40, 70))
            d.line([(0, H - 1 - y), (W, H - 1 - y)], fill=(150, 90, 40, 70))

    # 安全区框
    x0, y0 = int(W * SAFE_X), int(H * SAFE_Y)
    x1, y1 = W - x0, H - y0
    d.rectangle([x0, y0, x1, y1], outline=(220, 190, 120, 200), width=3)

    # 关键位置叠加（转成背景图坐标：整体 ×SCALE）
    d.rectangle([PAD_X * SCALE, TOP * SCALE, (DESIGN_W - PAD_X) * SCALE, (DESIGN_H - BOTTOM) * SCALE],
                outline=(120, 100, 200, 120), width=2)
    ceil_y = (TOP - CEIL_OFFSET) * SCALE
    for x in range(0, W, 26):
        d.line([(x, ceil_y), (x + 13, ceil_y)], fill=(200, 170, 90, 160), width=2)

    f_big = load_font(38, True)
    f = load_font(26)
    f_s = load_font(20)
    d.text((x0 + 22, y0 + 22), "安全区：重要内容放这里面", font=f_big, fill=(235, 220, 180))
    d.text((x0 + 22, y0 + 72), "（手机 20:9 左右各裁 10%，平板竖屏上下各裁 13%）", font=f_s,
           fill=(200, 185, 150))
    d.text((x0 + 22, y0 + 112), "红色斜纹 = 超宽屏会裁掉", font=f_s, fill=(220, 140, 140))
    d.text((x0 + 22, y0 + 142), "橙色斜纹 = 方屏/横屏会裁掉", font=f_s, fill=(220, 170, 120))
    d.text((22, H - 62), "1440 x 2560 (9:16)  ·  主体建议居中偏上（底部会被球堆挡住）",
           font=f, fill=(210, 195, 160))

    # 顶部 HUD 区和底部场地的提示
    d.text((x0 + 22, ceil_y - 76), "↑ 警戒线以上是 HUD 区（标题/分数会盖在这，别放关键内容）",
           font=f_s, fill=(190, 175, 140))
    d.text((x0 + 22, int(H * (1 - SAFE_Y)) - 52), "↓ 底部这块会被球堆和场地压住", font=f_s,
           fill=(160, 150, 130))

    img.save(path)
    return W, H


def gen_frame_reference(path):
    W, H = FIELD_W, FIELD_H
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")

    # 场地区域：深色半透明，圆角与代码一致
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=CORNER, fill=(40, 28, 40, 190),
                        outline=(190, 150, 80, 150), width=3)

    # 右上/左上圆角要透明——用醒目色标出来，提醒别在这里画实心
    r = CORNER + 6
    for (cx, cy, anchor) in [(0, 0, "lt"), (W - 1, 0, "rt"), (0, H - 1, "lb"), (W - 1, H - 1, "rb")]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(230, 90, 90, 170), width=2)

    f = load_font(26)
    f_s = load_font(20)
    d.text((54, 40), "场地框贴图 692 x 1076", font=f, fill=(235, 220, 180))
    d.text((54, 80), "背景必须透明；四角要跟代码的圆角一致（半径 18）", font=f_s, fill=(205, 190, 155))
    d.text((54, 110), "红圈位置不要画实心，否则会露出直角", font=f_s, fill=(225, 130, 130))
    d.text((54, 150), "中间最好留空，球会盖满整个场地", font=f_s, fill=(205, 190, 155))
    d.text((54, H - 70), "尺寸 = 设计分辨率 720x1280 减去左右各 14px、上 190px、下 14px",
           font=f_s, fill=(180, 168, 140))

    img.save(path)
    return W, H


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), 'docs', 'art')
    os.makedirs(out, exist_ok=True)
    a = gen_bg_template(os.path.join(out, 'bg_template.png'))
    b = gen_frame_reference(os.path.join(out, 'frame_reference.png'))
    print("bg_template.png      %d x %d" % a)
    print("frame_reference.png  %d x %d" % b)
    print("输出目录：%s" % out)


if __name__ == '__main__':
    main()
