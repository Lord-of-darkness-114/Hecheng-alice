"""临时脚本 v2：扫描原作 SE 目录，找出"适合当合成音"的短音效。

输出：
  1) 各容器/编码格式的统计（有些 .ogg 其实不是 Vorbis）
  2) 所有 ≤1.5 秒、且不在成人语音黑名单里的音效，按时长排序
"""
import os
import struct

SE = r'E:\steam\steamapps\common\BLACK SOULS II\Audio\SE'
MAX_MS = 1500

# 排除原作里的成人语音/拟声（挑音效时必须避开）
NSFW = ['尻', '絶頂', '喘', 'フェラ', '挿入', '締め付ける', '赤ん坊', 'キス',
        '泡', 'どりんく', 'おっぱい', '乳', '痴', '淫', '汁', '先生', '夜回り']


def sniff(path):
    """返回 (容器/编码, 时长秒, 采样率, 声道)"""
    with open(path, 'rb') as f:
        data = f.read()
    head = data[:64]

    # WAV
    if head[:4] == b'RIFF':
        import wave
        with wave.open(path, 'rb') as w:
            return 'WAV', w.getnframes() / float(w.getframerate()), w.getframerate(), w.getnchannels()
    # FLAC
    if head[:4] == b'fLaC':
        return 'FLAC', None, None, None
    # MP3
    if head[:3] == b'ID3' or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return 'MP3', None, None, None
    # Ogg 家族
    if head[:4] == b'OggS':
        codec = 'Ogg/?'
        rate = nch = None
        if b'OpusHead' in data[:200]:
            codec = 'Ogg/Opus'
            rate = 48000
            nch = data[data.find(b'OpusHead') + 9]
        else:
            i = data.find(b'\x01vorbis')
            if i > 0:
                codec = 'Ogg/Vorbis'
                nch = data[i + 11]
                rate = struct.unpack('<I', data[i + 12:i + 16])[0]
        j = data.rfind(b'OggS')
        dur = None
        if j > 0 and rate:
            gran = struct.unpack('<q', data[j + 6:j + 14])[0]
            if gran > 0:
                dur = gran / float(rate)
        return codec, dur, rate, nch
    return '其它(%s)' % head[:4].hex(), None, None, None


def main():
    files = sorted(os.listdir(SE))
    fmts = {}
    rows = []
    for f in files:
        if not f.lower().endswith(('.ogg', '.wav', '.mp3')):
            continue
        p = os.path.join(SE, f)
        try:
            codec, dur, rate, nch = sniff(p)
        except Exception as e:
            codec, dur, rate, nch = '读取失败', None, None, None
        fmts[codec] = fmts.get(codec, 0) + 1
        base = os.path.splitext(f)[0]
        if dur is None:
            continue
        if dur * 1000 > MAX_MS:
            continue
        if any(bad in base for bad in NSFW):
            continue
        rows.append((dur * 1000, base, codec, os.path.getsize(p) / 1024.0))

    print('==== 容器/编码统计（共 %d 个音频）====' % sum(fmts.values()))
    for k, v in sorted(fmts.items(), key=lambda x: -x[1]):
        print('  %-14s %d' % (k, v))

    print()
    print('==== ≤%dms 的候选音效（已排除成人语音），共 %d 个 ====' % (MAX_MS, len(rows)))
    print('%-8s %-24s %-12s %8s' % ('时长ms', '名称', '格式', '大小KB'))
    print('-' * 56)
    for ms, base, codec, kb in rows:
        print('%-8.0f %-24s %-12s %8.0f' % (ms, base, codec, kb))


if __name__ == '__main__':
    main()
