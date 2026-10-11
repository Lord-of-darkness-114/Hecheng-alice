/* =============================================================================
 * 游戏主逻辑
 * -----------------------------------------------------------------------------
 * 负责：状态机、投放、合成、计分、连击、失败判定、主循环、存档、自测。
 * 完全不碰 DOM / wx API —— 那些交给适配层。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;
  var U = G.util;

  var Game = G.Game = function (Matter, adapter) {
    this.ad = adapter;
    this.phys = G.Physics.create(Matter);
    this.render = G.Render.init(adapter);
    // 命名版本：优先读存档，没有就用默认（正常版）
    var saved = adapter.getNameVersion && adapter.getNameVersion();
    G.setNameVersion(G.NAME_SETS[saved] ? saved : G.NAME_VERSION_DEFAULT);
    /* 载入后先停在**开始界面**，点"开始游戏"才进 play（见 startGame）。
     * bgmAt > 0 = 还有几秒该起 BGM（走游戏时钟倒计时，见 _updateTimers）。 */
    this.screen = 'title';
    this.bgmAt = 0;
    this._achvFrom = 'title';        // 成就面板是从哪个界面打开的（关闭时回到那儿）
    if (G.Achv) G.Achv.init(adapter);   // 接上存档（适配层有 getData/setData 才存）
    this.reset();
    this._last = 0;
    this._acc = 0;
    this._running = false;
    this._raf = 0;

    var self = this;
    this.phys.onMergePair(function (a, b) { self._tryMerge(a, b); });
    return this;
  };

  /* ---------------- 生命周期 ---------------- */
  Game.prototype.reset = function () {
    this.phys.clear();
    this.balls = [];
    this.toRemove = [];
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.dead = false;
    this.paused = false;
    this.muted = G.Sound.muted;
    this._acc = 0;
    this._last = 0;
    this.render.clearFx();
    this.next = this._rollTier();
    this.hold = { tier: this._rollTier() };
    this.holdX = G.DESIGN.w / 2;
    this._dropCd = 0;
    return this;
  };

  Game.prototype.start = function () {
    if (this._running) return this;
    this._running = true;
    this._last = 0;
    var self = this;
    var frame = function (now) {
      if (!self._running) return;
      try {
        self.tick(now);
      } catch (e) {
        // 主循环里抛错会静默冻住整个游戏（尤其定时器驱动时），必须兜住并暴露
        self.errors = self.errors || [];
        if (self.errors.length < 20) self.errors.push(String(e && e.message || e));
        if (root.console) root.console.log('LOOP_ERROR ' + (e && e.message) + ' | ' + (e && e.stack));
      }
      self._raf = self.ad.requestFrame(frame);
    };
    this._raf = this.ad.requestFrame(frame);
    return this;
  };

  Game.prototype.stop = function () {
    this._running = false;
    return this;
  };

  Game.prototype.pause = function (on) {
    this.paused = on !== false;
    this._last = 0;      // 恢复时不要把暂停期间的时间补进物理
    return this;
  };

  /* ---------------- 主循环：固定步长 + 渲染插值 ---------------- */
  Game.prototype.tick = function (now) {
    if (!this._last) this._last = now;
    var dt = now - this._last;
    this._last = now;
    var P = G.PHYSICS;
    if (dt > P.maxFrameMs) dt = P.maxFrameMs;   // 切后台回来别炸
    var seconds = dt / 1000;

    if (!this.paused) {
      this._acc += dt;
      var steps = 0;
      while (this._acc >= P.fixedStepMs && steps < P.maxStepsPerFrame) {
        this.phys.step();
        this._acc -= P.fixedStepMs;
        steps++;
      }
      if (steps === P.maxStepsPerFrame) this._acc = 0;   // 追不上就放弃补步，避免死亡螺旋
      this._flushRemovals();
      this._updateBalls(seconds);
      this._updateTimers(seconds);
    }

    this.render.update(seconds);
    var visual = this._visualBalls();
    this.render.draw({
      balls: visual, hold: this.hold, holdX: this.holdX,
      score: this.score, best: this.best, next: this.next,
      dead: this.dead, paused: this.paused, muted: this.muted, combo: this.combo,
      screen: this.screen
    }, now);
    if (root.__gameLoopHook) root.__gameLoopHook();
    return this;
  };

  /* ---------------- 渲染插值 ----------------
   * 这是"动画丝不丝滑"的关键。
   *
   * 物理固定 60Hz。如果渲染时直接画物理位置，就会出现两种情况：
   *   - 144Hz 屏幕：同一个物理位置被画 2~3 次才更新一次 → 一顿一顿（judder）
   *   - 60Hz 屏幕但刷新与物理不同步：某帧物理走 0 步、下一帧走 2 步 → 抖动
   *
   * 解法：按"当前时刻处于两个物理步之间的比例 alpha"在上一帧位置和当前位置
   * 之间做线性插值。
   *
   * ★ 插值源必须是自己快照的 prevX/prevY，**不能用 Matter 的 positionPrev**：
   *   后者在 Resolver.solveVelocity 里被直接累加冲量、被 postSolvePosition
   *   平移、被 Sleeping.set 重置，语义是"本步开始位置 + 求解修正"，
   *   不是上一帧的渲染位置，拿它插值会看到细碎的抖。
   *
   * alpha 取 [0,1]：acc 是累加器里"还不够一步"的余量，天然就是
   * "当前画面应当停在这一步的哪个位置"。
   * ------------------------------------------ */
  Game.prototype._visualBalls = function () {
    var src = this.phys.balls();
    var out = [];
    var doInterp = G.PHYSICS.interpolate && !this.paused;
    var alpha = doInterp ? U.clamp((this._acc || 0) / G.PHYSICS.fixedStepMs, 0, 1) : 1;
    for (var i = 0; i < src.length; i++) {
      var b = src[i];
      var g = b.game, x = b.position.x, y = b.position.y, a = b.angle;
      if (doInterp) {
        x = g.prevX + (x - g.prevX) * alpha;
        y = g.prevY + (y - g.prevY) * alpha;
        a = g.prevA + (a - g.prevA) * alpha;
      }
      out.push({ x: x, y: y, angle: a, tier: g.tier, radius: b.circleRadius, born: g.born });
    }
    return out;
  };

  Game.prototype._updateBalls = function (seconds) {
    var src = this.phys.balls();
    for (var i = 0; i < src.length; i++) {
      var b = src[i];
      if (b.game.born > 0) b.game.born = Math.max(0, b.game.born - seconds / 0.16);
      // 失败判定：静止 + 越过警戒线
      var r = b.circleRadius;
      var overLine = (b.position.y - r) < (G.CEIL_Y - G.RULES.overLineDepth);
      var still = b.speed < G.RULES.overLineSpeed;
      if (!this.dead && overLine && still) {
        b.game.over += seconds * 1000;
        if (b.game.over >= G.RULES.overLineMs) this.gameOver();
      } else {
        b.game.over = 0;
      }
    }
  };

  Game.prototype._updateTimers = function (seconds) {
    /* 点"开始游戏"后延迟起 BGM（用户要求 0.5 秒）。
     * 放这里是因为 tick() 和 simulate() 都会调到，用的是游戏时钟，
     * 不依赖平台的 setTimeout —— 微信端、无头测试都能覆盖。 */
    if (this.bgmAt > 0) {
      this.bgmAt -= seconds;
      if (this.bgmAt <= 0) {
        this.bgmAt = 0;
        if (this.screen === 'play') G.Sound.bgm(true);
      }
    }
    if (this._dropCd > 0) this._dropCd -= seconds * 1000;
    if (this.comboT > 0) {
      this.comboT -= seconds * 1000;
      if (this.comboT <= 0) this.combo = 0;
    }
  };

  /* ---------------- 投放 ---------------- */
  Game.prototype._rollTier = function () { return U.pick(G.SPAWN_POOL); };

  Game.prototype.canDrop = function () {
    // screen 必须是 'play'：在开始界面（标题画面）上不能投球
    return this.screen === 'play'
      && !this.dead && !this.paused && this.hold && this._dropCd <= 0;
  };

  Game.prototype.drop = function () {
    if (!this.canDrop()) return null;
    var F = G.FIELD;
    var r = G.THEME.tiers[this.hold.tier].radius;
    var x = U.clamp(this.holdX, F.x + r, F.right - r);
    this.holdX = x;                    // 与渲染的持球位置保持一致（避免预览与落点错位）
    var body = this.phys.addBall(this.hold.tier, x, G.DROP_Y);
    this.phys.syncSnapshot(body);          // 新球不要参与插值，否则会从旧位置滑过来
    body.game.born = 1;
    this._dropCd = G.RULES.dropCooldownMs;
    G.Sound.playDropFor(this.hold.tier);   // 投放的角色播他自己的音效（艾露玛回退通用投放音）
    if (G.Achv) this._achv(G.Achv.noteDrop());
    this.hold = { tier: this.next };
    this.next = this._rollTier();
    this.onMove(this.holdX);          // 新球半径不同，重新夹紧一次
    return body;
  };

  /* 自测/调试用：指定阶数投放在指定 x */
  Game.prototype.dropAt = function (tier, x) {
    var r = G.THEME.tiers[tier].radius;
    var body = this.phys.addBall(tier, U.clamp(x, G.FIELD.x + r, G.FIELD.right - r), G.DROP_Y);
    this.phys.syncSnapshot(body);
    body.game.born = 1;
    this._dropCd = 0;
    return body;
  };

  /* ---------------- 合成 ----------------
   * ★ 竞态防护：一帧内 pairs 里可能同时出现 (A,B) 和 (B,C) 三颗同级球，
   *   若每个 pair 各判一次，中间的球会被"消耗两次"、凭空多出一个新球。
   *   这里用 game.dead 作为同步互斥标记（标记后就直接跳出），
   *   真正删除 body 统一推迟到 _flushRemovals()。
   *   另外 Matter 0.20 的 collisionStart 是在**位置求解之前**触发的，
   *   所以此处的 position 还带着穿透量——出生点用中点、不依赖接触深度。
   * ---------------------------------------------------------------- */
  Game.prototype._tryMerge = function (a, b) {
    if (this.dead || this.paused) return;
    if (!a.game || !b.game) return;
    if (a.game.dead || b.game.dead) return;      // 已被本帧其它 pair 预定
    if (a.game.tier !== b.game.tier) return;
    var tier = a.game.tier;
    if (tier >= G.THEME.tiers.length - 1) return;   // 满级不再合成

    a.game.dead = b.game.dead = true;               // 同步预定，防止重复合成
    this.toRemove.push(a, b);

    var mx = (a.position.x + b.position.x) / 2;
    var my = (a.position.y + b.position.y) / 2;

    // 连击
    if (this.comboT > 0) this.combo++; else this.combo = 1;
    this.comboT = G.RULES.comboWindowMs;

    var base = G.RULES.mergeScore << tier;
    var gain = Math.round(base * (1 + (this.combo - 1) * G.RULES.comboBonus));
    this.score += gain;
    if (this.score > this.best) this.best = this.score;

    var nb = this.phys.addBall(tier + 1, mx, my);
    // 合成出的球直接落在两颗旧球的中点，别让它参与插值（否则会从别处滑来）
    this.phys.syncSnapshot(nb);
    nb.game.born = 1;
    // 合并瞬间给一点向上初速，手感更"弹"
    G.Physics.Matter.Body.setVelocity(nb, { x: 0, y: -0.6 });

    this.render.burst(mx, my, tier + 1);
    this.render.floatText(mx, my - 26, '+' + gain);
    this.render.say(tier + 1);
    this.render.flash = Math.min(0.5, this.render.flash + 0.18);
    G.Sound.playMerge(tier + 1);
    if (G.Achv) this._achv(G.Achv.noteMerge(tier + 1, this.combo));   // 统计 + 查成就
    this.ad.vibrate(12);
    return nb;
  };

  Game.prototype._flushRemovals = function () {
    if (!this.toRemove.length) return;
    for (var i = 0; i < this.toRemove.length; i++) this.phys.removeBall(this.toRemove[i]);
    this.toRemove.length = 0;
  };

  Game.prototype.gameOver = function () {
    if (this.dead) return this;
    this.dead = true;
    this.render.flash = 0.9;
    G.Sound.play('over');
    G.Sound.bgm(false);
    this.ad.vibrate([0, 40, 60, 40]);
    return this;
  };

  /* ---------------- 输入 ---------------- */
  Game.prototype.onDown = function (x, y) {
    G.Sound.unlock();
    // 1) 可点区域（渲染层每帧算好，带宽容度）：开始游戏 / 返回 / 命名版本
    var hits = this.render.hits || [];
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (x >= h.hitX && x <= h.hitX + h.hitW &&
          y >= h.hitY && y <= h.hitY + h.hitH) {
        if (h.action === 'start') { this.startGame(); return 'start'; }
        if (h.action === 'back') { this.backToTitle(); return 'back'; }
        if (h.action === 'achv') { this.openAchievements(); return 'achv'; }
        if (h.action === 'achvClose') { this.closeAchievements(); return 'achvClose'; }
        this.setNameVersion(h.key);
        return 'version';
      }
    }
    // 成就面板里：按住拖动 = 滚动列表
    if (this.screen === 'achv') {
      if (this.render.achvDragStart) this.render.achvDragStart(y);
      return 'achvDrag';
    }
    // 2) 开始界面上点别处不做事（免得误判成投球）
    if (this.screen !== 'play') return 'title';
    // 3) 顶部其它按钮
    if (y < 90) {
      if (x > G.DESIGN.w - 90) { this.muted = G.Sound.toggleMute(); return 'mute'; }
      if (x < 90) { this.restart(); return 'restart'; }
    }
    if (this.dead) { this.restart(); return 'restart'; }
    this.onMove(x);
    return 'drag';
  };

  /* 切换角色命名版本，并写进存档 */
  Game.prototype.setNameVersion = function (key) {
    if (!G.setNameVersion(key)) return false;
    if (this.ad.setNameVersion) this.ad.setNameVersion(key);
    G.Sound.setBgmForVersion(key);          // 地狱版 / 正常版各有自己的 BGM
    // 切换后重新喊一次当前持球的名字，让玩家立刻看到变化
    if (this.hold) this.render.say(this.hold.tier);
    return true;
  };

  Game.prototype.onMove = function (x, y) {
    // 成就面板里拖动 = 滚动列表（垂直），不参与瞄准
    if (this.screen === 'achv') {
      if (this.render.achvDragMove) this.render.achvDragMove(y);
      return;
    }
    if (this.dead || this.screen !== 'play') return;
    var F = G.FIELD;
    var r = G.THEME.tiers[this.hold ? this.hold.tier : 0].radius;
    // 提前夹紧到场地内，网络/触摸都会给出越界坐标
    this.holdX = U.clamp(x, F.x + r, F.right - r);
    return this.holdX;
  };

  Game.prototype.onUp = function () {
    if (this.screen === 'achv') {          // 面板里松手 = 结束拖动
      if (this.render.achvDragEnd) this.render.achvDragEnd();
      return;
    }
    if (this.dead || this.screen !== 'play') return;
    this.drop();
  };

  Game.prototype.restart = function () {
    this.reset();
    G.Sound.bgm(true);
    return this;
  };

  /* ---------------- 开始界面 <-> 游戏 ----------------
   * 用户要求：点"开始游戏"后**等 0.5 秒**再自动放 BGM。
   * 这个倒计时在 _updateTimers 里走游戏时钟（暂停/切后台都不会乱）。 */
  Game.prototype.startGame = function () {
    this.screen = 'play';
    this.reset();                     // 每次从开始界面进来都是全新一局
    G.Sound.unlock();                 // 这次点击就是"用户交互"，正好用来解锁音频
    this.bgmAt = (G.TITLE && G.TITLE.bgmDelay) || 0.5;
    if (G.Achv) this._achv(G.Achv.beginGame());     // 统计"开局数"并查成就
    return this;
  };

  /* 游戏内点"返回"：回开始界面，停掉 BGM，并清空场地
   * （不清空的话，回到开始界面还留着上一局的球，再开始会接着上一局） */
  Game.prototype.backToTitle = function () {
    this.screen = 'title';
    this.bgmAt = 0;                   // 取消还没到点的 BGM 延迟
    G.Sound.bgm(false);
    this.reset();
    return this;
  };

  /* ---------------- 成就 ----------------
   * 事件里产生的"新解锁"统一走这里：弹提示 + 响一声（音效先借用 ui，等素材到位再换）。 */
  Game.prototype._achv = function (list) {
    if (!list || !list.length) return 0;
    for (var i = 0; i < list.length; i++) {
      if (this.render.showAchievement) this.render.showAchievement(list[i]);
    }
    G.Sound.play('ui');
    return list.length;
  };

  /* 打开成就面板：记住从哪个界面来的，关闭时回去。面板里不投球、不开始游戏。 */
  Game.prototype.openAchievements = function () {
    if (this.screen === 'achv') return this;
    this._achvFrom = this.screen;
    this.screen = 'achv';
    if (this.render.achvScrollReset) this.render.achvScrollReset();
    G.Sound.play('ui');
    return this;
  };

  Game.prototype.closeAchievements = function () {
    if (this.screen !== 'achv') return this;
    this.screen = (this._achvFrom === 'play') ? 'play' : 'title';
    G.Sound.play('ui');
    return this;
  };

  /* ---------------- 自测 ----------------
   * 供 ?selftest=1 和自动化回归使用。全部是同步的，不依赖计时器。
   * ------------------------------------ */
  Game.prototype.selfTest = function () {
    var checks = [];
    var self = this;
    // 自测会驱动游戏（会累计统计、写存档），先快照成就状态，结束时还原 ——
    // 免得开发跑一次自测就把玩家的成就解了
    var achvSnap = G.Achv ? G.Achv.serialize(G.Achv.stats, G.Achv.unlocked) : '';
    function ok(name, pass, detail) {
      checks.push({ name: name, pass: !!pass, detail: detail == null ? '' : detail });
    }

    if (!this._running) this.tick(performance.now());
    ok('引擎已初始化', !!this.phys.engine && !!this.phys.Matter);
    ok('墙体已创建', this.phys.Matter.Composite.allBodies(this.phys.world).length >= 3);

    // 0) 开始界面 → 开始游戏（含 0.5 秒 BGM 延迟）→ 返回
    ok('载入后停在开始界面、且不能投球',
      this.screen === 'title' && this.canDrop() === false, 'screen=' + this.screen);
    var titleErr = null;
    try { this.tick(performance.now()); } catch (e) { titleErr = e && e.message; }
    ok('开始界面能正常渲染一帧', !titleErr,
      titleErr || ('命中区 ' + (this.render.hits || []).length + ' 个'));
    var sr = this.render.titleStartRect();
    ok('"开始游戏"按钮比胶囊按钮大得多',
      sr.w >= 300 && sr.w > 76 * 3, sr.w + 'x' + sr.h + ' @y' + sr.y);
    ok('游戏标题已改为"合成爱丽丝"', G.THEME.title === '合成爱丽丝', G.THEME.title);
    var act = this.onDown(sr.x + sr.w / 2, sr.y + sr.h / 2);   // 走真实命中判定
    ok('点"开始游戏"进入游戏', act === 'start' && this.screen === 'play' && this.canDrop() === true,
      'action=' + act + ' screen=' + this.screen);
    ok('BGM 延迟按要求是 0.5 秒', Math.abs(this.bgmAt - 0.5) < 1e-9, 'bgmAt=' + this.bgmAt);
    this.simulate(15);
    ok('0.25 秒时 BGM 还没起', this.bgmAt > 0, 'bgmAt=' + this.bgmAt.toFixed(3));
    this.simulate(20);
    ok('超过 0.5 秒后 BGM 到点', this.bgmAt === 0, 'bgmAt=' + this.bgmAt);
    // 游戏内"返回"：先渲染一帧，让 HUD 把返回按钮写进命中区
    this.dropAt(0, G.DESIGN.w / 2);
    this.tick(performance.now());
    ok('游戏内"返回"按钮已进入命中区',
      (this.render.hits || []).some(function (h) { return h.action === 'back'; }),
      '命中区 ' + (this.render.hits || []).length + ' 个');
    ok('"返回"按钮已调大（≥90px 宽）', this.render.backRect().w >= 90,
      this.render.backRect().w + 'x' + this.render.backRect().h);
    var br = this.render.backRect();
    var act2 = this.onDown(br.x + br.w / 2, br.y + br.h / 2);
    ok('点"返回"回到开始界面并清空场地',
      act2 === 'back' && this.screen === 'title' && this.phys.balls().length === 0,
      'action=' + act2 + ' screen=' + this.screen + ' balls=' + this.phys.balls().length);
    this.startGame();          // 后面的测试都在"游戏进行中"跑

    // 1) 合成：两颗最小阶撞在一起
    this.reset();
    var r0 = G.THEME.tiers[0].radius;
    var x = G.DESIGN.w / 2;
    this.dropAt(0, x - r0 * 0.6);
    this.dropAt(0, x + r0 * 0.6);
    var scoreBefore = this.score;
    this.simulate(90);
    ok('同阶碰撞会合成', this.score > scoreBefore, 'score ' + scoreBefore + ' -> ' + this.score);
    ok('合成后球数正确（两颗1阶→一颗2阶）', this.phys.balls().length === 1,
      'n=' + this.phys.balls().length);
    ok('合成出的阶数正确', this.phys.balls()[0] && this.phys.balls()[0].game.tier === 1,
      'tier=' + (this.phys.balls()[0] && this.phys.balls()[0].game.tier));

    // 2) 不同阶不合成
    this.reset();
    this.dropAt(0, x - 30);
    this.dropAt(1, x + 30);
    this.simulate(90);
    ok('不同阶不合成', this.phys.balls().length === 2, 'n=' + this.phys.balls().length);

    // 3) 满级不再合成
    this.reset();
    var last = G.THEME.tiers.length - 1;
    this.dropAt(last, x - 100);
    this.dropAt(last, x + 100);
    this.simulate(60);
    ok('满级不再合成', this.phys.balls().length === 2, 'n=' + this.phys.balls().length);

    // 4) 球不会掉出场地
    this.reset();
    for (var i = 0; i < 12; i++) this.dropAt(i % 3, G.FIELD.x + 40 + i * 45);
    this.simulate(240);
    var escaped = 0, lowest = 0, worst = '';
    var all = this.phys.balls();
    for (i = 0; i < all.length; i++) {
      var b = all[i];
      var bad = b.position.x < G.FIELD.x - 5 || b.position.x > G.FIELD.right + 5 ||
        b.position.y + b.circleRadius > G.FIELD.floorY + 6;
      if (bad) {
        escaped++;
        if (!worst) {
          worst = ' id=' + b.id + ' tier=' + b.game.tier + ' r=' + b.circleRadius +
            ' x=' + b.position.x.toFixed(0) + ' y=' + b.position.y.toFixed(0) +
            ' vx=' + b.velocity.x.toFixed(2) + ' vy=' + b.velocity.y.toFixed(2);
        }
      }
      if (b.position.y > lowest) lowest = b.position.y;
    }
    ok('球不会穿墙/穿地板', escaped === 0, 'escaped=' + escaped + ' lowestY=' + lowest.toFixed(0)
      + ' floorY=' + G.FIELD.floorY + worst);

    // 5) 物理稳定性：穿透量
    var pen = this.phys.penetration();
    ok('穿透量在安全范围（<6px）', pen.max < 6,
      'max=' + pen.max.toFixed(1) + ' avg=' + pen.avg.toFixed(1) + ' pairs=' + pen.pairs);

    // 6) 球堆能稳定下来（速度趋零）
    this.simulate(360);
    var maxSpeed = 0;
    all = this.phys.balls();
    for (i = 0; i < all.length; i++) maxSpeed = Math.max(maxSpeed, all[i].speed);
    ok('球堆最终静止', maxSpeed < 0.5, 'maxSpeed=' + maxSpeed.toFixed(3));

    // 7) 存档：写入后必须能从适配层读回来
    this.reset();
    var probe = this.best + 12345;
    this.best = probe;
    ok('最高分写入后可从存储读回', this.ad.getBest() === probe,
      'wrote=' + probe + ' read=' + this.ad.getBest());

    // 7b) 命名版本：两套名字不同、可切换、能落盘、默认是正常版
    var n0 = G.tierName(0), n7 = G.tierName(7);
    ok('默认是正常版', G.nameVersion === G.NAME_VERSION_DEFAULT,
      'version=' + G.nameVersion + ' tier1=' + n0);
    ok('正常版第 1 阶是"艾露玛"', n0 === '艾露玛', 'tier1=' + n0);
    ok('两套第 1 阶名字不同', G.NAME_SETS.normal.names[0] !== G.NAME_SETS.hell.names[0],
      G.NAME_SETS.normal.names[0] + ' / ' + G.NAME_SETS.hell.names[0]);
    this.setNameVersion('hell');
    ok('切到地狱版后名字跟着变', G.tierName(0) === '吊死鬼',
      'tier1=' + G.tierName(0));
    ok('切换后可从存储读回', this.ad.getNameVersion() === 'hell',
      'stored=' + this.ad.getNameVersion());
    ok('第 8 阶两套同名（都是爱丽丝）',
      G.NAME_SETS.normal.names[7] === G.NAME_SETS.hell.names[7] && n7 === '爱丽丝',
      'tier8=' + n7);
    this.setNameVersion('normal');
    ok('能切回正常版', G.nameVersion === 'normal' && G.tierName(0) === '艾露玛',
      'version=' + G.nameVersion);
    ok('错误版本名会被拒绝', this.setNameVersion('不存在的版本') === false
      && G.nameVersion === 'normal', 'version=' + G.nameVersion);

    // 7c) 贴图版本：跟着命名版本走，两套可以指向不同目录
    ok('正常版用默认贴图目录',
      G.textureVariantName() === 'default'
      && G.texturePathFor(0) === 'assets/tiers/tier1.png',
      G.textureVariantName() + ' -> ' + G.texturePathFor(0));
    this.setNameVersion('hell');
    ok('地狱版切到自己的贴图目录（缺失时会自动回退）',
      G.textureVariantName() === 'hell'
      && G.texturePathFor(0) === 'assets/tiers-hell/tier1.png',
      G.textureVariantName() + ' -> ' + G.texturePathFor(0));
    ok('两套贴图路径确实不同',
      G.texturePathFor(0) !== G.ASSETS.tiers[0],
      G.texturePathFor(0) + ' vs ' + G.ASSETS.tiers[0]);
    // ★ 2026-10-11 加：以前只断言"路径不同"，没验证回退真的发生，
    //   结果地狱版 8 张图全 404、退回占位球这个 bug 一路通过了 29/29。
    var hc = G.texturePathCandidates(0);
    ok('地狱版缺图时能回退到默认贴图目录（候选链）',
      hc[0] === 'assets/tiers-hell/tier1.png'
      && hc[hc.length - 1] === 'assets/tiers/tier1.png',
      hc.join(' -> '));
    this.setNameVersion('normal');
    ok('贴图路径跟着切回默认', G.texturePathFor(3) === G.ASSETS.tiers[3],
      G.texturePathFor(3));
    var nc = G.texturePathCandidates(0);
    ok('正常版候选链不会重复自己',
      nc.length === 1 && nc[0] === G.ASSETS.tiers[0], nc.join(' -> '));

    // 7c-3) ★ 2026-10-11 加：云端切版本会先闪占位球的修复，两条防线
    var hcFor = G.texturePathCandidatesFor ? G.texturePathCandidatesFor('hell', 0) : [];
    ok('预加载用的"指定版本"候选链能构造出来',
      hcFor.length === 2 && hcFor[0] === 'assets/tiers-hell/tier1.png'
      && hcFor[1] === 'assets/tiers/tier1.png', hcFor.join(' -> '));
    ok('preloadVariant 会把另一个版本的 8 个槽位都占住',
      (function () {
        if (!G.Render.preloadVariant) return false;
        G.Render.preloadVariant('hell');
        var slot = G.Render.textureCache && G.Render.textureCache.hell;
        return !!slot && Object.keys(slot).length === G.THEME.tiers.length;
      })(),
      '槽位数 = ' + (G.Render.textureCache && G.Render.textureCache.hell
        ? Object.keys(G.Render.textureCache.hell).length : '无'));

    // 7c-4) ★ 2026-10-11 加：用户要求"等 BGM 也加载好才进开始界面"的接口
    ok('音频层提供 whenReady / readyState（加载闸门等 BGM 用）',
      typeof G.Sound.whenReady === 'function' && typeof G.Sound.readyState === 'function',
      'whenReady=' + typeof G.Sound.whenReady + ' readyState=' + typeof G.Sound.readyState);
    var readyCb = 'not-called';
    G.Sound.whenReady('不存在的音效', function (r) { readyCb = r; });
    ok('whenReady 查不存在的音效会立刻回 false（绝不会卡住加载）',
      readyCb === false, '回调 = ' + readyCb);

    // 7h) 成就系统（2026-10-11 新增）：判定是**纯函数**，这里不碰真实存档
    var AL = G.ACHIEVEMENTS || [];
    ok('成就表至少 12 条、id 唯一',
      AL.length >= 12 && (function () {
        var seen = {};
        for (var i = 0; i < AL.length; i++) {
          if (!AL[i].id || seen[AL[i].id]) return false;
          seen[AL[i].id] = 1;
        }
        return true;
      })(), '共 ' + AL.length + ' 条');
    ok('每条成就都有 name / desc / test',
      (function () {
        for (var i = 0; i < AL.length; i++) {
          if (!AL[i].name || !AL[i].desc || typeof AL[i].test !== 'function') return false;
        }
        return true;
      })(), '');
    var bs = G.Achv.blankStats();
    ok('空白统计下没有任何成就解锁',
      G.Achv.newlyUnlocked(bs, {}).length === 0, G.Achv.newlyUnlocked(bs, {}).join(','));
    var s1 = G.Achv.blankStats(); s1.merges = 1;
    var got1 = G.Achv.newlyUnlocked(s1, {});
    ok('合成一次即解锁"初次合成"', got1.indexOf('first_merge') >= 0, got1.join(','));
    ok('已解锁的不会重复解锁',
      G.Achv.newlyUnlocked(s1, { first_merge: 1 }).indexOf('first_merge') < 0, '');
    var topIdx = G.THEME.tiers.length - 1;
    var s2 = G.Achv.blankStats(); s2.tierMerges[topIdx] = 1;
    ok('合出最高阶角色会解锁对应角色成就',
      G.Achv.newlyUnlocked(s2, {}).indexOf('tier_' + topIdx) >= 0,
      G.Achv.newlyUnlocked(s2, {}).join(','));
    var back = G.Achv.parse(G.Achv.serialize({ merges: 7 }, { first_merge: 123 }));
    ok('成就存档能原样读回',
      back.stats.merges === 7 && back.unlocked.first_merge === 123, JSON.stringify(back));
    ok('存档损坏/为空时回退成空白且不抛错',
      G.Achv.parse('{{{这不是 JSON').stats.merges === 0
      && G.Achv.parse('').stats.merges === 0, '');
    ok('成就面板能开能关、开着时不能投球',
      (function () {
        var before = this.screen;
        this.openAchievements();
        var opened = (this.screen === 'achv') && (this.canDrop() === false);
        this.closeAchievements();
        return opened && (this.screen === before);
      }).call(this), '');

    // 7d) BGM：两个命名版本各一首，版本名写错要能回退
    ok('两个版本各有自己的 BGM 文件',
      G.bgmPathFor('normal') === 'assets/audio/bgm_normal.mp3'
      && G.bgmPathFor('hell') === 'assets/audio/bgm_hell.mp3',
      G.bgmPathFor('normal') + ' / ' + G.bgmPathFor('hell'));
    ok('BGM 版本名写错时回退到正常版',
      G.bgmPathFor('不存在的版本') === G.bgmPathFor('normal'),
      '回退到 ' + G.bgmPathFor('不存在的版本'));

    // 7e) 音效槽位：合成的下标语义**差一位**，最容易装错，这里钉死
    //     （两颗 T 阶合成 → 新球 T+1 阶，但播 assets.merge[T]，即"合成出第 N 阶 → 下标 N-2"）
    var topSlot = G.THEME.tiers.length - 2;                  // 爱丽丝 = 第 8 阶 → 下标 6
    ok('合成出爱丽丝用的是 merge7 槽位（不是 merge8）',
      topSlot === 6 && /merge7\.mp3$/.test(G.ASSETS.audio.merge[topSlot]),
      'merge[' + topSlot + '] = ' + G.ASSETS.audio.merge[topSlot]);
    ok('失败音效指向 gameover.mp3',
      /gameover\.mp3$/.test(G.ASSETS.audio.over), G.ASSETS.audio.over);

    // 7f) 投放音 = 各角色自己的音效（艾露玛没有专属音效，回退通用投放音）
    ok('投放古兹会播古兹自己的音效',
      G.characterSoundName(1) === 'merge0' && /merge1\.mp3$/.test(G.ASSETS.audio.merge[0]),
      G.characterSoundName(1) + ' → ' + G.ASSETS.audio.merge[0]);
    ok('艾露玛没有专属音效（回退通用投放音）',
      G.characterSoundName(0) === '', '名称 = "' + G.characterSoundName(0) + '"');

    // 8) 失败判定：直接喂"越线计时"，不依赖物理摆位
    this.reset();
    this.dead = false;
    var bigTier = G.THEME.tiers.length - 1;
    var big = this.dropAt(bigTier, G.DESIGN.w / 2);
    // 它必然一直越线，但要把"持续越线计时"喂够才会判负
    var needMs = G.RULES.overLineMs + 50;
    var stepMs = G.PHYSICS.fixedStepMs;
    for (var s = 0; s < Math.ceil(needMs / stepMs) + 5 && !this.dead; s++) {
      G.Physics.Matter.Body.setVelocity(big, { x: 0, y: 0 });
      G.Physics.Matter.Body.setPosition(big, { x: G.DESIGN.w / 2, y: G.CEIL_Y + big.circleRadius - 2 });
      this._updateBalls(stepMs / 1000);
    }
    ok('越线静止持续超时会判负', this.dead, 'dead=' + this.dead);

    // 8) 重启清场
    this.restart();
    ok('重启清空场地', this.phys.balls().length === 0 && this.score === 0 && !this.dead);

    // 9) 渲染没有抛错
    var renderOk = true, err = '';
    try { this.tick(performance.now() + 16); } catch (e) { renderOk = false; err = e.message; }
    ok('渲染一帧无异常', renderOk, err);

    // 9b) 渲染插值：结果必须落在 [上一帧, 当前] 区间内；关掉后等于物理位置
    this.reset();
    var fall = this.dropAt(2, G.DESIGN.w / 2);
    this._acc = G.PHYSICS.fixedStepMs * 0.5;
    this.phys.step();
    var vis = this._visualBalls();
    var raw = fall.position, pv = fall.game;
    var inRange = vis[0].x >= Math.min(pv.prevX, raw.x) - 0.001 &&
      vis[0].x <= Math.max(pv.prevX, raw.x) + 0.001 &&
      vis[0].y >= Math.min(pv.prevY, raw.y) - 0.001 &&
      vis[0].y <= Math.max(pv.prevY, raw.y) + 0.001;
    ok('插值结果落在两帧之间', inRange,
      'prev=(' + pv.prevX.toFixed(1) + ',' + pv.prevY.toFixed(1) + ') cur=(' +
      raw.x.toFixed(1) + ',' + raw.y.toFixed(1) + ') vis=(' +
      vis[0].x.toFixed(1) + ',' + vis[0].y.toFixed(1) + ')');
    var savedInterp = G.PHYSICS.interpolate;
    G.PHYSICS.interpolate = false;
    var vis2 = this._visualBalls();
    G.PHYSICS.interpolate = savedInterp;
    ok('关闭插值后等于物理位置',
      Math.abs(vis2[0].x - raw.x) < 0.001 && Math.abs(vis2[0].y - raw.y) < 0.001,
      'vis=(' + vis2[0].x.toFixed(1) + ',' + vis2[0].y.toFixed(1) + ') raw=(' +
      raw.x.toFixed(1) + ',' + raw.y.toFixed(1) + ')');

    // 10) 投放上限：满场地时不应无限增长
    this.reset();
    for (i = 0; i < 30; i++) { this.dropAt(i % 3, G.FIELD.x + 30 + (i * 37) % (G.FIELD.w - 60)); }
    this.simulate(600);
    var n = this.phys.balls().length;
    ok('大量投放后仍稳定', n > 0 && n < 60, 'n=' + n);

    // 还原成就存档（自测不该污染玩家的成就进度）
    if (achvSnap) {
      var rs = G.Achv.parse(achvSnap);
      G.Achv.stats = rs.stats;
      G.Achv.unlocked = rs.unlocked;
      G.Achv.save();
    }
    this.reset();
    var passed = 0;
    for (i = 0; i < checks.length; i++) if (checks[i].pass) passed++;
    return {
      total: checks.length, passed: passed,
      failed: checks.length - passed, checks: checks
    };
  };

  /* 自测用：推进 n 个固定步长 */
  Game.prototype.simulate = function (steps) {
    for (var i = 0; i < steps; i++) {
      this.phys.step();
      this._flushRemovals();
      this._updateBalls(G.PHYSICS.fixedStepMs / 1000);
      this._updateTimers(G.PHYSICS.fixedStepMs / 1000);
    }
    return this;
  };

  /* best 通过适配层读写（网页 localStorage / 微信 storage）。
   * 每次都读存储，不做内存缓存 —— 缓存曾导致自测里读到上一次运行残留的分数。 */
  Object.defineProperty(Game.prototype, 'best', {
    get: function () { return this.ad.getBest(); },
    set: function (v) { this.ad.setBest(v); }
  });
})(typeof window !== 'undefined' ? window : this);
