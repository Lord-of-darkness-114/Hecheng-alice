"""生成场地框贴图（锁链 + 荆棘纹章）。

尺寸固定 692 x 1076（= 设计分辨率 720x1280 减左右各 14、上 190、下 14），
中间透明，球会从透明处露出来。

做法：
  * 四边铺一圈"环环相扣"的锁链。每个链环画两遍 —— 先画远的一半（暗），
    再画近的一半（带高光），叠出真实的穿插感。
  * 四角放荆棘纹章，盖住四边的接缝。
  * 5 倍超采样后缩到目标尺寸，边缘干净不毛糙。

用法：
    python tools/gen_frame.py                # 生成所有配色变体
    python tools/gen_frame.py --install gold # 生成并装进工程当场地框
"""
import math
import os
import shutil
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("需要 Pillow：pip install Pillow")
    sys.exit(1)

FIELD_W, FIELD_H = 692, 1076
CORNER = 18          # 必须和 config.js 的 G.LAYOUT.cornerRadius 一致
SS = 5               # 超采样倍数

# 锁链的尺度（都相对于场地短边 692）
# 锁链的尺度（都相对于场地短边 692）
# ★ 关键约束：链环要能看出"环"，必须满足
#     环外形半高 - 线粗 > 1.5px      （环中间得有空心，否则变成实心珠子）
#     线粗 >= 4px                    （高光和暗部才画得出来）
#   两条一起约束下来，链带总宽至少要 14~16px。想更细就只能是"珠链"了。
SPAN_R = 0.0350       # 半间距 → 环中心距约 48px（环距大一点，穿插关系才看得清）
FACE_W_R = 0.44       # 正环：短轴 / 半间距（正面对着观众，宽而亮）
EDGE_W_R = 0.20       # 侧环：短轴 / 半间距（立着，窄而暗 —— 关键对比）
LINK_TH_R = 0.100     # 线粗 / 半间距（约 2.4px）

# ★ 链带**中心**离贴图边缘的像素数。
# 取值 = 链带半宽（约 6.5），让链带的**外缘正好贴住画布边缘**。
#
# 这样安排的理由：
#   * 场地判定线在 x = 14，链带占 0 ~ 13.1 → 判定线从链子内侧边缘切过
#   * 球的视觉边缘最远到 x ≈ 15.2（物理边界 14 + 贴图自带的内缩），
#     所以球压不到链子（0~13.1）—— 球堆再高，锁链也完整露着
# 踩过的坑：一度把中心设成 15.5（对齐判定线），结果整条链被推进场内
# 9px，反而更容易被球盖住。方向搞反了。
CHAIN_CENTER = 5.5

# —— 锁链微光 ——
# 数值越大越亮/越散。0 = 完全不发光。
# 目的：骨白链子在暗红背景上对比太硬，加一层微光看着柔和些。
GLOW_STRENGTH = 0.5     # 亮度（0~1）
GLOW_BLUR = 2.2         # 扩散半径（逻辑像素）

STYLES = {
    'gold': {
        'label': '古铜金',
        'base': (172, 138, 66), 'dark': (78, 56, 24), 'light': (248, 224, 158),
        'glow': (201, 162, 39, 46), 'medal': (198, 160, 90),
        'gear': (140, 92, 36), 'gear_dark': (62, 34, 14), 'gear_light': (226, 186, 120),
    },
    'iron': {
        'label': '暗铁',
        'base': (124, 122, 128), 'dark': (44, 44, 50), 'light': (212, 214, 220),
        'glow': (150, 160, 180, 38), 'medal': (152, 154, 162),
        'gear': (98, 96, 104), 'gear_dark': (34, 34, 40), 'gear_light': (186, 188, 196),
    },
    'blood': {
        'label': '血锈',
        'base': (146, 66, 54), 'dark': (60, 20, 18), 'light': (232, 158, 122),
        'glow': (170, 40, 30, 54), 'medal': (188, 98, 80),
        'gear': (140, 62, 52), 'gear_dark': (58, 20, 18), 'gear_light': (226, 154, 120),
    },
    'bone': {
        'label': '骨白',
        'base': (182, 172, 144), 'dark': (74, 68, 54), 'light': (250, 246, 224),
        'glow': (220, 210, 170, 38), 'medal': (208, 198, 168),
        # 锁链保持骨白，齿轮单独用血锈色 —— 两种材质撞在一起更有层次。
        # 血锈调深过一档，太浅在深红背景上会发灰、失去"锈"的感觉。
        'gear': (104, 42, 34), 'gear_dark': (40, 13, 12), 'gear_light': (196, 108, 82),
    },
}


