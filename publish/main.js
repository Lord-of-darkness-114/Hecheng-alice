/* =============================================================================
 * 网页版入口
 * -----------------------------------------------------------------------------
 * 负责：加载素材 -> 建适配层 -> 建游戏 -> 绑输入 -> 启动。
 * 玩法逻辑一行都不在这里（都在 shared/）。
 *
 * URL 参数（也是自动化测试的入口）：
 *   ?selftest=1   跑内置回归测试，结果同时打到控制台和 DOM
 *   ?headless=1   不初始化音频（无人值守跑测试用）
 *   ?mute=1       静音
 *   ?auto=1       自动投放，用于压测
 *   ?debug=1      每秒输出一次物理诊断状态
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;
  var doc = root.document;
  var frameCount = 0;      // 帧驱动是否真的在跑（诊断用）
  var frameTimes = [];     // 最近几帧的时间戳，用来判断循环是"跑得慢"还是"停了"

  function qs(name) {
    var m = new RegExp('[?&]' + name + '(=([^&]*))?').exec(root.location.search);
    return m ? (m[2] === undefined ? true : decodeURIComponent(m[2])) : false;
  }

  /* ---------------- 素材加载 ---------------- */
  function loadImage(url) {
    return new Promise(function (resolve) {
      var img = new root.Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };   // 缺图不阻塞，走占位画法
      img.src = url;
    });
  }

  /* 依次尝试多个后缀，这样你换图时不用管格式。
   * 顺序有讲究：**先试最多的那几种**，否则每张图都要白跑几次 404，
   * 服务器日志会被刷满（而且手机上多花几个往返）。
   * 当前工程：球体贴图是 .webp，背景是 .jpg，场地框是 .png。 */
  var FALLBACK_EXT = ['.webp', '.jpg', '.png', '.jpeg'];

  function loadImageAny(url) {
    var dot = url.lastIndexOf('.');
    var base = dot > 0 ? url.slice(0, dot) : url;
    var tries = [];
    for (var i = 0; i < FALLBACK_EXT.length; i++) {
      var alt = base + FALLBACK_EXT[i];
      if (tries.indexOf(alt) < 0) tries.push(alt);
    }
    // 原路径补在最后兜底（万一用了 .webp/.jpg/.png/.jpeg 之外的后缀）
    if (tries.indexOf(url) < 0) tries.push(url);
    var k = 0;
    function next() {
      if (k >= tries.length) return Promise.resolve(null);
      var u = tries[k++];
      return loadImage(u).then(function (img) { return img || next(); });
    }
    return next();
  }

  /* 按顺序试多个路径，返回第一张加载成功的图；全都失败返回 null。
   * 用来实现"当前贴图版本 → 默认贴图版本"的回退（见 G.texturePathCandidates）。 */
  function loadFirst(urls) {
    var k = 0;
    function next() {
      if (k >= urls.length) return Promise.resolve(null);
      return loadImageAny(urls[k++]).then(function (img) { return img || next(); });
    }
    return next();
  }

  /* 开始界面按钮用的**草书**网页字体（柳建毛草，OFL 协议，只裁了 11 个字 7.5KB）。
   * @font-face 定义在 index.html，所以**不依赖用户手机装没装字体**。
   * 在开始渲染之前先把它加载好，否则第一帧会用回退字体画一遍（会看到字体"跳变"）。
   * ★ 微信端将来要用 wx.loadFont('assets/fonts/bs-label.ttf') 加载同一个文件。 */
  function loadFonts() {
    var fonts = doc.fonts;
    if (!fonts || !fonts.load) return Promise.resolve();
    try {
      return fonts.load('700 46px BSLabel').then(function () {}, function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function loadAll(report) {
    var jobs = [];
    var tierCount = G.THEME.tiers.length;
    var total = tierCount + 3;   // 球 + bg + panel + frame
    var done = 0;
    function tick(label) {
      done++;
      if (report) report(done / total, label);
    }

    // 球体贴图：先按当前命名版本的目录找，找不到就依次回退（默认那套），
    // 全都失败才让 render 走代码画的占位球。候选链见 G.texturePathCandidates。
    G.THEME.tiers.forEach(function (t, i) {
      var cands = G.texturePathCandidates ? G.texturePathCandidates(i)
                                          : [G.texturePathFor(i)];
      jobs.push(loadFirst(cands).then(function (img) {
        if (img) G.Render.setTexture(i, img);
        tick('tier' + (i + 1));
      }));
    });
    // 背景 / 弹窗底板 / 场地边框
    jobs.push(loadImageAny(G.ASSETS.bg).then(function (img) {
      if (img) G.Render.images.bg = img;
      tick('bg');
    }));
    jobs.push(loadImageAny(G.ASSETS.panel).then(function (img) {
      if (img) G.Render.images.panel = img;
      tick('panel');
    }));
    jobs.push(loadImageAny(G.ASSETS.frame).then(function (img) {
      if (img) G.Render.images.frame = img;
      tick('frame');
    }));

    return Promise.all(jobs);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var canvas = doc.getElementById('game');
    var ad = G.WebAdapter.create({ canvas: canvas });
    var Matter = root.Matter;
    if (!Matter) { alert('物理引擎 Matter.js 未加载（vendor/matter.min.js）'); return; }

    var game = new G.Game(Matter, ad);
    root.__game = game;              // 调试/测试用
    root.__adapter = ad;

    /* 音频 */
    var headless = qs('headless');
    if (!headless) {
      G.Sound.attach(G.AudioWeb());
      G.Sound.registerAll(G.ASSETS.audio);
    } else {
      G.Sound.attach(G.Sound.noop());
    }
    if (qs('mute')) G.Sound.muted = true;

    /* 输入：指针事件统一处理鼠标与触摸 */
    var dragging = false;
    function pos(e) {
      var cx = e.clientX, cy = e.clientY;
      if (cx === undefined && e.touches && e.touches[0]) {
        cx = e.touches[0].clientX; cy = e.touches[0].clientY;
      }
      return { x: G.Render.toLogicX(cx), y: (cy - ad.originY) / G.Render.viewScale };
    }
    function onDown(e) {
      e.preventDefault();
      var p = pos(e);
      dragging = true;
      game.onDown(p.x, p.y);
      if (canvas.setPointerCapture && e.pointerId != null) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 静默 */ }
      }
    }
    function onMove(e) {
      var p = pos(e);
      if (dragging) game.onMove(p.x);
      else game.holdX = p.x;   // 未按下也跟随，方便预览落点
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      game.onUp();
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); onMove(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchend', onUp);
    ad.bindKeys(game);
    ad.onResize(function () { G.Render.resize(); });

    /* 首次交互解锁音频 */
    var unlockOnce = function () {
      G.Sound.unlock();
      G.Sound.bgm(true);
      root.removeEventListener('pointerdown', unlockOnce);
      root.removeEventListener('touchstart', unlockOnce);
      root.removeEventListener('keydown', unlockOnce);
    };
    root.addEventListener('pointerdown', unlockOnce);
    root.addEventListener('touchstart', unlockOnce);
    root.addEventListener('keydown', unlockOnce);

    /* 素材加载完成后替换占位贴图 */
    var loading = doc.getElementById('loading');
    loadAll(function (p, label) {
      if (loading) loading.textContent = '加载中 ' + Math.round(p * 100) + '%  (' + label + ')';
    }).then(loadFonts).then(function () {
      if (loading) loading.style.display = 'none';
      root.__gameLoopHook = function () {
        frameCount++;
        frameTimes.push(Math.round(performance.now()));
        if (frameTimes.length > 6) frameTimes.shift();
      };
      /* 调试 / 自动化参数需要"直接进游戏"：否则会停在开始界面，
       * ?showtier / ?pile / ?auto 全都测不到东西。
       * （?selftest 不在此列 —— 它自己会先验证开始界面，再 start。） */
      if (qs('auto') || qs('pile') || qs('showtier')) game.startGame();
      // ?showtier=N —— 调试：清空场地只在中间摆一颗第 N 阶的球
      var st = /[?&]showtier=(\d+)/.exec(root.location.search);
      if (st) {
        var ti = Math.min(parseInt(st[1], 10) - 1, G.THEME.tiers.length - 1);
        game.phys.clear();
        game.dropAt(ti, G.DESIGN.w / 2);
        game.phys.balls()[0].game.born = 0;
        game.hold = null;
      }
      game.start();
      /* 后台把**另一个**命名版本的球体贴图也悄悄下下来（不 await、不阻塞开始界面）。
       * ★ 2026-10-11 加：以前切版本时才开始下载，云端（GitHub Pages / Cloudflare）
       *   第一次访问会先看到占位球；现在在开始界面停留的时间就把它下好了。 */
      if (G.Render.preloadVariant && G.NAME_VERSION_ORDER) {
        for (var vi = 0; vi < G.NAME_VERSION_ORDER.length; vi++) {
          var tv = G.textureVariantOf[G.NAME_VERSION_ORDER[vi]];
          if (tv) G.Render.preloadVariant(tv);
        }
      }
      // 看门狗必须在主循环开始之后再启动：加载期间一帧都没有，
      // 提前启动会让它把"还没开始渲染"误判成"rAF 不派发"
      ad.startFrameWatchdog();
      runDiagnostics(game, ad);
    });
  }

  /* ---------------- 诊断与自动化 ---------------- */
  function runDiagnostics(game, ad) {
    // 把结果同时写进 DOM，这样无头浏览器 --dump-dom 就能取到（console 不可靠）
    function emit(tag, text) {
      var el = doc.getElementById('selftest');
      if (!el) {
        el = doc.createElement('pre');
        el.id = 'selftest';
        el.style.cssText = 'position:fixed;left:-9999px;top:0;';
        doc.body.appendChild(el);
      }
      el.textContent += '[' + tag + '] ' + text + '\n';
      if (root.console) root.console.log(tag + ' ' + text);
    }

    if (qs('selftest')) {
      var res = game.selfTest();
      emit('SELFTEST', 'passed=' + res.passed + '/' + res.total + ' failed=' + res.failed);
      res.checks.forEach(function (c, i) {
        emit('CHECK', (c.pass ? 'PASS' : 'FAIL') + ' ' + (i + 1) + '. ' + c.name +
          (c.detail ? '  {' + c.detail + '}' : ''));
      });
    }

    if (qs('debug')) {
      var tick = 0;
      root.setInterval(function () {
        tick++;
        var pen = G.Physics.penetration();
        emit('STATE', 't=' + tick + ' n=' + pen.count + ' score=' + game.score +
          ' dead=' + (game.dead ? 1 : 0) +
          ' maxpen=' + pen.max.toFixed(1) + ' avgpen=' + pen.avg.toFixed(1) +
          ' penpairs=' + pen.pairs);
      }, 1000);
    }

    if (qs('auto')) {
      var autoTries = 0, autoOk = 0;
      root.__autoStats = function () { return { tries: autoTries, ok: autoOk }; };
      root.setInterval(function () {
        autoTries++;
        if (game.dead) { game.restart(); return; }
        game.holdX = G.FIELD.x + 40 + Math.random() * (G.FIELD.w - 80);
        if (game.drop()) autoOk++;
      }, 400);
    }

    // ?pile=N —— 调试用：在场地顶部正中放一颗 N 阶球，并让"持球"也定在同一位置。
    // 用来验证"球堆长到顶时，持球是否被正确压在下面"（正常游玩要很久才堆这么高）。
    if (qs('pile')) {
      var pTier = Math.min(parseInt(qs('pile'), 10) || 6, G.THEME.tiers.length - 1);
      var maxTier = G.THEME.tiers.length - 1;
      game.hold = { tier: maxTier };
      game.next = pTier;
      var cx = G.DESIGN.w / 2;
      game.holdX = cx;
      var pb = game.dropAt(pTier, cx);
      // 顶住它别掉下去（静态球最省事）。位置要压在"警戒线之下"，
      // 否则会立刻触发失败判定，测试就没意义了。
      var pr = G.THEME.tiers[pTier].radius;
      var py = G.CEIL_Y + pr + 8;
      G.Physics.Matter.Body.setStatic(pb, true);
      G.Physics.Matter.Body.setPosition(pb, { x: cx, y: py });
      pb.game.prevX = cx;
      pb.game.prevY = py;
    }

    // 持续诊断：每 500ms 把状态写进 DOM（无头环境下 console 抓不到，DOM 可靠）
    if (qs('debug')) {
      var diag = null;
      root.setInterval(function () {
        if (!diag) {
          diag = doc.createElement('pre');
          diag.id = 'diag';
          diag.style.cssText = 'position:fixed;left:-9999px;top:0;';
          doc.body.appendChild(diag);
        }
        var pen = G.Physics.penetration();
        var auto = root.__autoStats ? root.__autoStats() : { tries: 0, ok: 0 };
        var all = G.Physics.balls();
        var ys = all.map(function (b) { return Math.round(b.position.y) + '/' + Math.round(b.velocity.y); });
        diag.textContent = 'DIAG t=' + Math.round(performance.now() / 1000) +
          ' n=' + pen.count + ' score=' + game.score + ' dead=' + (game.dead ? 1 : 0) +
          ' maxpen=' + pen.max.toFixed(1) + ' penpairs=' + pen.pairs +
          ' acc=' + game._acc.toFixed(1) + ' frames=' + frameCount +
          ' timer=' + (ad.usingTimer() ? 1 : 0) +
          ' upf=' + (G.Physics.engine.timing.lastUpdatesPerFrame || 0) +
          ' lastMs=' + (G.Physics.engine.timing.lastElapsed || 0).toFixed(2) +
          ' drops=' + auto.ok + '/' + auto.tries +
          ' cd=' + Math.round(game._dropCd) + ' holdX=' + Math.round(game.holdX) +
          ' gravity=' + G.Physics.engine.gravity.y +
          ' ft=' + frameTimes.join(',') +
          ' ys=' + ys.join(' ');
      }, 500);
    }
    root.__frames = function () { return frameCount; };
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : this);
