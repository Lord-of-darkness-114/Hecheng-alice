"""生成 App 图标（用游戏自己的球体贴图，风格和游戏一致）。

素材：blacksouls-suika/web/assets/tiers/tier8.webp（爱丽丝，768x768 RGBA）
产出（Android 各密度）：
    app/res/mipmap-<密度>/ic_launcher.png   传统图标（深色圆底 + 血光 + 球）
    app/res/mipmap-<密度>/ic_fg.png         自适应图标·前景（只留球，四周留安全区）
    app/res/mipmap-<密度>/ic_bg.png         自适应图标·背景（深色 + 血光）
    app/res/values/colors.xml               （备用纯色背景）
    app/res/mipmap-anydpi-v26/ic_launcher.xml   自适应图标声明（Android 8+）

用法：python make_icon.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)            # ...\blacksouls-suika
SRC = os.path.join(GAME, 'web', 'assets', 'tiers', 'tier8.webp')
RES = os.path.join(HERE, 'app', 'res')

DENS = [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]
BG = (12, 10, 16, 255)      # 和游戏背景同色 #0c0a10
GLOW = (146, 26, 34)        # 血红 #921a22


def load_ball(size):
    im = Image.open(SRC).convert('RGBA')
    box = im.split()[-1].getbbox()          # 只取球的实际范围，避免透明边浪费
    if box:
        im = im.crop(box)
    s = max(im.width, im.height)
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((s - im.width) // 2, (s - im.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def glow_layer(px, cy=0.66, alpha=150):
    g = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    d.ellipse([px * 0.06, px * (cy - 0.20), px * 0.94, px * (cy + 0.36)], fill=GLOW + (alpha,))
    return g.filter(ImageFilter.GaussianBlur(px * 0.09))


def legacy_icon(px):
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse([0, 0, px - 1, px - 1], fill=BG)
    im.alpha_composite(glow_layer(px))
    b = load_ball(int(px * 0.76))
    im.alpha_composite(b, ((px - b.width) // 2, (px - b.height) // 2))
    return im


def adaptive_fg(px):
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    b = load_ball(int(px * 0.60))            # 自适应图标会被裁掉四周，球只占 60%
    im.alpha_composite(b, ((px - b.width) // 2, (px - b.height) // 2))
    return im


def adaptive_bg(px):
    im = Image.new('RGBA', (px, px), BG)
    im.alpha_composite(glow_layer(px, cy=0.60, alpha=170))
    return im


def main():
    if not os.path.exists(SRC):
        raise SystemExit('找不到球体贴图: ' + SRC)

    for name, scale in DENS:
        d = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(d, exist_ok=True)
        legacy_icon(int(48 * scale)).save(os.path.join(d, 'ic_launcher.png'))
        adaptive_fg(int(108 * scale)).save(os.path.join(d, 'ic_fg.png'))
        adaptive_bg(int(108 * scale)).save(os.path.join(d, 'ic_bg.png'))
        print('  mipmap-%-8s ic_launcher %dpx  ic_fg %dpx  ic_bg %dpx'
              % (name, int(48 * scale), int(108 * scale), int(108 * scale)))

    os.makedirs(os.path.join(RES, 'values'), exist_ok=True)
    with open(os.path.join(RES, 'values', 'colors.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<resources>\n'
                '    <color name="iconBg">#FF0C0A10</color>\n'
                '</resources>\n')

    d = os.path.join(RES, 'mipmap-anydpi-v26')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'ic_launcher.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@mipmap/ic_bg" />\n'
                '    <foreground android:drawable="@mipmap/ic_fg" />\n'
                '</adaptive-icon>\n')
    print('  自适应图标声明 + colors.xml 就绪')
    print('图标输出目录:', RES)


if __name__ == '__main__':
    main()
