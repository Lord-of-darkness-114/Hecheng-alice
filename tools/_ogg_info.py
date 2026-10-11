"""临时脚本：读 .ogg / .wav 的时长与格式（不依赖任何第三方库）。

Ogg Vorbis 的时长可以从最后一个 OggS 页的 granule position 得到
（Vorbis 的 granule = 采样数），采样率在 identification header 里。
"""
import os
import struct
import sys
import wave

SE = r'E:\steam\steamapps\common\BLACK SOULS II\Audio\SE'


def ogg_info(path):
    with open(path, 'rb') as f:
        data = f.read()
    rate = nch = None
    i = data.find(b'\x01vorbis')
    if i > 0:
        nch = data[i + 11]
        rate = struct.unpack('<I', data[i + 12:i + 16])[0]
    j = data.rfind(b'OggS')
    dur = None
    if j > 0 and rate:
        gran = struct.unpack('<q', data[j + 6:j + 14])[0]
        if gran > 0:
            dur = gran / float(rate)
    return dur, rate, nch


def wav_info(path):
    with wave.open(path, 'rb') as w:
        rate, nch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    return n / float(rate), rate, nch


def info(path):
    try:
        if path.lower().endswith('.ogg'):
            return ogg_info(path)
        if path.lower().endswith('.wav'):
            return wav_info(path)
    except Exception as e:
        return None, None, None
    return None, None, None


def main():
    # 候选：给"每个合成音用不同音效"挑的（已排除成人语音）
    cands = [
        '鐘', '鐘２', 'ピアノ', '心音', '振り子', 'チクタク', '指パッチン',
        '幻聴', '幻聴２', '幻聴６', '幻聴７', '幻聴８', '幻聴９', '幻聴１０', '幻聴１３',
        'テケリ・リ', '笑', '笑い声', '微笑む男', '微笑む男', '刀', '刀２', '刀３',
        '金属 (1)', '金属 (2)', '骨', '骸骨', 'グール', 'グール２', 'グール３',
        'トランプ (1)', 'トランプ (2)', 'カラス', 'カラス声', '怪鳥', '怪獣',
        '夜魔羽', '翼羽ばたき', '領域', '重音', '血しぶき・飛び散る01',
        '雨走る', '刹那の見切り', '戦闘開始', '開演ブザー', '扉ノック', '門',
        '深呼吸', '拍手', 'ブロック', 'ビクトリア (1)', 'ビクトリア (5)', 'ビクトリア (18)',
    ]
    # ASCII 名的候选（魔法/属性/铃/钟 之类）
    ascii_cands = ['Bell1', 'Bell2', 'Bell3', 'Chime1', 'Chime2', 'Clock', 'Crash',
                   'Darkness1', 'Darkness8', 'Devil1', 'Devil3', 'Explosion1',
                   'Thunder1', 'Ice1', 'Fire1', 'Wind1', 'Earth1', 'Heal1', 'Saint1',
                   'Sword1', 'Slash1', 'Monster1', 'Collapse1', 'Coin', 'Chicken', 'Cat']

    allfiles = {os.path.splitext(f)[0]: os.path.join(SE, f) for f in os.listdir(SE)}

    print('%-22s %8s %7s %5s' % ('文件', '时长ms', '采样率', '声道'))
    print('-' * 48)
    for name in cands + ascii_cands:
        p = allfiles.get(name)
        if not p:
            continue
        dur, rate, nch = info(p)
        ms = '%.0f' % (dur * 1000) if dur else '?'
        print('%-22s %8s %7s %5s' % (name, ms, rate or '?', nch or '?'))


if __name__ == '__main__':
    main()
