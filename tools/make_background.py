"""把横版原图做成 9:16 游戏背景图（1440x2560），一次到位。

关键约束（踩过的坑）：
  1. 输出的图**必须正好 1440x2560**。游戏是「等比铺满 + 居中裁剪」，
     尺寸比例不对就会再裁一次 —— 原图的标题就会被切掉两边。
  2. 原图是 4:3，塞进 9:16 必然有大量空白。
     解法：原图**按画布宽度铺满**（不拉伸、不裁切），
     下面空的部分用"原图底部内容向下延展 + 渐隐到暗红"补上。
     这样原图的构图 100% 保留，标题也永远不会被切。

用法：
    python tools/make_background.py <源图路径> <输出png> [--ratio 0.05]
      --ratio  原图顶边放在画布高度的百分之几处（默认 0.04）
"""
import os
import sys

try:
    from PIL import Image, ImageFilter
except ImportError:
    print("需要 Pillow：pip install Pillow")
    sys.exit(1)

OUT_W, OUT_H = 1440, 2560
DARK = (18, 5, 8)            # 底部渐隐的终点色（暗红偏黑）


def make(src, ratio=0.04, extend_blur=140, fade_from=0.42):
    img = Image.open(src).convert("RGB")
    # 按画布宽度等比缩放：这样一张 9:16 的图放进游戏，任何屏幕都不会再裁切
    k = OUT_W / img.width
    art = img.resize((OUT_W, max(1, int(img.height * k + 0.5))), Image.LANCZOS)

    canvas = Image.new("RGB", (OUT_W, OUT_H), DARK)
    top = int(OUT_H * ratio)

    # —— 底部延展：把原图最后几行拉长 + 模糊，作为从画面到暗色的过渡 ——
    if extend_blur > 0 and art.height > 10:
        strip = art.crop((0, art.height - 6, OUT_W, art.height)).resize(
            (OUT_W, extend_blur), Image.LANCZOS).filter(ImageFilter.GaussianBlur(18))
        canvas.paste(strip, (0, top + art.height))

    canvas.paste(art, (0, top))

    # —— 画面以下整体渐隐到暗红，避免出现"半截图 + 突然变黑" ——
    start = top + art.height + extend_blur
    span = max(1, OUT_H - start)
    grad = Image.new("RGB", (OUT_W, span))
    gp = grad.load()
    cp = canvas.load()
    for y in range(span):
        t = y / (span - 1.0)
        t = t ** 0.75
        for x in range(OUT_W):
            r, g, b = cp[x, start + y]
            gp[x, y] = (int(r + (DARK[0] - r) * t),
                        int(g + (DARK[1] - g) * t),
                        int(b + (DARK[2] - b) * t))
    canvas.paste(grad, (0, start))

    # —— HUD 区（上半部）压一层暗，保证白色分数和标题读得清 ——
    hud_h = int(OUT_H * 0.06 - 190)
    if hud_h > 0:
        region = canvas.crop((0, 0, OUT_W, hud_h))
        canvas.paste(Image.blend(region, Image.new("RGB", (OUT_W, hud_h), (0, 0, 0)), 0.20),
                     (0, 0))
    return canvas, top, art.height


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    src, out = sys.argv[1], sys.argv[2]
    ratio = 0.04
    if '--ratio' in sys.argv:
        ratio = float(sys.argv[sys.argv.index('--ratio') + 1])

    im, top, ah = make(src, ratio)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, quality=94)
    print("源图    : %s" % os.path.basename(src))
    print("输出    : %dx%d（游戏要求正好这个尺寸）  %.0f KB"
          % (im.width, im.height, os.path.getsize(out) / 1024.0))
    print("原图位置: 顶边 y=%d，底边 y=%d（画布高 %d）" % (top, top + ah, OUT_H))
    print("提示    : 原图以下会渐隐到暗红，那块在游戏里基本被场地盖住")
    return 0


if __name__ == '__main__':
    sys.exit(main())
