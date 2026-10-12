"""临时诊断：物理层审计 —— 参数实验版。

用同一套确定性球堆（26 次投放 + 静置 7 秒），逐个试不同物理参数，
量四个指标，找出"球堆几乎不睡觉 / 一直在微抖"的真正原因：

  睡着比例   静止后多少球睡着（越高越好，说明书里休眠本来就是为了省 CPU + 消抖）
  最大穿透   球堆糊成一坨的程度（越小越好）
  静置位移   60 步的总位移（越小越安静）
  悬空球     必须始终为 0（= "球悬空"bug 没复发）

用法：python tools/_phys_audit.py [地址]
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

AUDIT_JS = r"""
(function () {
  var G = window.G, g = window.__game;
  var M = G.Physics.Matter;

  var BASE = {
    sepMinPenetration: G.PHYSICS.sepMinPenetration,
    sepPasses: G.PHYSICS.sepPasses,
    sleepThreshold: G.PHYSICS.ball.sleepThreshold,
    slop: G.PHYSICS.ball.slop,
    frictionAir: G.PHYSICS.ball.frictionAir
  };

  function applyVariant(ov) {
    G.PHYSICS.sepMinPenetration = BASE.sepMinPenetration;
    G.PHYSICS.sepPasses = BASE.sepPasses;
    G.PHYSICS.ball.sleepThreshold = BASE.sleepThreshold;
    G.PHYSICS.ball.slop = BASE.slop;
    G.PHYSICS.ball.frictionAir = BASE.frictionAir;
    for (var k in ov) {
      if (k === 'sleepThreshold' || k === 'slop' || k === 'frictionAir') G.PHYSICS.ball[k] = ov[k];
      else G.PHYSICS[k] = ov[k];
    }
  }

  function buildPile(n) {
    g.startGame();
    g.reset();
    var seed = 12345;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i = 0; i < n; i++) {
      var tier = Math.floor(rnd() * 5);
      var x = G.FIELD.x + 60 + rnd() * (G.FIELD.w - 120);
      g.dropAt(tier, x);
      g.simulate(22);
    }
    g.simulate(420);                       // 静置 ~7 秒
    return rnd;
  }

  function countFloaters(balls) {
    var out = [];
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (!b.isSleeping) continue;
      if ((b.position.y + b.circleRadius) >= (G.FIELD.floorY - 2)) continue;   // 在地板上
      var ok = false, nearest = 1e9, nearestDy = 0;
      for (var j = 0; j < balls.length; j++) {
        if (i === j) continue;
        var o = balls[j];
        var dx = o.position.x - b.position.x, dy = o.position.y - b.position.y;
        var dist = Math.sqrt(dx * dx + dy * dy) - (b.circleRadius + o.circleRadius);
        if (dist < nearest) { nearest = dist; nearestDy = dy; }
        var reach = b.circleRadius + o.circleRadius + 6;
        if (dx * dx + dy * dy <= reach * reach && dy > -2) ok = true;
      }
      if (ok) continue;
      // 把"贴墙/贴地"也算支撑 —— 上下左右墙都是静态刚体
      var dLeft = b.position.x - G.FIELD.x, dRight = G.FIELD.right - b.position.x;
      var wallGap = Math.min(dLeft, dRight) - b.circleRadius;
      out.push({
        tier: b.game.tier,
        x: +b.position.x.toFixed(0), y: +b.position.y.toFixed(0),
        离最近球的间隙: +nearest.toFixed(1),
        最近球在下方吗: nearestDy > -2,
        离侧墙间隙: +wallGap.toFixed(1),
        离地: +(G.FIELD.floorY - (b.position.y + b.circleRadius)).toFixed(1),
        判定: wallGap < 4 ? '贴墙（其实是支撑，检测器误报）' :
              (nearest < 8 ? '紧贴其它球（误报）' : '★ 真悬空')
      });
    }
    return out;
  }

  function jitter(steps) {
    var arr = g.phys.balls(), last = [], total = 0, i;
    for (i = 0; i < arr.length; i++) last.push({ x: arr[i].position.x, y: arr[i].position.y });
    for (var s = 0; s < steps; s++) {
      g.phys.step();
      for (i = 0; i < arr.length; i++) {
        total += Math.abs(arr[i].position.x - last[i].x) + Math.abs(arr[i].position.y - last[i].y);
        last[i].x = arr[i].position.x; last[i].y = arr[i].position.y;
      }
    }
    return +total.toFixed(1);
  }

  function run(name, ov) {
    applyVariant(ov);
    buildPile(44);                         // 更大的球堆，确认结论在深堆下也成立
    var balls = g.phys.balls(), asleep = 0;
    for (var i = 0; i < balls.length; i++) if (balls[i].isSleeping) asleep++;
    var pen = g.phys.penetration();
    return {
      配置: name,
      球数: balls.length,
      睡着: asleep + '/' + balls.length + ' (' + Math.round(asleep / Math.max(1, balls.length) * 100) + '%)',
      最大穿透: +pen.max.toFixed(2),
      静置位移: jitter(60),
      悬空球: countFloaters(balls)
    };
  }

  /* A/B 实验：合成删球后如何叫醒球
   *   'near' = 现状（只叫醒"够得着"的球）      'all' = 叫醒场上所有睡着的球
   * 假设：near 策略下，若"上面的球 → 中间球 → 被删掉的两颗"形成两级链，
   *       中间球被叫醒后侧滑离开，最上面那颗就没人叫了 → 悬空。 */
  var origRemove = G.Physics.removeBall;
  function setWakeMode(mode) {
    G.Physics.removeBall = function (body) {
      var px = body.position.x, py = body.position.y, r = body.circleRadius || 0;
      this.Matter.Composite.remove(this.world, body);
      if (mode === 'all') {
        var arr = this.balls();
        for (var i = 0; i < arr.length; i++) if (arr[i].isSleeping) this.Matter.Sleeping.set(arr[i], false);
      } else {
        this.wakeNear(px, py, r + 4);
      }
      return this;
    };
  }

  /* 只算"★ 真悬空"：贴墙/紧贴其它球是检测器误报，物理兜底会正确排除它们 */
  function realFloaters(balls) {
    var f = countFloaters(balls), out = [], i;
    for (i = 0; i < f.length; i++) if (f[i].判定.indexOf('★') >= 0) out.push(f[i]);
    return out;
  }

  /* 统计兜底触发次数/叫醒球数 —— 直接证明兜底在工作 */
  var rescueCalls = 0, rescueWakes = 0;
  var origRescue = G.Physics.rescueFloaters;
  if (origRescue) {
    G.Physics.rescueFloaters = function () {
      var n = origRescue.apply(this, arguments);
      rescueCalls++; rescueWakes += n; return n;
    };
  }

  function onePile(seed) {
    g.startGame();
    g.reset();
    var s = seed;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    for (var i = 0; i < 44; i++) {
      var tier = Math.floor(rnd() * 5);
      var x = G.FIELD.x + 60 + rnd() * (G.FIELD.w - 120);
      g.dropAt(tier, x);
      g.simulate(22);
    }
    g.simulate(420);
    var balls = g.phys.balls(), asleep = 0;
    for (var k = 0; k < balls.length; k++) if (balls[k].isSleeping) asleep++;
    return { n: balls.length, asleep: asleep, floaters: realFloaters(balls).length };
  }

  function series(mode) {
    setWakeMode(mode);
    var tot = { 球: 0, 睡着: 0, 真悬空: 0, 轮数: 5 };
    for (var i = 0; i < 5; i++) {
      var r = onePile(12345 + i * 7919);
      tot.球 += r.n; tot.睡着 += r.asleep; tot.真悬空 += r.floaters;
    }
    return tot;
  }

  var out = {
    near策略_只叫醒够得着的: series('near'),
    all策略_叫醒全部睡着的: series('all'),
    兜底扫描次数: rescueCalls,
    兜底叫醒球次数: rescueWakes
  };
  G.Physics.removeBall = origRemove;
  applyVariant({});
  return JSON.stringify(out, null, 1);
})()
"""


def main():
    port = 9449
    profile = tempfile.mkdtemp(prefix='cdpaudit_')
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
        r = cmd('Runtime.evaluate', {'expression': AUDIT_JS, 'returnByValue': True,
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
