"""确保 shared/config.备份-当前.js 与 shared/config.js 逐字节一致。

为什么需要它（见 交接文档.md）：
    shared 下有**三个** config 文件，只有 config.js 是"正在用的"。
    `config.备份-当前.js` 是它的副本，`怎么改参数.md` 里"改坏了怎么恢复"
    就是靠这份副本（把副本复制回 config.js）。
    所以每次改完 config.js 都要同步它 —— 忘了同步，恢复流程就会把新功能一起回退掉。

用法：
    python tools/sync_config_backup.py            # 只检查（不一致返回码 1）
    python tools/sync_config_backup.py --apply    # 不一致就覆盖同步
"""
import hashlib
import os
import shutil
import sys

# Windows 控制台/管道可能是 GBK，emoji 会直接抛 UnicodeEncodeError 把脚本搞崩。
# 先兜住输出编码（显示可能仍是乱码，但脚本不会失败）。
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUR = os.path.join(ROOT, 'shared', 'config.js')
BAK = os.path.join(ROOT, 'shared', 'config.备份-当前.js')


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def lines(path):
    # errors='replace'：文件万一被别的工具用 GBK 写坏，这里也只是数字不准，
    # 不要让整个检查脚本崩掉 —— 关键结论是哈希比对。
    with open(path, encoding='utf-8', errors='replace') as f:
        return sum(1 for _ in f)


def main():
    apply_fix = '--apply' in sys.argv
    if not os.path.exists(CUR):
        print('  ❌ 找不到 ' + CUR)
        return 1
    if not os.path.exists(BAK):
        print('  ❌ 找不到备份 ' + BAK)
        return 1

    a, b = sha(CUR), sha(BAK)
    print('  config.js            %s …  %d 行' % (a[:12], lines(CUR)))
    print('  config.备份-当前.js   %s …  %d 行' % (b[:12], lines(BAK)))

    if a == b:
        print('  ✅ 一致：备份副本是最新的')
        return 0

    print('  ❌ 不一致：备份副本落后于 config.js')
    if apply_fix:
        shutil.copyfile(CUR, BAK)
        ok = sha(CUR) == sha(BAK)
        print('  %s 已同步（备份现在 = config.js）' % ('✅' if ok else '❌ 同步后仍然不一致'))
        return 0 if ok else 1
    print('  → 同步：python tools/sync_config_backup.py --apply')
    return 1


if __name__ == '__main__':
    sys.exit(main())
