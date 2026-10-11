"""临时脚本：真实时钟下按顺序执行多步 JS（cdp_eval.py 只能执行一步）。

用途：验证"切到地狱版后贴图是否真的加载出来了"。
切换版本后贴图是**异步懒加载**的，必须等一会儿再读状态，
所以一步到位做不到（cdp_eval 的 awaitPromise=False）。

用法：
    python tools/_cdp_seq.py "http://127.0.0.1:8080/web/?headless=1&mute=1"
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_eval import WS, find_browser      # 复用现成的 WebSocket 客户端

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080/web/?headless=1&mute=1'

# 第 1 步：切到地狱版，并主动触发 8 个阶的懒加载
STEP1 = r"""
(function () {
  var G = window.G, R = G.Render;
  window.__game.setNameVersion('hell');
  var out = {
    step: 'switch-to-hell',
    当前贴图版本: G.textureVariantName(),
    第1阶候选链: G.texturePathCandidates(0),
    切换前_textures0_img: !!R.textures[0].img
  };
  for (var i = 0; i < 8; i++) R._textureFor(i);   // 触发懒加载（异步）
  return JSON.stringify(out);
})()
"""

# 第 2 步：等懒加载跑完，读每个阶的最终状态
STEP2 = r"""
(function () {
  var G = window.G, R = G.Render;
  var cache = (R.textureCache || {}).hell || {};
  var loaded = 0, missing = [];
  for (var i = 0; i < 8; i++) {
    if (cache[i]) loaded++; else missing.push(i + 1);
  }
  return JSON.stringify({
    step: 'after-wait',
    当前贴图版本: G.textureVariantName(),
    地狱版缓存里已加载的阶数: loaded + '/8',
    仍然缺图的阶: missing,
    贴图槽是否已换成真图: R.textures.map(function (t) { return !!t.img; }),
    正常版缓存仍健在: Object.keys((R.textureCache || {}).default || {}).length
  });
})()
"""


def main():
    port = 9333
    profile = tempfile.mkdtemp(prefix='cdpseq_')
    proc = subprocess.Popen([
        find_browser(), '--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=%d' % port,
        '--user-data-dir=' + profile, 'about:blank',
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

        def ev(expr):
            res = cmd('Runtime.evaluate', {'expression': expr, 'returnByValue': True,
                                           'awaitPromise': False})
            r = res.get('result', {})
            if 'exceptionDetails' in r:
                return 'JS 异常: ' + json.dumps(r['exceptionDetails'], ensure_ascii=False)
            return r.get('result', {}).get('value')

        cmd('Page.enable')
        cmd('Page.navigate', {'url': URL})
        time.sleep(6)                       # 等游戏启动 + 正常版贴图预加载完
        print('--- 启动后 ---')
        print(ev(r"""(function(){var G=window.G,R=G.Render;
          return JSON.stringify({版本:G.textureVariantName(),
            正常版已加载:Object.keys((R.textureCache||{}).default||{}).length+'/8',
            贴图槽:R.textures.map(function(t){return !!t.img;})});})()"""))

        print('--- 切换地狱版 ---')
        print(ev(STEP1))
        time.sleep(3)                       # 等懒加载的 404 回退链跑完
        print('--- 等 3 秒后 ---')
        print(ev(STEP2))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    main()
