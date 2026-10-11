/* =============================================================================
 * 网页适配层
 * -----------------------------------------------------------------------------
 * 只做四件事：给画布、给触摸/鼠标、给帧驱动、给音效/存档/震动。
 * 微信端会写一个同样接口的 adapter-wx.js —— 这就是"一套核心两个壳"的全部。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;

  function noop() {}

  function WebAdapter(opts) {
    opts = opts || {};
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this._lock = false;                    // 锁横屏？竖屏游戏用不上，留接口
    this.dpr = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.pixelWidth = 0;
    this.pixelHeight = 0;
    this.originX = 0;
    this.originY = 0;
    this._rafIds = {};
    this._timers = {};
    this._rafSeq = 1;
    this._frames = 0;
    this._byTimer = false;
    this._disposed = false;
    this._keyListeners = [];
    this._resizeCbs = [];
  }

  /* ---------------- 尺寸与像素比 ----------------
   * 逻辑分辨率 720x1280 等比缩放到窗口，四周留黑边（letterbox）。
   * 画布本身按 dpr 放大，保证高清屏不糊。
   * ---------------------------------------------- */
  WebAdapter.prototype.resize = function () {
    var D = G.DESIGN;
    var w = root.innerWidth, h = root.innerHeight;
    var viewScale = Math.min(w / D.w, h / D.h);
    var dpr = Math.min(root.devicePixelRatio || 1, 2);

    this.dpr = dpr;
    this.cssWidth = D.w * viewScale;
    this.cssHeight = D.h * viewScale;
    this.pixelWidth = Math.round(this.cssWidth * dpr);
    this.pixelHeight = Math.round(this.cssHeight * dpr);

    this.canvas.style.width = this.cssWidth + 'px';
    this.canvas.style.height = this.cssHeight + 'px';
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;

    var rect = this.canvas.getBoundingClientRect();
    this.originX = rect.left;
    this.originY = rect.top;

    for (var i = 0; i < this._resizeCbs.length; i++) this._resizeCbs[i](this);
    return this;
  };

  WebAdapter.prototype.onResize = function (fn) { this._resizeCbs.push(fn); return this; };

  WebAdapter.prototype.createCanvas = function (w, h) {
    var c = root.document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  WebAdapter.prototype.setCursor = function (cur) {
    this.canvas.style.cursor = cur || 'default';
    return this;
  };

  /* ---------------- 帧驱动 ----------------
   * 正常情况下用 requestAnimationFrame（跟随屏幕刷新率）。
   * 但某些环境长时间不派发 rAF（无头浏览器、部分低端 WebView、后台标签页），
   * 主循环会直接冻住 —— 所以加一个看门狗：连续 700ms 一帧都没有就切到
   * setTimeout 驱动。正常环境永远走 rAF，不受影响。
   * ---------------------------------------------- */
  WebAdapter.prototype.requestFrame = function (fn) {
    var id = this._rafSeq++;
    var self = this;
    this._frames++;              // 计数必须放在两种驱动之前，否则看门狗会误判
    if (this._byTimer) {
      this._timers[id] = root.setTimeout(function () {
        delete self._timers[id];
        fn(root.performance ? root.performance.now() : Date.now());
      }, 16);
      return id;
    }
    this._rafIds[id] = root.requestAnimationFrame(function (t) {
      delete self._rafIds[id];
      fn(t);
    });
    return id;
  };

  WebAdapter.prototype.cancelFrame = function (id) {
    if (this._rafIds[id]) {
      root.cancelAnimationFrame(this._rafIds[id]);
      delete this._rafIds[id];
    }
    if (this._timers[id]) {
      root.clearTimeout(this._timers[id]);
      delete this._timers[id];
    }
    return this;
  };

  /* 启动看门狗：主循环第一次请求帧之后调用。
   * 注意：加载阶段主循环还没开始，提前启动会把"还没渲染"误判成"rAF 不派发" */
  WebAdapter.prototype.startFrameWatchdog = function () {
    var self = this;
    var lastSeen = this._frames;
    this._disposed = false;
    var check = function () {
      if (self._disposed) return;
      if (self._frames === lastSeen && !self._byTimer) {
        self._byTimer = true;                     // rAF 不派发 -> 换定时器
        if (root.console) root.console.log('ADAPTER rAF 未派发，切换为 setTimeout 驱动');
      }
      lastSeen = self._frames;
      self._watchdog = root.setTimeout(check, 700);
    };
    this._watchdog = root.setTimeout(check, 700);
    return this;
  };

  WebAdapter.prototype.usingTimer = function () { return !!this._byTimer; };

  /* ---------------- 存档 ---------------- */
  WebAdapter.prototype.getBest = function () {
    var v = 0;
    try { v = parseInt(root.localStorage.getItem('bs_suika_best') || '0', 10) || 0; } catch (e) { v = 0; }
    return v;
  };

  WebAdapter.prototype.setBest = function (v) {
    try { root.localStorage.setItem('bs_suika_best', String(v)); } catch (e) { /* 隐私模式静默 */ }
    return this;
  };

  /* 通用存档：成就等结构化数据存成 JSON 字符串（微信端用 wx.setStorageSync 实现同两个方法） */
  WebAdapter.prototype.getData = function (key) {
    try { return root.localStorage.getItem(key) || ''; } catch (e) { return ''; }
  };

  WebAdapter.prototype.setData = function (key, value) {
    try { root.localStorage.setItem(key, String(value)); } catch (e) { /* 隐私模式静默 */ }
    return this;
  };

  /* 角色命名版本（正常版 / 地狱版） */
  WebAdapter.prototype.getNameVersion = function () {
    try { return root.localStorage.getItem(G.NAME_VERSION_KEY) || ''; } catch (e) { return ''; }
  };

  WebAdapter.prototype.setNameVersion = function (key) {
    try { root.localStorage.setItem(G.NAME_VERSION_KEY, String(key)); } catch (e) { /* 静默 */ }
    return this;
  };

  /* ---------------- 震动 ---------------- */
  WebAdapter.prototype.vibrate = function (pattern) {
    try {
      if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(pattern);
    } catch (e) { /* 静默 */ }
    return this;
  };

  /* ---------------- 键盘（网页专属便利，微信端没有也不会报错） ---------------- */
  WebAdapter.prototype.bindKeys = function (game) {
    var self = this;
    var onKey = function (e) {
      if (e.key === 'ArrowLeft') { game.onMove(game.holdX - 18); }
      else if (e.key === 'ArrowRight') { game.onMove(game.holdX + 18); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); game.onUp(); }
      else if (e.key === 'r' || e.key === 'R') { game.restart(); }
      else if (e.key === 'm' || e.key === 'M') { game.muted = G.Sound.toggleMute(); }
      else if (e.key === 'p' || e.key === 'P') { game.pause(!game.paused); }
    };
    root.addEventListener('keydown', onKey);
    this._keyListeners.push(onKey);
    return this;
  };

  WebAdapter.prototype.dispose = function () {
    this._disposed = true;
    if (this._watchdog) root.clearTimeout(this._watchdog);
    for (var i = 0; i < this._keyListeners.length; i++) {
      root.removeEventListener('keydown', this._keyListeners[i]);
    }
    this._keyListeners.length = 0;
    for (var id in this._rafIds) this.cancelFrame(id);
    for (var tid in this._timers) this.cancelFrame(tid);
    return this;
  };

  G.WebAdapter = {
    create: function (opts) {
      var ad = new WebAdapter(opts);
      ad.resize();
      root.addEventListener('resize', function () { ad.resize(); });
      root.addEventListener('orientationchange', function () {
        root.setTimeout(function () { ad.resize(); }, 120);
      });
      return ad;
    }
  };
})(typeof window !== 'undefined' ? window : this);
