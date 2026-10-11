"""临时脚本：验证成就系统"能解锁 + 能持久化"。

做两件事（用全新的浏览器配置，不污染你的存档）：
  ① 清空成就 → 驱动游戏合出一次球 → 检查：统计涨了、成就解锁了、提示条弹出来了
  ② **重新加载页面** → 检查：上面解锁的成就还在（证明真的写进了 localStorage）

用法:
    python tools/_achv_probe.py [url]
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

DRIVE = r"""
(function () {
  var G = window.G, g = window.__game, A = G.Achv;
  A.reset();                                     // 干净起点（只在临时配置里跑）
  g.startGame();
  var F = G.FIELD, x = F.x + F.w / 2;
  g.dropAt(0, x - 24); g.dropAt(0, x + 24);      // 两颗最小阶 → 撞一起就合成
  g.simulate(180);
  var out = {
    阶段: '① 合出一次球之后',
    merges: A.stats.merges,
    games: A.stats.games,
    解锁数: A.count(),
    '首次合成已解锁': !!A.unlocked.first_merge,
    '角色成就已解锁': !!A.unlocked.tier_1,
    '提示条正在显示': (G.Render.achvToast && G.Render.achvToast.t > 0)
        ? G.Render.achvToast.name : '（没有）',
    '存档已写入': (A._ad && A._ad.getData) ? (A._ad.getData(A.KEY) || '').length > 0 : '无存储接口'
  };
  return JSON.stringify(out, null, 1);
})()
"""

AFTER_RELOAD = r"""
(function () {
  var A = window.G.Achv;
  return JSON.stringify({
    阶段: '② 重新加载页面之后（应该还记得）',
    merges: A.stats.merges,
    games: A.stats.games,
    解锁数: A.count(),
    '首次合成还记得': !!A.unlocked.first_merge,
    '角色成就还记得': !!A.unlocked.tier_1,
    结论: (A.stats.merges >= 1 && A.unlocked.first_merge) ? '存档持久化正常 ✅' : '没记住 ❌'
  }, null, 1);
})()
"""


def main():
    port = 9557
    profile = tempfile.mkdtemp(prefix='cdpachv_')     # 全新配置：不碰用户存档
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

        def evaluate(expr):
            res = cmd('Runtime.evaluate', {'expression': expr, 'returnByValue': True,
                                           'awaitPromise': False})
            r = res.get('result', {})
            if 'exceptionDetails' in r:
                return 'JS 异常: ' + json.dumps(r['exceptionDetails'], ensure_ascii=False)[:600]
            return r.get('result', {}).get('value')

        cmd('Page.enable')
        cmd('Page.navigate', {'url': URL})
        print('地址:', URL)
        time.sleep(10)
        print(evaluate(DRIVE))
        print('--- 重新加载页面 ---')
        cmd('Page.navigate', {'url': URL})
        time.sleep(10)
        print(evaluate(AFTER_RELOAD))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        # 清理临时配置
        try:
            import shutil
            shutil.rmtree(profile, ignore_errors=True)
        except Exception:
            pass


if __name__ == '__main__':
    main()
