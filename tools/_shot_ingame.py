"""临时脚本：进游戏后再截图（shot.py 只会截"刚打开"的画面）。

用途：验证开始界面点"开始游戏"之后的游戏内画面（尤其右上角那个"返回"按钮）。
流程：打开页面 → 等加载 → 调 startGame() 并摆几颗球 → 等 2 秒 → 截图 + 打印状态。
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_eval import WS, find_browser

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080/web/?mute=1'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'tools/_shot_ingame.png'

ENTER_JS = r"""
(function () {
  var G = window.G, g = window.__game;
  g.startGame();                       // 相当于点了"开始游戏"
  // 摆几颗不同阶的球，画面才有内容（dropAt 是调试入口，不受开始界面限制）
  var F = G.FIELD, tiers = [0, 1, 2, 3, 4];
  for (var i = 0; i < tiers.length; i++) {
    g.dropAt(tiers[i], F.x + 90 + i * 110);
  }
  g.simulate(60);                      // 让它们落下来
  return JSON.stringify({
    screen: g.screen,
    balls: g.phys.balls().length,
    bgmAt: g.bgmAt,
    hits: (g.render.hits || []).map(function (h) { return h.action + (h.key ? ':' + h.key : ''); })
  });
})()
"""


def main():
    port = 9444
    profile = tempfile.mkdtemp(prefix='cdpshot_')
    proc = subprocess.Popen([
        find_browser(), '--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=%d' % port,
        '--user-data-dir=' + profile,
        '--window-size=720,1280', 'about:blank',
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
        time.sleep(6)
        r = cmd('Runtime.evaluate', {'expression': ENTER_JS, 'returnByValue': True,
                                     'awaitPromise': False})
        print('进入游戏:', r.get('result', {}).get('result', {}).get('value'))
        time.sleep(2)
        shot = cmd('Page.captureScreenshot', {'format': 'png'})
        data = shot.get('result', {}).get('data')
        if not data:
            print('截图失败:', json.dumps(shot)[:300])
            return
        out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), OUT) \
            if not os.path.isabs(OUT) else OUT
        with open(out, 'wb') as f:
            f.write(base64.b64decode(data))
        print('已保存:', out, os.path.getsize(out), 'bytes')
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    main()
