"""临时诊断：复现"球悬空"（悬浮）问题，并验证候选修法是否有效。

背景：物理开了休眠（enableSleeping + sleepThreshold=45）。
      合成时 `game._flushRemovals()` 直接 `removeBall()` 抽掉支撑球，
      但**没有任何"叫醒周围球"的动作** —— 睡着的球失去支撑后没人叫它，
      它就一直停在原地（悬空）。

用法：python tools/_float_probe.py [地址]
输出：两个场景的位置数据 + 是否悬空的结论。
"""
import base64  # noqa: F401  (与 _shot_ingame.py 保持同一套模板)
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

# 两个场景用同一套摆法：大球落地睡着 → 小球压在上面也睡着 → 抽掉大球
#   A：不叫醒任何球（当前行为）→ 预期小球悬空
#   B：抽球后叫醒所有球      → 预期小球落回地面（候选修法）
SCENARIO_JS = r"""
(function () {
  var G = window.G, g = window.__game;

  /* 直接验证底层机制：把一颗球摆到半空、强制休眠，看它会不会掉下来。
   *   A（不叫醒）：如果它一直停在半空 → 证明"睡着的球失去支撑后会悬空"
   *   B（叫醒后）：应当立刻自由落体到地面 → 证明候选修法有效
   * 现实中对应的触发：球睡着之后，脚下的支撑球被合成删掉了（removeBall），
   * 没有任何碰撞事件去叫醒它，于是它就停在半空。 */
  function run(wake) {
    g.startGame();
    g.reset();
    var M = G.Physics.Matter;
    var b = g.dropAt(2, 360);
    var startY = G.FIELD.floorY - 200;              // 半空（离地 200px）
    M.Body.setPosition(b, { x: 360, y: startY });
    M.Body.setVelocity(b, { x: 0, y: 0 });
    M.Sleeping.set(b, true);                        // 强制入睡
    g.simulate(120);                                // 走 2 秒物理
    var y1 = b.position.y, sleeping = !!b.isSleeping;
    var fellByItself = y1 - startY;
    if (wake) { M.Sleeping.set(b, false); g.simulate(120); }
    return {
      startY: +startY.toFixed(1),
      两秒后Y: +y1.toFixed(1),
      两秒内下落: +fellByItself.toFixed(1),
      还在睡: sleeping,
      叫醒后Y: +b.position.y.toFixed(1),
      落地应有Y: +(G.FIELD.floorY - b.circleRadius).toFixed(1),
      结论: fellByItself < 1 ? '悬空（睡着的球不受重力）' : '正常下落'
    };
  }

  return JSON.stringify({
    A_不叫醒: run(false),
    B_叫醒后: run(true)
  }, null, 1);
})()
"""


def main():
    port = 9447
    profile = tempfile.mkdtemp(prefix='cdpfloat_')
    proc = subprocess.Popen([
        find_browser(), '--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=%d' % port,
        '--user-data-dir=' + profile, '--window-size=720,1280', 'about:blank',
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
        r = cmd('Runtime.evaluate', {'expression': SCENARIO_JS, 'returnByValue': True,
                                     'awaitPromise': False})
        res = r.get('result', {}).get('result', {})
        if res.get('value') is None:
            print('执行失败:', json.dumps(r, ensure_ascii=False)[:600])
            return
        print(res['value'])
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    main()
