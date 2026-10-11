"""打包"可直接上传"的成品：生成 publish/ 目录。

为什么需要它：
  开发时的目录结构是 web/index.html + ../shared + ../vendor（多一层），
  上传到托管平台后地址会变成 https://站点/web/ —— 不够干净。
  这个脚本把 web/ 的内容**摊平到根目录**，并把 index.html 里的
  `../shared/` `../vendor/` 改写成 `shared/` `vendor/`，
  这样别人打开 https://站点/ 就是游戏本体。

用法：
    python tools/make_publish.py
"""
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'publish')


def copy_tree(src, dst, skip=()):
    n = 0
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in skip]
        rel = os.path.relpath(dirpath, src)
        target = dst if rel == '.' else os.path.join(dst, rel)
        os.makedirs(target, exist_ok=True)
        for f in filenames:
            if f in skip or f.startswith('_cmp_'):
                continue
            if f.startswith('config.备份'):
                continue
            shutil.copy2(os.path.join(dirpath, f), os.path.join(target, f))
            n += 1
    return n


def main():
    if os.path.exists(PUB):
        print('清空旧目录: %s' % PUB)
        shutil.rmtree(PUB)
    os.makedirs(PUB)

    # 1) web/ 的内容摊平到根目录（含 assets）
    n_web = copy_tree(os.path.join(ROOT, 'web'), PUB)
    # 2) shared/ 与 vendor/ 原样拷到根下
    n_shared = copy_tree(os.path.join(ROOT, 'shared'), os.path.join(PUB, 'shared'))
    n_vendor = copy_tree(os.path.join(ROOT, 'vendor'), os.path.join(PUB, 'vendor'))

    # 3) index.html 里把 ../shared / ../vendor 改成同级的 shared / vendor
    idx = os.path.join(PUB, 'index.html')
    with open(idx, 'r', encoding='utf-8') as f:
        html = f.read()
    before = html
    html = html.replace('src="../shared/', 'src="shared/')
    html = html.replace('src="../vendor/', 'src="vendor/')
    if html != before:
        with open(idx, 'w', encoding='utf-8', newline='') as f:
            f.write(html)
        print('已改写 index.html 的脚本路径（../shared → shared，../vendor → vendor）')
    else:
        print('⚠️ index.html 里没找到 ../shared 或 ../vendor，请检查路径是否变了')

    # 4) 统计
    total = 0
    count = 0
    for dirpath, _dirs, filenames in os.walk(PUB):
        for f in filenames:
            total += os.path.getsize(os.path.join(dirpath, f))
            count += 1
    print('publish/ 生成完毕：%d 个文件，%.2f MB' % (count, total / 1024.0 / 1024.0))
    print('  web 部分 %d 个 / shared %d 个 / vendor %d 个' % (n_web, n_shared, n_vendor))
    print('  别人打开站点根目录 https://<你的域名>/ 就是游戏本体')


if __name__ == '__main__':
    main()
