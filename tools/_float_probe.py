"""临时诊断：验证"球悬空"（悬浮）问题 —— 复现机制 + 验证修复。

背景（2026-10-12 用户朋友报告"球有时浮在空中"）：
    物理开了休眠（enableSleeping + sleepThreshold=45）。
    Matter **不对睡着的球做重力积分**，而"邻居消失"不是碰撞事件、
    不会唤醒它 —— 所以球睡着后一旦失去支撑，就会永远停在半空。
    触发路径：合成删球（phys.removeBall）、分离修正/传送（_shift）。
修复（2026-10-12）：
    · `_shift()` 里叫醒被挪动的球
    · `removeBall()` 之后叫醒附近睡着的球（`wakeNear`）

用法：python tools/_float_probe.py [地址]
输出三个场景：
    A 底层机制（隔离球强制休眠，游戏里不会出现）→ 仍然悬空，属 Matter 原始行为
    B 同样条件手动叫醒 → 立刻掉落
    C 游戏真实路径（抽走支撑球 = 合成删球）→ 修复后应当正常掉落
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

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080/web/?mute=1'

SCENARIO_JS = r"""
(function () {
  var G = window.G, g = window.__game;

  /* A/B：把一颗球摆到半空、强制休眠，看它会不会掉下来。
   * 这是底层机制的直接证明（现实中对应的触发见 C）。 */
  function isolated(wake) {
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
    if (wake) { M.Sleeping.set(b, false); g.simulate(120); }
    return {
      startY: +startY.toFixed(1),
      两秒后Y: +y1.toFixed(1),
      两秒内下落: +(y1 - startY).toFixed(1),
      还在睡: sleeping,
      叫醒后Y: +b.position.y.toFixed(1),
      落地应有Y: +(G.FIELD.floorY - b.circleRadius).toFixed(1),
      结论: (y1 - startY) < 1 ? '悬空（睡着的球不受重力）' : '正常下落'
    };
  }

  /* C：完全走游戏里"合成删球"的同一条路（phys.removeBall），
   * 看上面睡着的球会不会被叫醒并落下来 —— 修复后的正体验证。 */
  function gamePath() {
    g.startGame();
    g.reset();
    var M = G.Physics.Matter;
    var cScale = G.PHYSICS.collisionScale || 1;
    var rBase = G.THEME.tiers[1].radius * cScale;
    var rTop = G.THEME.tiers[0].radius * cScale;
    var sup = g.dropAt(1, 360);
    M.Body.setPosition(sup, { x: 360, y: G.FIELD.floorY - rBase });
    M.Body.setVelocity(sup, { x: 0, y: 0 });
    var up = g.dropAt(0, 360);
    M.Body.setPosition(up, { x: 360, y: G.FIELD.floorY - rBase * 2 - rTop });
    M.Body.setVelocity(up, { x: 0, y: 0 });
    g.phys.syncSnapshot(up);
    M.Sleeping.set(up, true);                 // 上面的球先睡着
    var y0 = up.position.y;
    g.phys.removeBall(sup);                   // ← 合成删球走的就是这一步
    var woke = !up.isSleeping;
    g.simulate(120);
    var fell = up.position.y - y0;
    return {
      抽走支撑前Y: +y0.toFixed(1),
      是否被叫醒: woke,
      两秒后Y: +up.position.y.toFixed(1),
      下落: +fell.toFixed(1),
      结论: fell > 20 ? '正常掉落（已修复 ✅）' : '仍然悬空 ❌'
    };
  }

  return JSON.stringify({
    A_底层机制_不叫醒: isolated(false),
    B_手动叫醒对照: isolated(true),
    C_游戏真实路径_抽走支撑: gamePath()
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
