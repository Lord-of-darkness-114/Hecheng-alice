"""一次生成同一张背景图在几个不同暗度下的游戏截图，方便对比挑一个。

用法：
    python tools/dim_compare.py <背景图> [输出目录]
"""
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'docs', 'art', 'budget')
    os.makedirs(outdir, exist_ok=True)

    # 背景图放进工程（比例已正确时不需要任何处理）
    dst = os.path.join(ROOT, 'web', 'assets', 'bg.jpg')
    shutil.copyfile(src, dst)
    print('背景图已放入 web/assets/bg.jpg  (%.0f KB)' % (os.path.getsize(dst) / 1024))

    cfg = os.path.join(ROOT, 'shared', 'config.js')
    with open(cfg, encoding='utf-8') as f:
        original = f.read()
    if not re.search(r'bgDim:\s*[\d.]+', original):
        print('config.js 里找不到 bgDim'); return 1

    shots = []
    try:
        for dim in ('0.35', '0.18', '0.00'):
            with open(cfg, 'w', encoding='utf-8') as f:
                f.write(re.sub(r'bgDim:\s*[\d.]+', 'bgDim: ' + dim, original))
            tag = dim.replace('.', '')
            p = os.path.join(outdir, 'dim_%s.png' % tag)
            subprocess.run([sys.executable, os.path.join(HERE, 'shot.py'),
                            'http://127.0.0.1:8080/web/?headless=1&auto=1', p, '14', '520', '924'],
                           check=True)
            shots.append(p)
            print('  bgDim=%s -> %s' % (dim, os.path.basename(p)))
    finally:
        with open(cfg, 'w', encoding='utf-8') as f:
            f.write(original)          # 一定还原，避免留下改过的配置
        print('config.js 已还原')

    sheet = os.path.join(outdir, 'compare_dim.jpg')
    subprocess.run([sys.executable, os.path.join(HERE, 'contact_sheet.py'), sheet] + shots,
                   check=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