def link_geo(scale=1.0):
    """锁链几何（单位：像素；scale 传超采样倍数即可得到作图坐标系下的值）。
    返回 (半间距, 正环短轴, 侧环短轴, 线粗, 链带中心离边缘的距离)
    """
    s = min(FIELD_W, FIELD_H)
    span = s * SPAN_R * scale
    faceW = span * FACE_W_R
    Th = max(2.0, span * LINK_TH_R)
    # 链带中心固定在 CHAIN_CENTER，让场地判定线从链子正中穿过
    return span, faceW, span * EDGE_W_R, Th, CHAIN_CENTER * scale


def ellipse_pts(cx, cy, rx, ry, ang, a0=0.0, a1=2 * math.pi, n=64):
    pts = []
    for i in range(n + 1):
        t = a0 + (a1 - a0) * i / n
        x = rx * math.cos(t)
        y = ry * math.sin(t)
        pts.append((cx + x * math.cos(ang) - y * math.sin(ang),
                    cy + x * math.sin(ang) + y * math.cos(ang)))
    return pts


def draw_ring(d, cx, cy, L, Wd, Th, ang, color, extra=0):
    d.line(ellipse_pts(cx, cy, L, Wd, ang), fill=color,
           width=max(1, int(round(Th + extra))), joint='curve')


def draw_link(d, style, cx, cy, L, Wd, Th, ang, back=False, edge_on=False):
    """画一个链环。

    真链子的观感来自「宽环 + 窄环」交替：宽环正面对着观众（亮、有高光），
    窄环立着（暗、只有一点反光）。所以侧面环要走单独的画法，不能只改宽度 ——
    这点是我反复调了半天才想明白的。

    back=True 时只画"从下方穿过"的那段弧（暗色），随后被下一个正面环盖住。
    """
    # 正环：宽扁、亮、有孔；侧环：略窄、暗、厚
    # 重叠量取 0.62 —— 太少不互扣、太多糊成一团，这个值是试出来的
    L_ov = L * 0.62
    if back:
        d.line(ellipse_pts(cx, cy, L_ov, Wd, ang, math.pi * 0.5, math.pi * 1.5),
               fill=style['dark'], width=max(1, int(round(Th * 0.9))), joint='curve')
        return

    if edge_on:
        # —— 立着的环：压暗、加厚，只留一道细反光 ——
        draw_ring(d, cx, cy, L_ov, Wd, Th, ang, mix(style['dark'], (0, 0, 0), 0.25),
                  max(1.0, Th * 0.9))
        draw_ring(d, cx, cy, L_ov, Wd, Th, ang,
                  mix(style['dark'], style['base'], 0.40))
        hl = int(round(max(1.0, Th * 0.55)))
        if hl >= 1:
            d.line(ellipse_pts(cx, cy, (L_ov + Wd) * 0.5, Wd * 0.90, ang,
                               math.radians(-145), math.radians(-75), 16),
                   fill=mix(style['base'], style['light'], 0.55), width=hl, joint='curve')
        return

    # —— 正对着的环：亮、有厚度、中间有孔 ——
    draw_ring(d, cx, cy, L_ov, Wd, Th, ang, style['dark'], max(1.0, Th * 0.6))
    draw_ring(d, cx, cy, L_ov, Wd, Th, ang, style['base'])
    if Wd - Th > 1.2:
        draw_ring(d, cx, cy, L_ov, Wd, Th, ang, style['dark'], -max(1.0, Th * 0.5))
    hl = int(round(max(1.0, Th * 0.5)))
    if hl >= 1:
        d.line(ellipse_pts(cx, cy, (L_ov + Wd) * 0.5, Wd * 0.94, ang,
                           math.radians(-158), math.radians(-56), 20),
               fill=style['light'], width=hl, joint='curve')


def mix(c1, c2, k):
    return tuple(int(round(a + (b - a) * k)) for a, b in zip(c1, c2))


def chain_edge(img, style, horizontal, span_from, span_to, offset, scale=1.0):
    """沿一条边铺满链子。
    horizontal=True  : 边是水平的，沿 x 从 span_from 铺到 span_to，链带中心在 y=offset
    horizontal=False : 边是竖直的，沿 y 从 span_from 铺到 span_to，链带中心在 x=offset
    ★ span_from/span_to/offset 必须和 scale 用同一套单位（作图坐标系）。
    相邻环正/侧交替 —— 这是链子读得出来的关键。
    """
    d = ImageDraw.Draw(img)
    span, faceW, edgeW, Th, _ = link_geo(scale)
    length = span_to - span_from
    if length <= 0:
        return
    n = max(2, int(math.ceil(length / span)) + 1)
    real_step = length / (n - 1.0)
    ang = 0.0 if horizontal else math.pi / 2
    R = offset

    for i in range(n):
        c = span_from + i * real_step
        face = (i % 2 == 0)          # 交替：正环 / 侧环
        L = span
        Wd = faceW if face else edgeW
        # 先埋一个错开半格的背面环（暗色），下一个正面环会压住它
        if i > 0:
            cb = c - real_step * 0.5
            bw = edgeW if face else faceW
            if horizontal:
                draw_link(d, style, cb, R, span * 0.94, bw, Th, ang, True, not face)
            else:
                draw_link(d, style, R, cb, span * 0.94, bw, Th, ang, True, not face)
        if horizontal:
            draw_link(d, style, c, R, L, Wd, Th, ang, False, not face)
        else:
            draw_link(d, style, R, c, L, Wd, Th, ang, False, not face)


