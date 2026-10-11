"""把几张候选图排成一张对比图，方便一眼挑。

用法：
    python tools/contact_sheet.py <输出jpg> <图1> <图2> ...
"""
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("需要 Pillow")
    sys.exit(1)


def font(size):
    for n in ("msyhbd.ttc", "msyh.ttc", "simhei.ttf"):
        try:
            return ImageFont.truetype(n, size)
        except Exception:
            continue
    return ImageFont.load_default()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    out, files = sys.argv[1], sys.argv[2:]
    TH = 640                                     # 每张缩略图高度
    pad, label_h = 16, 46
    thumbs = []
    for f in files:
        im = Image.open(f).convert("RGB")
        w = int(im.width * TH / im.height)
        thumbs.append((os.path.basename(f), im.resize((w, TH), Image.LANCZOS)))

    W = pad + sum(t[1].width + pad for t in thumbs)
    H = TH + label_h + pad * 2
    sheet = Image.new("RGB", (W, H), (22, 20, 26))
    d = ImageDraw.Draw(sheet)
    f = font(22)
    x = pad
    for name, im in thumbs:
        sheet.paste(im, (x, pad))
        d.text((x + 2, pad + TH + 10), name, font=f, fill=(230, 220, 190))
        x += im.width + pad
    sheet.save(out, quality=92)
    print("已生成 %s  (%d x %d)" % (out, W, H))
    return 0


if __name__ == '__main__':
    sys.exit(main())
