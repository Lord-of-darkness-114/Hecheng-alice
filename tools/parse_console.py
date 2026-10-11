"""从 Chrome 的 console 日志里提取自测/诊断结果。

Chrome 输出的日志在 Windows 上是 UTF-16，且超长行会被折行并加前缀，
所以要先把前缀剥掉再匹配。
用法: python tools/parse_console.py <日志文件> [关键字...]
"""
import pathlib
import re
import sys

PREFIX = re.compile(r'"?\s*\[\d+:\d+:\d+/\d+\.\d+:INFO:CONSOLE:\d+\] "?')


def load(path):
    raw = pathlib.Path(path).read_bytes()
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        return raw.decode('utf-16', errors='replace')
    return raw.decode('utf-8', errors='replace')


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    s = PREFIX.sub('\n@@', load(sys.argv[1]))
    keys = sys.argv[2:] or ['SELFTEST', 'CHECK', 'STATE', 'BENCH', 'ERROR']
    for block in s.split('@@'):
        if any(k in block for k in keys):
            # 折行的部分重新接起来
            text = ' '.join(x.strip() for x in block.splitlines() if x.strip())
            text = text.split(', source:')[0].strip().strip('"')
            if text:
                print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
