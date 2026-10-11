"""临时脚本：验证"云端切版本时球体贴图不再闪占位球"。

为什么需要它：本地服务器瞬间加载，这个 bug 只在云端（GitHub Pages / Cloudflare）才看得到。
它做三件事：
  ① 页面刚加载完 → 看正常版的 8 张贴图是否都进了 textures[].img（这是"兜底能用"的前提）
  ② 切到地狱版的**同一帧** → 看 drawBall 会拿到什么（贴图 / 兜底图 / 占位球）← 本次修复的核心
  ③ 再等几秒 → 看后台预加载是否把地狱版的 8 个槽位也填好了（以后切版本就零延迟）

用法:
    python tools/_texture_probe.py                 # 本地
    python tools/_texture_probe.py <线上地址>       # 线上（如 GitHub Pages）
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

PROBE_A = r"""
(function () {
  var G = window.G, g = window.__game, R = G.Render;
  function cacheStat() {
    var out = {};
    for (var k in R.textureCache) {
      var n = 0, t = 0;
      for (var tier in R.textureCache[k]) { t++; if (R.textureCache[k][tier]) n++; }
      out[k] = n + '/' + t + ' 张有图';
    }
    return out;
  }
  function imgCount() {
    var n = 0;
    for (var i = 0; i < R.textures.length; i++) { if (R.textures[i] && R.textures[i].img) n++; }
    return n + '/' + R.textures.length;
  }
  var before = {
    阶段: '① 页面刚加载完（正常版）',
    'textures[].img 有图': imgCount(),
    各版本缓存: cacheStat(),
    当前贴图版本: G.textureVariantName(),
    地狱版还在下载: R.variantPending ? R.variantPending('hell') : '无此接口'
  };

  g.setNameVersion('hell');                 // ← 切到地狱版
  var tex = R.textures[3];
  var direct = R._textureFor(3);            // 地狱版自己的图（没下载好就是 null）
  var fb = tex && tex.img;                  // 已经加载过的那张（正常版）
  var after = {
    阶段: '② 切到地狱版的同一帧（关键）',
    当前贴图版本: G.textureVariantName(),
    '地狱版缓存里已有这张吗': !!(R.textureCache.hell && R.textureCache.hell[3]),
    'drawBall 实际会用': (direct || fb) ? '贴图（不会闪占位球）✅' : '占位球（❌ 还没修好）',
    '这张图的来源': direct ? '地狱版自己的图' : (fb ? '已加载过的兜底图 ← 本次修复点' : '没有可用的图'),
    地狱版还在下载: R.variantPending ? R.variantPending('hell') : '无此接口'
  };

  // ②b 精确模拟"新版本贴图还没下载好"（云端第一次切版本就是这状态）：
  //     清空地狱版缓存，看 drawBall 那一行表达式取到的是什么；测完把缓存还原。
  var sentinel = R.textures[3] && R.textures[3].img;
  var savedHell = R.textureCache.hell;
  R.textureCache.hell = {};
  var got = R._textureFor(3) || (R.textures[3] && R.textures[3].img) || null;
  var simulate = {
    阶段: '②b 模拟"地狱版贴图完全没下载"（清空缓存后取值）',
    '地狱版自己的图': R.textureCache.hell[3] ? '有' : '没有（模拟成功）',
    'drawBall 会取到': (got && got === sentinel) ? '已加载过的那张贴图 ✅' : (got ? '其它图' : '占位球 ❌'),
    说明: (got && got === sentinel) ? '走的是本次修复的兜底分支，不会闪占位小球 ✅'
                                   : '兜底没生效，还是会闪占位球 ❌'
  };
  R.textureCache.hell = savedHell;      // 还原，免得影响第 ③ 步的统计

  return JSON.stringify([before, after, simulate], null, 1);
})()
"""

PROBE_B = r"""
(function () {
  var G = window.G, R = G.Render;
  var hc = R.textureCache.hell || {};
  var n = 0, t = 0;
  for (var tier in hc) { t++; if (hc[tier]) n++; }
  var total = G.THEME.tiers.length;
  return JSON.stringify({
    阶段: '③ 再等几秒（后台预加载应已完成）',
    '地狱版已就绪': n + '/' + total,
    地狱版还在下载: R.variantPending ? R.variantPending('hell') : '无此接口',
    结论: (n === total) ? '以后切版本就是瞬间生效 ✅' : '还没全好（云端较慢或该版本无专属图）'
  }, null, 1);
})()
"""


def main():
    port = 9556
    profile = tempfile.mkdtemp(prefix='cdptex_')
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
        time.sleep(12)                       # 等素材加载完（云端慢，给足时间）
        print(evaluate(PROBE_A))
        time.sleep(6)                        # 等后台预加载
        print(evaluate(PROBE_B))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    main()
