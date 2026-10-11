"""把 8 张球体贴图按**游戏内实际渲染尺寸**排成一张阶梯图。

用途：直观确认尺寸曲线合不合理、缩到小尺寸后还能不能认出来。

用法：
    python tools/tier_ladder.py [输出png]
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIERS_DIR = os.path.join(ROOT, 'web', 'assets', 'tiers')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', '_ladder.png')

# 与 config.js 的 G.THEME.tiers[].radius 对应（逻辑像素半径）
RADII = [27, 37, 50, 64, 80, 99, 120, 145]
NAMES = ['艾露玛', '古兹', '维多利亚', '伊丽莎白', '多萝茜', '蕾克', '库嘻嘻', '爱丽丝']
DPR = 2          # 按 2 倍屏模拟
PAD = 22         # 贴图自带的边距比例（和 render.js 一致：半径 × 0.22）
BG = (22, 10, 14, 255)


def find(tier):
    for ext in ('.webp', '.png', '.jpg', '.jpeg'):
        p = os.path.join(TIERS_DIR, 'tier%d%s' % (tier, ext))
        if os.path.exists(p):
            return p
    return None


def main():
    balls = []
    for i, r in enumerate(RADII):
        p = find(i + 1)
        if not p:
            print('缺少 tier%d，跳过' % (i + 1))
            continue
        im = Image.open(p).convert('RGBA')
        # 游戏里整张方形贴图被缩放到 (半径 + 半径×0.22) × 2，再乘以屏幕像素比
        target = int((r + r * PAD / 100.0) * 2 * DPR)
        balls.append((i + 1, NAMES[i], r, im.resize((target, target), Image.LANCZOS)))

    gap = 26
    W = sum(b[3].width for b in balls) + gap * (len(balls) + 1)
    H = max(b[3].height for b in balls) + 70
    sheet = Image.new('RGBA', (W, H), BG)
    d = ImageDraw.Draw(sheet)
    try:
        f = ImageFont.truetype('msyh.ttc', 20)
        fs = ImageFont.truetype('msyh.ttc', 15)
    except Exception:
        f = fs = ImageFont.load_default()

    x = gap
    for tier, name, r, im in balls:
        y = (H - 70 - im.height) // 2 + 10
        sheet.alpha_composite(im, (x, y))
        label = 'tier%d %s' % (tier, name)
        d.text((x, H - 52), label, font=f, fill=(240, 232, 205))
        d.text((x, H - 28), '%dpx 半径' % r, font=fs, fill=(170, 158, 130))
        x += im.width + gap

    sheet.convert('RGB').save(OUT, quality=95)
    print('已生成 %s  (%d x %d)' % (OUT, W, H))


if __name__ == '__main__':
    main()