def gear_path(cx, cy, r_out, r_root, teeth, tooth_ratio=0.52, phase=0.0):
    """生成齿轮外轮廓的多边形顶点。
    r_out   = 齿顶圆半径
    r_root  = 齿根圆半径
    teeth   = 齿数
    tooth_ratio = 齿顶弧长占单个齿周期的比例（0.5 左右最像齿轮）
    """
    step = 2 * math.pi / teeth
    half_tip = step * tooth_ratio * 0.5
    pts = []
    for i in range(teeth):
        a0 = phase + i * step
        # 齿根 -> 齿顶（两侧各加一点过渡，齿形不至于太尖）
        pts.append((cx + r_root * math.cos(a0 - half_tip - step * 0.10),
                    cy + r_root * math.sin(a0 - half_tip - step * 0.10)))
        pts.append((cx + r_out * math.cos(a0 - half_tip * 0.72),
                    cy + r_out * math.sin(a0 - half_tip * 0.72)))
        pts.append((cx + r_out * math.cos(a0 + half_tip * 0.72),
                    cy + r_out * math.sin(a0 + half_tip * 0.72)))
        pts.append((cx + r_root * math.cos(a0 + half_tip + step * 0.10),
                    cy + r_root * math.sin(a0 + half_tip + step * 0.10)))
    return pts


def corner_crest(img, cx, cy, r, style):
    """角落的齿轮纹章。

    之所以用齿轮：它和剧场那套机械装置（背景里的齿轮幕布）呼应，
    而且四角对称时四个齿轮看起来像"机关"，比原来的几何符号有叙事感。
    齿轮也顺带盖住了四条链子在角落的接缝。
    """
    d = ImageDraw.Draw(img)
    # 齿轮有自己的三色，可以和锁链不同色系（比如骨白链 + 血锈齿轮）
    base = style.get('gear', style['base'])
    dark = style.get('gear_dark', style['dark'])
    light = style.get('gear_light', style['light'])

    def I(v):
        return int(round(v))

    r_gear = r * 1.10                      # 齿顶圆（原来是 0.92，放大约 1.2 倍）
    r_root = r_gear * 0.70                  # 齿根圆（原来是 0.80，齿咬得更深）
    r_hub = r_gear * 0.34                   # 轮毂半径
    r_bore = r_gear * 0.20                  # 中心孔
    teeth = 9                               # 齿数
    # 中心孔的颜色：**不是**挖透明，而是填一个很深的颜色。
    # 透空的话会露出后面的背景图，看着像"破了个洞"；填深色才像机械上的孔。
    bore_col = style.get('bore', (26, 20, 16))

    gear = [(I(x), I(y)) for x, y in gear_path(cx, cy, r_gear, r_root, teeth, 0.52, 0.19)]

    # 1) 齿轮主体：外描边（暗） -> 本色
    d.polygon(gear, fill=dark)
    inner_scale = (r_gear - max(2.0, r_gear * 0.10)) / r_gear
    d.polygon([(I(cx + (x - cx) * inner_scale), I(cy + (y - cy) * inner_scale))
               for x, y in gear], fill=base)

    # 2) 齿顶高光：沿齿顶小段画浅色，制造金属质感
    step = 2 * math.pi / teeth
    for i in range(teeth):
        a = 0.19 + i * step
        d.line([(I(cx + r_gear * 0.94 * math.cos(a - step * 0.16)),
                 I(cy + r_gear * 0.94 * math.sin(a - step * 0.16))),
                (I(cx + r_gear * 0.94 * math.cos(a + step * 0.16)),
                 I(cy + r_gear * 0.94 * math.sin(a + step * 0.16)))],
               fill=mix(base, light, 0.65), width=max(1, I(r_gear * 0.07)))

    # 3) 轮毂：外圈暗、内圈本色
    d.ellipse([I(cx - r_hub), I(cy - r_hub), I(cx + r_hub), I(cy + r_hub)],
              fill=dark)
    r_hub2 = r_hub * 0.74
    d.ellipse([I(cx - r_hub2), I(cy - r_hub2), I(cx + r_hub2), I(cy + r_hub2)],
              fill=base, outline=mix(base, light, 0.5), width=max(1, I(r_gear * 0.05)))

    # 4) 中心孔：填深色（不是挖透明），看起来才像机械上的孔而不是破洞
    r_bore_out = r_bore * 1.22              # 孔外一圈稍暗，做出孔的"壁厚"
    d.ellipse([I(cx - r_bore_out), I(cy - r_bore_out),
               I(cx + r_bore_out), I(cy + r_bore_out)],
              fill=mix(dark, (0, 0, 0), 0.35))
    d.ellipse([I(cx - r_bore), I(cy - r_bore), I(cx + r_bore), I(cy + r_bore)],
              fill=bore_col)
    # 孔口左上角一小道反光，避免看起来是个死黑圆
    d.arc([I(cx - r_bore), I(cy - r_bore), I(cx + r_bore), I(cy + r_bore)],
          start=190, end=310, fill=mix(dark, light, 0.28), width=max(1, I(r_gear * 0.045)))

    # 5) 高光弧：左上
    d.arc([I(cx - r_hub * 1.05), I(cy - r_hub * 1.05),
           I(cx + r_hub * 1.05), I(cy + r_hub * 1.05)],
          start=185, end=300, fill=light, width=max(1, I(r_gear * 0.06)))


