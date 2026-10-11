"""临时脚本：解析本机所有字体的真实族名（含中文名），找草书类字体。

TTF/OTF/TTC 的 'name' 表里有 family / subfamily / full name，
还有各语言的本地化名字（中文名通常藏在 platformID=3, languageID=0x804，或 Mac 的 langID=33）。
只读文件头，不依赖任何第三方库。
"""
import os
import struct

DIRS = [
    r'C:\Windows\Fonts',
    os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Windows\Fonts'),
]

NAME_IDS = {1: 'family', 2: 'subfamily', 4: 'full', 16: 'typoFamily', 17: 'typoSub'}


def read_name_table(data, off):
    """返回 {nameID: {lang: 字符串}}"""
    out = {}
    try:
        fmt, count, str_off = struct.unpack('>HHH', data[off:off + 6])
        for i in range(count):
            rec = off + 6 + i * 12
            pid, eid, lid, nid, length, offset = struct.unpack('>HHHHHH', data[rec:rec + 12])
            if nid not in NAME_IDS:
                continue
            raw = data[off + str_off + offset: off + str_off + offset + length]
            if pid == 3 or (pid == 0):          # Windows / Unicode
                try:
                    text = raw.decode('utf-16-be', 'ignore')
                except Exception:
                    continue
            else:                                # Mac Roman
                try:
                    text = raw.decode('mac-roman', 'ignore')
                except Exception:
                    continue
            text = text.strip()
            if not text:
                continue
            out.setdefault(NAME_IDS[nid], {})[lid] = text
    except Exception:
        pass
    return out


def tables(data, base=0):
    """返回 {tag: (offset, length)}，base 用于 TTC"""
    try:
        num = struct.unpack('>H', data[base + 4:base + 6])[0]
    except Exception:
        return {}
    res = {}
    for i in range(num):
        rec = base + 12 + i * 16
        tag, _cs, off, ln = struct.unpack('>4sIII', data[rec:rec + 16])
        res[tag.decode('latin-1')] = (off, ln)
    return res


def scan_font(path):
    with open(path, 'rb') as f:
        data = f.read()
    results = []
    if data[:4] == b'ttcf':
        n = struct.unpack('>I', data[8:12])[0]
        offsets = struct.unpack('>%dI' % n, data[12:12 + 4 * n])
        for off in offsets:
            t = tables(data, off)
            if 'name' in t:
                results.append(read_name_table(data, t['name'][0]))
    else:
        t = tables(data, 0)
        if 'name' in t:
            results.append(read_name_table(data, t['name'][0]))
    return results


def zh_of(names):
    """挑一个中文名（langID 0x804=简中, 0x404=繁中, 33=Mac 中文）"""
    fam = names.get('family', {})
    for lid in (0x804, 0x404, 33, 0x0c04):
        if lid in fam:
            return fam[lid]
    for lid, v in fam.items():
        if any('\u4e00' <= ch <= '\u9fff' for ch in v):
            return v
    return ''


def main():
    rows = []
    for d in DIRS:
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith(('.ttf', '.ttc', '.otf', '.otc')):
                continue
            p = os.path.join(d, fn)
            try:
                for names in scan_font(p):
                    fam_en = names.get('family', {}).get(0x409, '') or \
                             names.get('family', {}).get(0, '')
                    rows.append((fn, fam_en, zh_of(names),
                                 names.get('subfamily', {}).get(0x409, '')))
            except Exception as e:
                rows.append((fn, '解析失败:' + str(e)[:30], '', ''))

    print('本机字体总数（含 TTC 内的每一款）: %d' % len(rows))
    print()
    # 只看有中文名的（= 中文字体）
    cjk = [r for r in rows if r[2]]
    print('==== 中文字体（有中文族名的），共 %d 款 ====' % len(cjk))
    print('%-22s %-26s %-22s %s' % ('文件', '英文族名', '中文族名', '字形'))
    print('-' * 96)
    for fn, en, zh, sub in cjk:
        print('%-22s %-26s %-22s %s' % (fn[:22], en[:26], zh[:22], sub[:14]))

    print()
    print('==== 名字里带"草/行/手/笔/cao/grass/script"的（草书候选）====')
    hits = [r for r in rows if any(k in (r[1] + r[2] + r[3]).lower()
                                   for k in ('草', 'cao', 'grass', '行楷', 'script', '手', '笔'))]
    if hits:
        for fn, en, zh, sub in hits:
            print('  %-22s %-26s %-22s %s' % (fn[:22], en[:26], zh[:22], sub[:14]))
    else:
        print('  （没有）')


if __name__ == '__main__':
    main()
