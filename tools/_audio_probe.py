"""临时脚本：验证"哪个游戏事件 → 播哪个音频文件"。

不只是看配置：给 G.Sound.play 和 HTMLMediaElement.prototype.play 打补丁，
然后真的驱动游戏造出"满级合成（→爱丽丝）"和"失败"，看实际调用了什么、真的去播哪个文件。

用法: python tools/_audio_probe.py [url]
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_eval import WS, find_browser

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080/web/'

PROBE = r"""
(function () {
  var G = window.G, g = window.__game, S = G.Sound;
  window.__calls = []; window.__played = [];

  var op = S.play;
  S.play = function (n, o) { window.__calls.push(n); return op.apply(this, arguments); };
  var mp = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try { window.__played.push(String(this.src).split('/').pop()); } catch (e) {}
    return mp.apply(this, arguments);
  };

  S.unlock();                 // 相当于"玩家点过一次"，解锁音频
  g.startGame();
  var F = G.FIELD, x = F.x + F.w / 2;

  function topTier() {
    var bs = g.phys.balls(), m = null;
    for (var i = 0; i < bs.length; i++) { if (m === null || bs[i].game.tier > m) m = bs[i].game.tier; }
    return m;
  }
  function take() {
    var r = { 音效调用: window.__calls.slice(), 真的去播的文件: window.__played.slice(),
              场上最高阶: topTier(), 分数: g.score };
    window.__calls.length = 0; window.__played.length = 0;
    return r;
  }

  // ① 低阶：两颗 1 阶（艾露玛）撞一起 → 合成出第 2 阶 → 应播 assets.merge[0] = merge1.wav
  g.reset();
  g.dropAt(0, x - 20); g.dropAt(0, x + 20); g.simulate(120);
  var low = take();

  // ② 满级：两颗 7 阶（库嘻嘻）撞一起 → 合成出第 8 阶（爱丽丝）→ 应播 assets.merge[6] = merge7.mp3
  g.reset();
  g.dropAt(6, x - 110); g.dropAt(6, x + 110); g.simulate(240);
  var high = take();

  // ③ 维多利亚（第 3 阶）：两颗 2 阶（古兹，下标 1）撞一起 → 合成出第 3 阶 → 应播 assets.merge[1] = merge2.mp3
  g.reset();
  g.dropAt(1, x - 27); g.dropAt(1, x + 27); g.simulate(140);
  var weiduoliya = take();

  // ④ 伊丽莎白（第 4 阶）：两颗 3 阶（维多利亚，下标 2）撞一起 → 合成出第 4 阶 → 应播 assets.merge[2] = merge3.mp3
  g.reset();
  g.dropAt(2, x - 37); g.dropAt(2, x + 37); g.simulate(150);
  var yilishabai = take();

  // ④ 多萝茜（第 5 阶）：两颗 4 阶（伊丽莎白，下标 3）撞一起 → 合成出第 5 阶 → 应播 assets.merge[3] = merge4.mp3
  g.reset();
  g.dropAt(3, x - 47); g.dropAt(3, x + 47); g.simulate(160);
  var duoluoxi = take();

  // ④ 蕾克（第 6 阶）：两颗 5 阶（多萝茜，下标 4）撞一起 → 合成出第 6 阶 → 应播 assets.merge[4] = merge5.mp3
  g.reset();
  g.dropAt(4, x - 59); g.dropAt(4, x + 59); g.simulate(180);
  var leike = take();

  // ⑤ 库嘻嘻（第 7 阶）：两颗 6 阶（蕾克，下标 5）撞一起 → 合成出第 7 阶 → 应播 assets.merge[5] = merge6.mp3
  g.reset();
  g.dropAt(5, x - 73); g.dropAt(5, x + 73); g.simulate(200);
  var kukuxi = take();

  // ⑦ 投放音：每个角色丢出去时应该播他自己的音效（艾露玛 = 通用 drop）
  var drops = [];
  for (var dt = 0; dt <= 4; dt++) {
    g.reset();
    g.hold = { tier: dt };
    g._dropCd = 0;
    window.__calls.length = 0;
    g.drop();
    drops.push({ 阶: dt + 1, 音效: window.__calls.slice() });
  }
  window.__calls.length = 0;

  // ⑧ 失败
  g.gameOver();
  var over = take();

  return JSON.stringify({
    投放音: drops,
    低阶合成: low, 满级合成爱丽丝: high, 维多利亚合成: weiduoliya, 伊丽莎白合成: yilishabai,
    多萝茜合成: duoluoxi, 蕾克合成: leike, 库嘻嘻合成: kukuxi, 失败: over,
    注册表: { merge0: S._registry['merge0'], merge1: S._registry['merge1'],
              merge2: S._registry['merge2'], merge3: S._registry['merge3'],
              merge4: S._registry['merge4'], merge5: S._registry['merge5'],
              merge6: S._registry['merge6'],
              over: S._registry['over'], bgm: S._registry['bgm'] }
  }, null, 1);
})()
"""


def main():
    port = 9555
    profile = tempfile.mkdtemp(prefix='cdpaudio_')
    proc = subprocess.Popen([
        find_browser(), '--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=%d' % port,
        '--user-data-dir=' + profile, '--window-size=720,1280',
        '--autoplay-policy=no-user-gesture-required', 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(60):
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=5) as r:
                    tabs = json.load(r)
                target = next((t for t in tabs if t.get('type') == 'page'), None)
                if target:
                    break
            except Exception:
                pass
            time.sleep(0.25)
        ws = WS(target['webSocketDebuggerUrl'])
        seq = [0]

        def cmd(method, params=None):
            seq[0] += 1
            ws.send({'id': seq[0], 'method': method, 'params': params or {}})
            while True:
                m = json.loads(ws.recv_text())
                if m.get('id') == seq[0]:
                    return m

        cmd('Page.enable')
        cmd('Page.navigate', {'url': URL})
        time.sleep(9)                      # 等素材+音频都预加载好
        res = cmd('Runtime.evaluate', {'expression': PROBE, 'returnByValue': True,
                                       'awaitPromise': False})
        r = res.get('result', {})
        if 'exceptionDetails' in r:
            print('JS 异常:', json.dumps(r['exceptionDetails'], ensure_ascii=False)[:600])
        print(r.get('result', {}).get('value'))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    main()