def gen(style_key, out_path):
    style = STYLES[style_key]
    W, H = FIELD_W * SS, FIELD_H * SS
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    # 全部按作图坐标系（超采样后的像素）计算，避免单位混用
    wx, wy = W, H
    span, faceW, edgeW, Th, R = link_geo(SS)
    # 四边各铺一条。链带中心在 R 处（= 场地判定线的位置），
    # 所以锁链被判定线"平均分"：外半条永远露在球堆之上，内半条被球盖住也没关系。
    # 两端一直铺到贴图边缘（0 / W / H），因为角落会被齿轮盖住。
    chain_edge(img, style, True, 0, wx, R, SS)             # 上
    chain_edge(img, style, True, 0, wx, wy - R, SS)        # 下
    chain_edge(img, style, False, 0, wy, R, SS)            # 左
    chain_edge(img, style, False, 0, wy, wx - R, SS)       # 右

    # —— 锁链微光 ——
    # 只取"链子"那一层做发光蒙版（不含齿轮），否则齿轮四角会糊。
    # 颜色从配色里现算：本色与高光之间偏亮一档，看起来像金属在暗处泛光。
    glow_src = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    chain_edge(glow_src, style, True, 0, wx, R, SS)
    chain_edge(glow_src, style, True, 0, wx, wy - R, SS)
    chain_edge(glow_src, style, False, 0, wy, R, SS)
    chain_edge(glow_src, style, False, 0, wy, wx - R, SS)

    gc = mix(style['base'], style['light'], 0.45)
    gm = glow_src.filter(ImageFilter.GaussianBlur(GLOW_BLUR * SS)).split()[3]
    gm = gm.point(lambda a: min(255, int(a * GLOW_STRENGTH)))
    gcol = Image.new('RGBA', (W, H), gc + (255,))
    gcol.putalpha(gm)
    out = Image.alpha_composite(gcol, img)

    # 四角齿轮：中心放在**两条链带中心线的交点**（也就是场地框的角点），
    # 这样齿轮跟着锁链一起移动，四角始终对齐。
    cr = span * 1.15
    corner_crest(out, R, R, cr, style)
    corner_crest(out, W - R, R, cr, style)
    corner_crest(out, R, H - R, cr, style)
    corner_crest(out, W - R, H - R, cr, style)

    out = out.resize((FIELD_W, FIELD_H), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out.save(out_path)
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    install = None
    if '--install' in sys.argv:
        install = sys.argv[sys.argv.index('--install') + 1]
    elif '--style' in sys.argv:
        install = None

    only = sys.argv[sys.argv.index('--style') + 1] if '--style' in sys.argv else None
    made = []
    for key in STYLES:
        if only and key != only:
            continue
        if install and key != install:
            continue
        p = os.path.join(root, 'web', 'assets', 'frame.png') if install else \
            os.path.join(root, 'docs', 'art', 'budget', 'frame_%s.png' % key)
        gen(key, p)
        made.append((key, p))
        print('  %-8s %s  -> %s  %5.0f KB' % (key, STYLES[key]['label'],
                                              os.path.basename(p), os.path.getsize(p) / 1024.0))
    if not install:
        print('输出目录：docs/art/budget/')
        print('选定后装进工程：python tools\\gen_frame.py --install <配色名>')
    return 0


if __name__ == '__main__':
    sys.exit(main())
