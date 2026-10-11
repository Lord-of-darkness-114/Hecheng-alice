"""把几种场地框分别装进游戏截图，并排成对比图。

用法：
    python tools/frame_compare.py
"""
import glob
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUDGET = os.path.join(ROOT, 'docs', 'art', 'budget')


def main():
    frames = sorted(glob.glob(os.path.join(BUDGET, 'frame_*.png')))
    if not frames:
        print('没找到 frame_*.png，先跑 gen_frame.py'); return 1
    target = os.path.join(ROOT, 'web', 'assets', 'frame.png')
    backup = target + '.bak'
    had = os.path.exists(target)
    if had:
        shutil.copyfile(target, backup)

    shots = []
    try:
        for f in frames:
            name = os.path.splitext(os.path.basename(f))[0].replace('frame_', '')
            shutil.copyfile(f, target)
            p = os.path.join(BUDGET, 'ingame_%s.png' % name)
            # 固定场地，避免每次随机导致对比困难
            subprocess.run([sys.executable, os.path.join(HERE, 'shot.py'),
                            'http://127.0.0.1:8080/web/?headless=1&auto=1', p, '15',
                            '520', '924'], check=True)
            shots.append(p)
            print('  %-8s -> %s' % (name, os.path.basename(p)))
    finally:
        if had:
            shutil.copyfile(backup, target)
            os.remove(backup)
        print('已还原原来的 frame.png')

    subprocess.run([sys.executable, os.path.join(HERE, 'contact_sheet.py'),
                    os.path.join(BUDGET, 'compare_frame.jpg')] + shots, check=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
