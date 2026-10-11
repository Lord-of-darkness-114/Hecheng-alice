"""生成占位音效（WAV）。

为什么不下载素材：这些音是我用振荡器+噪声在本地合成出来的，
**原创、无版权问题**，可以随项目一起分发。你的正式音频到位后直接覆盖同名文件即可。

网页版其实不依赖这些文件（web/audio-web.js 会实时合成同样的声音），
但微信小游戏只能用音频文件，所以这里把它们落盘，让两端共用同一套资源。

用法：
    python tools/gen_audio.py            # 写入 web/assets/audio/
"""
import math
import os
import struct
import wave

SR = 22050          # 采样率：够用且体积小
A4 = 440.0


def semi(n):
    """相对 A4 的半音数 -> 频率"""
    return A4 * (2.0 ** (n / 12.0))


def env_exp(t, dur, attack):
    """快起缓落包络"""
    if t < 0 or t > dur:
        return 0.0
    if t < attack:
        return t / attack
    k = (t - attack) / max(1e-6, dur - attack)
    return math.exp(-5.0 * k)


class Buf:
    def __init__(self, seconds):
        self.n = int(SR * seconds)
        self.data = [0.0] * self.n

    def add(self, i, v):
        if 0 <= i < self.n:
            self.data[i] += v

    def tone(self, at, dur, freq, vol, kind="triangle", freq_to=None, attack=0.008, detune=0.0):
        f0, f1 = freq, freq_to or freq
        i0 = int(at * SR)
        n = int(dur * SR)
        for k in range(n):
            t = k / SR
            # 频率线性插值（听感上近似指数滑音，够用）
            f = f0 + (f1 - f0) * (t / dur)
            f *= (1.0 + detune)
            ph = 2 * math.pi * f * t
            if kind == "sine":
                s = math.sin(ph)
            elif kind == "square":
                s = 1.0 if (ph % (2 * math.pi)) < math.pi else -1.0
            else:  # triangle
                x = (ph / (2 * math.pi)) % 1.0
                s = 4 * abs(x - 0.5) - 1
            self.add(i0 + k, s * vol * env_exp(t, dur, attack))
            # 叠一层轻微失谐，声音更"厚"、更像老游戏机
            if dur > 0.2:
                self.add(i0 + k, s * vol * 0.22 * env_exp(t, dur, attack) *
                         math.sin(2 * math.pi * f * 1.004 * t))

    def noise(self, at, dur, vol, freq, freq_to=None, q=1.2, kind="bandpass"):
        """用状态变量滤波器把白噪声整形成气声/破碎感"""
        i0 = int(at * SR)
        n = int(dur * SR)
        f1 = freq_to or freq
        state = [0.123456789]          # 确定性种子，保证每次生成的音一模一样

        def rnd():
            state[0] = (state[0] * 1103515245.0 + 12345.0) % 2147483648.0
            return state[0] / 1073741824.0 - 1.0

        lp = bp = 0.0
        for k in range(n):
            t = k / SR
            f = freq + (f1 - freq) * (t / dur)
            w = 2 * math.pi * f / SR
            alpha = math.sin(w) / (2 * max(0.2, q))
            x = rnd()
            hp = x - lp - alpha * bp
            bp += w * hp
            lp += w * bp
            s = bp if kind == "bandpass" else lp
            self.add(i0 + k, s * vol * env_exp(t, dur, 0.002))

    def write(self, path, gain=1.0, fade_out=0.02):
        peak = max(1e-9, max(abs(v) for v in self.data))
        scale = (0.92 / peak) * gain
        fn = int(SR * fade_out)
        out = bytearray()
        for i, v in enumerate(self.data):
            s = v * scale
            if i > self.n - fn:
                s *= (self.n - i) / fn
            s = max(-1.0, min(1.0, s))
            out += struct.pack("<h", int(s * 32767))
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(bytes(out))
        return len(out) + 44


def make_drop():
    b = Buf(0.30)
    b.noise(0.0, 0.09, 0.5, 1600, 420, q=0.9)
    b.tone(0.0, 0.10, semi(-17), 0.35, "sine", freq_to=semi(-24))
    return b


def make_merge(idx):
    """idx: 0..7 -> 合成出第 2..9 阶（越高越清脆）"""
    rate = 1.0 + idx * 0.05
    base = semi(3) * rate
    b = Buf(0.60)
    b.tone(0.0, 0.20, base, 0.42, "triangle")
    b.tone(0.055, 0.26, base * 1.5, 0.34, "triangle")
    b.tone(0.0, 0.14, base * 2, 0.10, "sine")
    b.noise(0.0, 0.12, 0.18, base * 2.4, base * 0.8, q=2.0)
    if idx >= 6:   # 满级附近加钟声
        b.tone(0.0, 1.4, semi(-24), 0.30, "sine")
        b.tone(0.04, 1.1, semi(-12), 0.18, "triangle")
    return b


def make_over():
    b = Buf(2.6)
    for i, n in enumerate([0, -3, -7, -12, -19]):
        b.tone(i * 0.13, 1.1 - i * 0.1, semi(n), 0.40 - i * 0.04, "triangle" if i < 2 else "sine")
    b.tone(0.0, 2.2, semi(-31), 0.36, "sine")
    return b


def make_ui():
    b = Buf(0.14)
    b.tone(0.0, 0.07, semi(7), 0.30, "square")
    return b


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), "web", "assets", "audio")
    os.makedirs(out, exist_ok=True)
    total = 0
    jobs = [("drop.wav", make_drop), ("gameover.wav", make_over), ("ui.wav", make_ui)]
    for i in range(8):
        jobs.append(("merge%d.wav" % (i + 1), (lambda k: (lambda: make_merge(k)))(i)))
    for name, fn in jobs:
        p = os.path.join(out, name)
        n = fn().write(p)
        total += n
        print("  %-14s %6.1f KB" % (name, n / 1024.0))
    print("共 %d 个文件，%.1f KB -> %s" % (len(jobs), total / 1024.0, out))


if __name__ == "__main__":
    main()
