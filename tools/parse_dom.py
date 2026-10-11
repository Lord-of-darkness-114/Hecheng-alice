"""从 --dump-dom 的输出里抠出诊断元素内容。"""
import pathlib
import re
import sys

s = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8', errors='replace')
for tag in ('diag', 'selftest'):
    m = re.search(r'<pre id="%s"[^>]*>(.*?)</pre>' % tag, s, re.S)
    if m:
        print('[%s]' % tag)
        print(m.group(1).strip())
    else:
        print('[%s] NOT FOUND' % tag)
print('page bytes:', len(s))
