/* =============================================================================
 * 物理封装
 * -----------------------------------------------------------------------------
 * 这一层把 Matter.js 包起来，只暴露游戏需要的语义：创建球、删球、跑一步、
 * 修穿透。换物理引擎只需要改这个文件。
 *
 * 关键调优（实测有效，详见 docs/方案.md 第 5 节）：
 *  1. 固定步长 1/60，每帧最多补 5 步 —— 物理与屏幕刷新率解耦。
 *  2. 位置迭代 10 次（Matter 默认 6），球挤球时默认值解不开重叠。
 *  3. 几何分离修正：物理步之后，把仍然深嵌的球对解析分开。
 *     ★ 必须同时平移 position 和 positionPrev，否则 Matter 会把这次位移
 *       当成速度，下一帧球会像被弹开一样炸掉。
 *  4. 静止球休眠，省 CPU 且消除堆叠抖动。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;
  var P = G.Physics = {
    engine: null,
    world: null,
    Matter: null,
    _onMergePair: null,

    /* Matter 由适配层加载后注入（网页 = <script>，微信 = require） */
    create: function (Matter) {
      this.Matter = Matter;
      var Pcfg = G.PHYSICS;
      var engine = this.engine = Matter.Engine.create();
      engine.gravity.y = Pcfg.gravityY;
      engine.enableSleeping = Pcfg.enableSleeping;
      engine.positionIterations = Pcfg.positionIterations;
      engine.velocityIterations = Pcfg.velocityIterations;
      engine.constraintIterations = Pcfg.constraintIterations;
      this.world = engine.world;

      var F = G.FIELD, T = Pcfg.wall, L = G.LAYOUT;
      var opt = {
        isStatic: true, label: 'wall',
        friction: T.friction, restitution: T.restitution
      };
      // 左右墙与地板。厚度取 L.wallThickness（80px）而不是薄薄一条：
      // 离散碰撞下薄墙会被高速球一帧跨过，这是穿墙的根本原因。
      var T2 = L.wallThickness;
      Matter.Composite.add(this.world, [
        Matter.Bodies.rectangle(F.x - T2 / 2, F.y + F.h / 2,
          T2, F.h + T2 * 4, opt),
        Matter.Bodies.rectangle(F.right + T2 / 2, F.y + F.h / 2,
          T2, F.h + T2 * 4, opt),
        Matter.Bodies.rectangle(G.DESIGN.w / 2, F.floorY + T2 / 2,
          F.w + T2 * 2, T2, opt)
      ]);

      // 每次碰撞开始都检查一次合成
      Matter.Events.on(engine, 'collisionStart', function (ev) {
        for (var i = 0; i < ev.pairs.length; i++) {
          var a = ev.pairs[i].bodyA, b = ev.pairs[i].bodyB;
          if (a.game && b.game && P._onMergePair) P._onMergePair(a, b);
        }
      });
      return this;
    },

    onMergePair: function (fn) { this._onMergePair = fn; },

    /* 创建一个球体。半径 = 阶级配置的 radius × collisionScale（碰撞比贴图略小），
     * x/y 是初始位置。Matter 会把半径写进 body.circleRadius，后面所有物理
     * （分离修正、越线判定以外的部分）用的都是这个值 ✓ */
    addBall: function (tier, x, y) {
      var M = this.Matter;
      var radius = G.THEME.tiers[tier].radius * (G.PHYSICS.collisionScale || 1);
      var cfg = G.PHYSICS.ball;
      var body = M.Bodies.circle(x, y, radius, {
        label: 'ball',
        restitution: cfg.restitution,
        friction: cfg.friction,
        frictionStatic: cfg.frictionStatic,
        frictionAir: cfg.frictionAir,
        density: cfg.density,
        slop: cfg.slop,
        sleepThreshold: cfg.sleepThreshold
      });
      body.game = {
        tier: tier, born: 0, over: 0, dead: false,
        // 渲染插值用的自有快照。★ 不能用 Matter 的 positionPrev：
        // 它在 Resolver.solveVelocity 里被直接累加冲量、被 postSolvePosition
        // 平移、被 Sleeping.set 重置，语义是"本步开始时的位置 + 求解修正"，
        // 不是"上一帧的渲染位置"。拿它插值会看到细碎的抖。
        prevX: x, prevY: y, prevA: body.angle
      };
      M.Composite.add(this.world, body);
      return body;
    },

    /* 删除一个球。
     * ★ 2026-10-12：删球时必须**叫醒附近睡着的球** —— 否则压在它上面的球
     *   （它已经睡着了，而 Matter 不对睡着的球做重力积分）会永远停在半空，
     *   就是用户朋友报的"球悬空"bug。**合成删球走的就是这条路。** */
    removeBall: function (body) {
      var px = body.position.x, py = body.position.y;
      this.Matter.Composite.remove(this.world, body);
      this.wakeNear(px, py, (body.circleRadius || 0) + 4);
      return this;
    },

    /* 叫醒 (x,y) 附近 reach 距离内的球。
     * 休眠的球不受重力、也不会被"邻居消失"这种非碰撞事件唤醒，
     * 所以凡是可能让它失去支撑的操作之后，都要主动叫一次。 */
    wakeNear: function (x, y, reach) {
      var arr = this.balls(), n = 0;
      for (var i = 0; i < arr.length; i++) {
        var b = arr[i];
        if (!b.isSleeping) continue;
        var dx = b.position.x - x, dy = b.position.y - y;
        var rr = (reach || 0) + (b.circleRadius || 0);
        if (dx * dx + dy * dy > rr * rr) continue;
        this.Matter.Sleeping.set(b, false);
        n++;
      }
      return n;
    },

    /* 一次固定步长的推进 */
    step: function () {
      var Pcfg = G.PHYSICS;
      this.snapshotPrev();                 // 必须在积分之前：记下"这一步之前的位置"
      this.Matter.Engine.update(this.engine, Pcfg.fixedStepMs);
      if (Pcfg.maxSpeed > 0) this.clampSpeed(Pcfg.maxSpeed);
      if (Pcfg.sepPasses > 0) this.separate(this.balls(), Pcfg.sepPasses);
      if (Pcfg.contain) {
        var escaped = this.contain();
        if (escaped) this._lastContained = escaped;
      }
      /* ★ 2026-10-12 审计：兜底捞出"悬空还睡着"的球。合成删球那条主路径已经在
       * removeBall 里堵了，但极端堆型下仍会漏出极少数（根因未完全定位），
       * 所以每 N 步扫一次：睡着 + 没碰地板 + 没贴墙 + 下方 reach 内没球 → 叫醒它。
       * 误报的代价极低（只是让球晚 0.75 秒再睡），所以这层兜底很划算。 */
      if (Pcfg.rescueFloat !== false) {
        this._rescueTick = (this._rescueTick || 0) + 1;
        if (this._rescueTick >= (Pcfg.rescueFloatSteps || 30)) {
          this._rescueTick = 0;
          this._lastRescued = this.rescueFloaters();
        }
      }
    },

    /* 把"悬空且睡着"的球叫醒（叫醒后它们会自己掉下来）。
     * 返回本次叫醒的数量；诊断/回归用得上。 */
    rescueFloaters: function () {
      var arr = this.balls(), F = G.FIELD, n = 0, i, j;
      for (i = 0; i < arr.length; i++) {
        var b = arr[i];
        if (!b.isSleeping) continue;
        var r = b.circleRadius;
        if (b.position.y + r >= F.floorY - 2) continue;                    // 在地板上
        if (b.position.x - F.x - r < 3 || F.right - b.position.x - r < 3) continue;  // 贴侧墙
        var ok = false;
        for (j = 0; j < arr.length && !ok; j++) {
          if (j === i) continue;
          var o = arr[j];
          var dx = o.position.x - b.position.x, dy = o.position.y - b.position.y;
          var reach = r + o.circleRadius + 6;
          if (dx * dx + dy * dy <= reach * reach && dy > -2) ok = true;
        }
        if (!ok) { this.Matter.Sleeping.set(b, false); n++; }
      }
      return n;
    },

    /* 把当前位置写进自有快照，供渲染插值使用。
     * 为什么不用 Matter 的 positionPrev：见 addBall 里的注释。 */
    snapshotPrev: function () {
      var arr = this.balls();
      for (var i = 0; i < arr.length; i++) {
        var b = arr[i];
        b.game.prevX = b.position.x;
        b.game.prevY = b.position.y;
        b.game.prevA = b.angle;
      }
      return arr.length;
    },

    /* 传送一个球（不污染速度）：同步平移自有快照，插值不会把它画成滑行。
     * 注意 Matter 的 Body.setPosition 默认也会同步平移 positionPrev，
     * 但不会更新缓存的碰撞对，所以传送后建议紧跟 Engine.clear。 */
    teleport: function (body, x, y) {
      var dx = x - body.position.x, dy = y - body.position.y;
      this._shift(body, dx, dy);
      body.game.prevX = x;
      body.game.prevY = y;
      return body;
    },

    /* ---------------- 最后防线：把跑出场地的球拉回来 ----------------
     * 什么情况下会跑出去：球堆被挤到极深（例如多个球重叠生成）时，Matter 的
     * 位置修正可能把球弹穿墙体。球一旦到了墙外，重力会让它永远下落，
     * 这一局就废了。
     * 正常游玩永远走不到这里（球是一个一个从顶部掉的），
     * 但作为兜底很便宜：只检查一个包围盒，跑出去的球贴回墙面并清掉朝墙速度。
     * ---------------------------------------------------------------- */
    contain: function () {
      var F = G.FIELD, arr = this.balls(), n = 0;
      for (var i = 0; i < arr.length; i++) {
        var b = arr[i], r = b.circleRadius, x = b.position.x, y = b.position.y;
        var nx = x, ny = y, hit = false;
        if (x < F.x + r) { nx = F.x + r; hit = true; }
        else if (x > F.right - r) { nx = F.right - r; hit = true; }
        if (y > F.floorY - r) { ny = F.floorY - r; hit = true; }
        if (!hit) continue;
        this._shift(b, nx - x, ny - y);
        if (this.Matter.Body.setVelocity) {
          var vx = b.velocity.x, vy = b.velocity.y;
          if (nx !== x) vx = 0;
          if (ny !== y) vy = 0;
          this.Matter.Body.setVelocity(b, { x: vx, y: vy });
        }
        if (b.isSleeping) this.Matter.Sleeping.set(b, false);
        n++;
      }
      return n;
    },

    /* ---------------- 速度上限 ----------------
     * 高速球（自由落体到底部时可达 25px/帧）可能一帧跨过 16px 厚的墙，
     * 也就是 tunneling。限制单帧位移上限，从源头堵住穿墙/穿地板。
     * ------------------------------------------ */
    clampSpeed: function (max) {
      var arr = this.balls(), clamped = 0;
      for (var i = 0; i < arr.length; i++) {
        var b = arr[i];
        var vx = b.velocity.x, vy = b.velocity.y;
        var sp = Math.sqrt(vx * vx + vy * vy);
        if (sp > max) {
          var k = max / sp;
          this.Matter.Body.setVelocity(b, { x: vx * k, y: vy * k });
          clamped++;
        }
      }
      return clamped;
    },

    /* 把当前位置同时写进自有插值快照。
     * 新生成的球必须调一次，否则第一帧它会被插值成"从旧位置飞过来"。 */
    syncSnapshot: function (body) {
      body.game.prevX = body.position.x;
      body.game.prevY = body.position.y;
      body.game.prevA = body.angle;
      return body;
    },

    balls: function () {
      var out = [], list = this.Matter.Composite.allBodies(this.world);
      for (var i = 0; i < list.length; i++) if (list[i].game) out.push(list[i]);
      return out;
    },

    /* ---------------- 几何分离修正 ----------------
     * 按质量比例把重叠的两个球推开，只动位置不动速度。
     * 同时平移 positionPrev，避免 Matter 把它当成速度。
     *
     * ★ 三个坑（都是实测踩出来的）：
     *   1) 两球圆心完全重合时距离为 0，法线无法计算 —— 直接相除会得到天文
     *      数字的位移，球被弹到场地外几千像素。这里给重合情况一个确定性法线，
     *      并限制单次最大修正量。
     *   2) 必须同时平移 positionPrev，否则 Matter 下一帧会把它当速度。
     *   3) 修正**不能把球推进墙里**。球堆挤压时，修正方向可能恰好指向地板或
     *      侧墙，越修越深，最后球整个穿出场地。这里落地后做一次边界校验，
     *      会把球推出场地的修正直接撤销。（曾被这个坑让球掉到 y=4100）
     * ---------------------------------------------- */
    separate: function (arr, passes) {
      var minPen = G.PHYSICS.sepMinPenetration;
      var MAX_FIX = 24;          // 单次单球最大修正像素，防止爆冲
      for (var pass = 0; pass < passes; pass++) {
        var moved = 0;
        for (var i = 0; i < arr.length; i++) {
          var a = arr[i];
          if (a.isStatic) continue;
          for (var j = i + 1; j < arr.length; j++) {
            var b = arr[j];
            if (b.isStatic) continue;
            var dx = b.position.x - a.position.x;
            var dy = b.position.y - a.position.y;
            var rs = a.circleRadius + b.circleRadius;
            var d2 = dx * dx + dy * dy;
            if (d2 >= rs * rs) continue;
            var d = Math.sqrt(d2);
            var nx, ny;
            if (d < 1e-6) {
              // 完全重合：给一个确定性的分离方向，避免除零
              var ang = (i * 2.399963 + j * 0.785398) % (Math.PI * 2);
              nx = Math.cos(ang); ny = Math.sin(ang);
              d = 0;
            } else {
              nx = dx / d; ny = dy / d;
            }
            var pen = Math.min(rs - d, MAX_FIX);
            if (pen < minPen) continue;
            var tot = a.mass + b.mass || 1;
            var sa = pen * (b.mass / tot);
            var sb = pen * (a.mass / tot);

            // 记录并试推
            var ax = a.position.x, ay = a.position.y;
            var bx = b.position.x, by = b.position.y;
            this._shift(a, -nx * sa, -ny * sa);
            this._shift(b, nx * sb, ny * sb);
            var bad = false;
            if (!this.insideArena(a)) { this._restore(a, ax, ay); bad = true; }
            if (!this.insideArena(b)) { this._restore(b, bx, by); bad = true; }
            if (!bad) moved++;
          }
        }
        if (!moved) break;
      }
      return moved;
    },

    /* 球是否还在场地内（含墙厚容差与少量重叠余量）。
     * 用来否决"把球推进墙里"的分离修正。 */
    insideArena: function (body) {
      var F = G.FIELD, r = body.circleRadius;
      var m = G.LAYOUT.wallThickness + G.PHYSICS.ball.slop + 2;
      var x = body.position.x, y = body.position.y;
      return x > F.x - r - m && x < F.right + r + m &&
        y > F.y - r - m && y < F.floorY + r + m;
    },

    _restore: function (body, x, y) {
      this._shift(body, x - body.position.x, y - body.position.y);
    },

    _shift: function (body, dx, dy) {
      body.position.x += dx; body.positionPrev.x += dx;
      body.position.y += dy; body.positionPrev.y += dy;
      /* ★ 2026-10-12：被挪动过的球必须叫醒 —— 睡着的球不受重力，
       * 万一这次挪动让它失去了支撑（分离修正把它顶起来、传送把它挪走），
       * 它就会悬在半空。叫醒后它会自己重新落定（稳定 0.75 秒后又睡回去）。 */
      if (body.isSleeping) this.Matter.Sleeping.set(body, false);
    },

    /* ---------------- 诊断：最大穿透量 ----------------
     * 这是"球堆有没有糊成一坨"的客观指标。回归测试用它守住质量。
     * -------------------------------------------------- */
    penetration: function (arr) {
      arr = arr || this.balls();
      var maxPen = 0, sum = 0, pairs = 0, i, j;
      for (i = 0; i < arr.length; i++) {
        for (j = i + 1; j < arr.length; j++) {
          var dx = arr[i].position.x - arr[j].position.x;
          var dy = arr[i].position.y - arr[j].position.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          var pen = (arr[i].circleRadius + arr[j].circleRadius) - d;
          if (pen > 0) { pairs++; sum += pen; if (pen > maxPen) maxPen = pen; }
        }
      }
      return { max: maxPen, avg: pairs ? sum / pairs : 0, pairs: pairs, count: arr.length };
    },

    /* 清空所有球。会一并清掉引擎内部的碰撞对/检测器缓存，
     * 否则新一局的球可能和"上一局的幽灵"继续判定碰撞。 */
    clear: function () {
      var M = this.Matter, list = this.balls();
      for (var i = 0; i < list.length; i++) M.Composite.remove(this.world, list[i]);
      if (M.Engine.clear) {
        try { M.Engine.clear(this.engine); } catch (e) { /* 老版本没有这个 API */ }
      }
      this._lastContained = 0;
      return this;
    }
  };
})(typeof window !== 'undefined' ? window : this);
