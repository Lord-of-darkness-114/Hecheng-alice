"""临时诊断脚本：审计 web/assets/audio 下的音效。

看四件事：时长、采样率/声道、峰值/RMS（音量水平是否一致）、以及哪些文件内容完全相同。
"""
import hashlib
import os
import struct
import wave

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = os.path.join(root, 'web', 'assets', 'audio')

order = ['drop.wav', 'merge1.wav', 'merge2.wav', 'merge3.wav', 'merge4.wav',
         'merge5.wav', 'merge6.wav', 'merge7.wav', 'merge8.wav', 'gameover.wav', 'ui.wav']

print("%-12s %7s %6s %4s %8s %7s %7s %10s" % (
    "文件", "时长ms", "采样率", "声道", "帧数", "峰值", "RMS", "md5前8"))
print("-" * 78)
hashes = {}
for name in order:
    p = os.path.join(d, name)
    if not os.path.exists(p):
        print("%-12s 缺失" % name)
        continue
    with open(p, 'rb') as f:
        raw = f.read()
    md5 = hashlib.md5(raw).hexdigest()[:8]
    with wave.open(p, 'rb') as w:
        nch, sw, rate, nframes = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        data = w.readframes(nframes)
    # 16bit PCM
    n = len(data) // 2
    samples = struct.unpack('<%dh' % n, data[:n * 2])
    peak = max(abs(s) for s in samples) if samples else 0
    rms = (sum(float(s) * s for s in samples) / n) ** 0.5 if n else 0
    dur_ms = nframes * 1000.0 / rate
    print("%-12s %7.0f %6d %4d %8d %7d %7.0f %10s" % (
        name, dur_ms, rate, nch, nframes, peak, rms, md5))
    hashes.setdefault(md5, []).append(name)

print()
print("内容完全相同的文件组：")
dup = {k: v for k, v in hashes.items() if len(v) > 1}
if dup:
    for k, v in dup.items():
        print("  md5 %s -> %s" % (k, ', '.join(v)))
else:
    print("  无（每个文件内容都不同）")
