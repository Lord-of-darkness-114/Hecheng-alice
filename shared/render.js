/* =============================================================================
 * 渲染层
 * -----------------------------------------------------------------------------
 * 只依赖适配层提供的 canvas 接口（与 W3C Canvas 2D 对齐），因此网页和微信
 * 可以共用同一份绘制代码。UI 也画在 canvas 上，两端连界面都不用各写一套。
 *
 * 性能策略：每个阶的球体先画进离屏 canvas（渐变/高光只算一次），
 * 运行时只做 drawImage —— 这是球多时帧率的关键。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;
  var U = G.util;

  var Render = G.Render = {
    ad: null,        // 适配层
    ctx: null,
    scale: 1,        // 逻辑坐标 -> 设备像素
    viewScale: 1,    // 逻辑坐标 -> CSS 像素
    dpr: 1,

    textures: [],    // [{ canvas, radius, ready }]
    images: {},      // 背景等整图
    fx: [],          // 特效对象池
    hits: [],        // 本帧可点击区域（由 versionRects 写入，game 用来做命中判定）
    shake: 0,        // 屏幕震动强度
    flash: 0,        // 全屏闪白/闪红
    banner: { text: '', t: 0 },
    toast: { text: '', t: 0 },

    /* 成就（2026-10-11 新增）：解锁提示条 + 面板滚动状态 */
    achvToasts: [],                  // 待弹的提示队列
    achvToast: { name: '', desc: '', t: 0 },
    achvScroll: 0,                   // 面板已滚动的像素
    _achvDrag: null,                 // { y0, s0 } 拖动起点

    /* ---------------- 初始化 ---------------- */
    init: function (adapter) {
      this.ad = adapter;
      this.ctx = adapter.ctx;
      this.resize();
      this.buildTextures();
      return this;
    },

    /* 画布尺寸变了就重算缩放。适配层负责告诉我 CSS 尺寸和 dpr */
    resize: function () {
      var ad = this.ad;
      this.dpr = ad.dpr || 1;
      this.viewScale = Math.min(ad.cssWidth / G.DESIGN.w, ad.cssHeight / G.DESIGN.h);
      this.scale = this.viewScale * this.dpr;
      return this;
    },

    /* 把逻辑坐标转换成鼠标/触摸坐标 */
    toLogicX: function (clientX) {
      var ad = this.ad;
      return (clientX - ad.originX) / this.viewScale;
    },

    /* ---------------- 球体贴图预渲染 ----------------
     * 每个阶级都会先生成一张"占位球"画布（代码画的渐变圆）。
     * 真正的贴图加载成功后会盖在它上面。
     * 贴图按**命名版本**分开缓存，所以两套版本可以用不同的画风。
     * -------------------------------------------------- */
    buildTextures: function () {
      var tiers = G.THEME.tiers;
      this.textures = [];
      for (var i = 0; i < tiers.length; i++) {
        var r = tiers[i].radius;
        var pad = Math.ceil(r * 0.22);              // 给外发光/描边留边
        var size = (r + pad) * 2;
        var ss = 2;                                  // 超采样，缩小时更干净
        var cv = this.ad.createCanvas(size * ss, size * ss);
        var c = cv.getContext('2d');
        c.setTransform(ss, 0, 0, ss, 0, 0);
        this._paintBall(c, r + pad, r + pad, r, tiers[i].color);
        this.textures.push({ canvas: cv, radius: r, pad: pad, img: null });
      }
      return this;
    },

    /* 贴图加载完成后调用：把图片塞进对应阶的纹理槽。
     * variant 省略时 = 当前版本。 */
    setTexture: function (tier, image, variant) {
      variant = variant || G.textureVariantName();
      if (!this.textureCache) this.textureCache = {};
      if (!this.textureCache[variant]) this.textureCache[variant] = {};
      this.textureCache[variant][tier] = image;
      // 如果是当前正在用的版本，同步更新占位槽，让球立刻变成贴图
      if (variant === G.textureVariantName() && this.textures[tier]) {
        this.textures[tier].img = image;
      }
      return this;
    },

    /* 懒加载时依次尝试的后缀。要和 web/main.js 的 FALLBACK_EXT 一致，
     * 否则运行时切换版本会认不出 .webp 这类格式（真图就是 .webp）。 */
    _LOAD_EXTS: ['.webp', '.jpg', '.png', '.jpeg'],

    /* 取当前该用的贴图；没加载过就后台加载一次，先返回 null（调用方会兜底）。
     * 候选顺序 = G.texturePathCandidates()：当前版本目录 → 默认目录，
     * 全部失败才真的走占位球。 */
    _textureFor: function (tier) {
      var variant = G.textureVariantName();
      if (!this.textureCache) this.textureCache = {};
      if (!this.textureCache[variant]) this.textureCache[variant] = {};
      if (Object.prototype.hasOwnProperty.call(this.textureCache[variant], tier)) {
        return this.textureCache[variant][tier];
      }
      this._loadTexture(variant, tier);     // 发起加载，本次先返回 null
      return null;
    },

    /* 真正发起一次贴图加载（内部用）。variant 是**显式传入**的版本名，不读当前版本 ——
     * 这样 preloadVariant() 才能提前下载"另一个"版本。
     * pending 计数用于知道"这个版本还在下载中"。 */
    _loadTexture: function (variant, tier) {
      if (!this.textureCache) this.textureCache = {};
      if (!this.textureCache[variant]) this.textureCache[variant] = {};
      var slot = this.textureCache[variant];
      if (Object.prototype.hasOwnProperty.call(slot, tier)) return slot[tier];
      slot[tier] = null;                       // 先占坑，避免每帧重复发起加载

      if (!this._pending) this._pending = {};
      this._pending[variant] = (this._pending[variant] || 0) + 1;
      var self = this;
      var settle = function () {
        self._pending[variant] = Math.max(0, (self._pending[variant] || 1) - 1);
      };

      if (typeof root === 'undefined' || !root.Image) { settle(); return null; }

      var dirs = G.texturePathCandidatesFor ? G.texturePathCandidatesFor(variant, tier)
                                            : [G.texturePathFor(tier)];
      var tries = [];
      for (var d = 0; d < dirs.length; d++) {
        var u = dirs[d];
        if (!u) continue;
        var dot = u.lastIndexOf('.');
        var base = dot > 0 ? u.slice(0, dot) : u;
        // 先试各种后缀（.webp 排最前，命中最快），再把原路径补在后面兜底
        for (var e = 0; e < this._LOAD_EXTS.length; e++) {
          var alt = base + this._LOAD_EXTS[e];
          if (tries.indexOf(alt) < 0) tries.push(alt);
        }
        if (tries.indexOf(u) < 0) tries.push(u);
      }

      var k = 0;
      var next = function () {
        if (k >= tries.length) { slot[tier] = null; settle(); return; }  // 全都没有 -> 占位球
        var img = new root.Image();
        img.onload = function () {
          slot[tier] = img;
          settle();
          if (variant === G.textureVariantName() && self.textures[tier]) {
            self.textures[tier].img = img;
          }
        };
        img.onerror = function () { k++; next(); };
        img.src = tries[k];
      };
      next();
      return null;
    },

    /* 某个版本的贴图还在下载吗？（想给玩家显示"贴图加载中"时可用） */
    variantPending: function (version) {
      return !!(this._pending && this._pending[version] > 0);
    },

    /* 提前把**另一个**命名版本的球体贴图也悄悄下载好。
     * ★ 2026-10-11 加：以前切换版本时才开始下载，云端第一次访问会先看到占位球。
     *   由 web/main.js 在首批素材加载完后调用（不 await，不阻塞开始界面）。 */
    preloadVariant: function (version) {
      if (!version || version === G.textureVariantName()) return this;
      for (var i = 0; i < G.THEME.tiers.length; i++) this._loadTexture(version, i);
      return this;
    },

    /* 占位球体画法：径向渐变 + 描边 + 高光，模拟球面光照。
     * 贴图就位后这段只在"加载失败兜底"和"离屏预渲染"里用到。 */
    _paintBall: function (c, cx, cy, r, color) {
      // 顶部环境光
      var g = c.createRadialGradient(cx - r * 0.34, cy - r * 0.40, r * 0.08, cx, cy, r * 1.05);
      g.addColorStop(0, U.lighten(color, 0.46));
      g.addColorStop(0.52, color);
      g.addColorStop(1, U.darken(color, 0.52));
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
      // 暗描边，让球堆里每个球都有轮廓
      c.lineWidth = Math.max(2, r * 0.07);
      c.strokeStyle = 'rgba(0,0,0,.55)';
      c.stroke();
      // 内层暖色反光（BLACK SOULS 的烛光感）
      var g2 = c.createRadialGradient(cx + r * 0.3, cy + r * 0.38, r * 0.05, cx, cy, r);
      g2.addColorStop(0, 'rgba(255,196,120,.20)');
      g2.addColorStop(1, 'rgba(255,196,120,0)');
      c.beginPath();
      c.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
      c.fillStyle = g2;
      c.fill();
      // 高光
      c.beginPath();
      c.ellipse(cx - r * 0.32, cy - r * 0.38, r * 0.26, r * 0.17, -0.6, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.fill();
    },

    /* ---------------- 绘制单个球 ---------------- */
    drawBall: function (cx, cy, tier, radius, angle, alpha) {
      var c = this.ctx;
      var tex = this.textures[tier];
      // 当前版本的贴图；**还没下载好**（云端第一次切版本时）就退回"已经加载过的那张"，
      // 最后才退回占位球 —— 否则切版本会闪一下代码画的占位小球（2026-10-11 修）
      var img = this._textureFor(tier) || (tex && tex.img) || null;
      if (alpha == null) alpha = 1;
      if (alpha < 1) { c.save(); c.globalAlpha = alpha; }

      // 地面投影（贴图版也保留，球堆才有体积感）
      c.beginPath();
      c.arc(cx + radius * 0.08, cy + radius * 0.12, radius, 0, Math.PI * 2);
      c.fillStyle = 'rgba(0,0,0,.42)';
      c.fill();

      if (tex && img) {
        // —— 贴图路径 ——
        // 尺寸按**物理碰撞半径**画，这样两球接触时贴图边缘正好相切。
        // 以前按 radius+pad 画，比碰撞体大 22%，换成有黑描边的贴图后
        // 就能明显看出球与球"陷进去"了。
        var size = radius * 2 * (G.ART.ballArtScale || 1);
        c.save();
        c.translate(cx, cy);
        if (angle) c.rotate(angle);
        c.drawImage(img, -size / 2, -size / 2, size, size);
        c.restore();
      } else if (tex) {
        // —— 占位路径（贴图还没加载好，或这个版本没有专属贴图）——
        var psize = radius * 2 * (G.ART.ballArtScale || 1);
        c.save();
        c.translate(cx, cy);
        if (angle) c.rotate(angle);
        c.drawImage(tex.canvas, -psize / 2, -psize / 2, psize, psize);
        c.restore();
      } else {
        this._paintBall(c, cx, cy, radius, G.THEME.tiers[tier].color);
      }
      if (alpha < 1) c.restore();
    },

    /* ---------------- 特效 ---------------- */
    burst: function (x, y, tier) {
      var color = G.THEME.tiers[tier].color;
      var r = G.THEME.tiers[tier].radius;
      var n = 12 + ((tier * 2) | 0);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 300;
        this.fx.push({
          kind: 'spark', x: x, y: y, t: 0,
          life: 0.36 + Math.random() * 0.3,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
          r: 2 + Math.random() * 3.6, color: color
        });
      }
      // 冲击环
      this.fx.push({ kind: 'ring', x: x, y: y, t: 0, life: 0.42, r0: r * 0.4, r1: r * 2.1, color: color, lw: Math.max(3, r * 0.09) });
      this.fx.push({ kind: 'ring', x: x, y: y, t: 0, life: 0.62, r0: r * 0.2, r1: r * 3.0, color: '#ffffff', lw: 1.6 });
      this.shake = Math.min(14, this.shake + 4 + tier * 1.1);
    },

    floatText: function (x, y, text) {
      this.fx.push({ kind: 'text', x: x, y: y, t: 0, life: 0.9, text: text });
    },

    /* 合成时的"角色喊话"字幕（名字取当前命名版本） */
    say: function (tier) {
      var name = G.tierName(tier);
      if (!name) return;
      this.banner.text = name;
      this.banner.t = 1.3;
    },

    update: function (dt) {
      var i, f;
      for (i = this.fx.length - 1; i >= 0; i--) {
        f = this.fx[i];
        f.t += dt;
        if (f.t >= f.life) { this.fx.splice(i, 1); continue; }
        if (f.kind === 'spark') {
          f.x += f.vx * dt; f.y += f.vy * dt;
          f.vy += 900 * dt; f.vx *= 0.985;
        }
      }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 42);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.2);
      if (this.banner.t > 0) this.banner.t -= dt;
      if (this.toast.t > 0) this.toast.t -= dt;

      // 成就提示条：当前这条放完，接着弹队列里的下一条
      if (this.achvToast.t > 0) {
        this.achvToast.t -= dt;
        if (this.achvToast.t <= 0 && this.achvToasts.length) {
          var nxt = this.achvToasts.shift();
          this.achvToast = { name: nxt.name, desc: nxt.desc, icon: nxt.icon,
                             t: (G.ACHV_UI && G.ACHV_UI.toastMs) || 3.4 };
        }
      }
    },

    clearFx: function () { this.fx.length = 0; this.shake = 0; this.flash = 0; this.banner.t = 0; },

    /* ---------------- 主绘制 ----------------
     * game 提供：balls / hold / holdX / score / best / dead / paused / muted
     * -------------------------------------------------- */
    draw: function (game, nowMs) {
      var c = this.ctx;
      var D = G.DESIGN;
      var s = this.scale;
      var sx = 0, sy = 0;
      if (this.shake > 0.2) {
        sx = (Math.random() - 0.5) * this.shake;
        sy = (Math.random() - 0.5) * this.shake;
      }

      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.ad.pixelWidth, this.ad.pixelHeight);
      c.setTransform(s, 0, 0, s, sx * s, sy * s);

      // 开始界面：只画标题画面，场地/球堆/瞄准/HUD 全部跳过
      if (game.screen === 'title') {
        this._drawTitle(c, game, nowMs);
        this._drawAchvToast(c);
        return;
      }
      // 成就面板：独立一屏（背景 + 列表 + 关闭）
      if (game.screen === 'achv') {
        this._drawBackground(c);
        this._drawAchvPanel(c, nowMs);
        this._drawAchvToast(c);
        return;
      }

      this._drawBackground(c);
      this._drawField(c, nowMs, game);
      // ★ 图层顺序是刻意安排的：
      //   1) 持球画在**球堆下面** —— 球堆长高时压得住它，不会遮住下面的球
      //      （玩家反馈的问题）。不用裁剪，球被球堆盖住是正常的空间关系。
      //   2) 球堆画完后再补"瞄准线 + 落点指示"，它们永远在最上层可见。
      if (!game.dead) this._drawHold(c, game, nowMs);
      this._drawBalls(c, game);
      if (!game.dead) this._drawAim(c, game, nowMs);
      this._drawFx(c);
      this._drawHud(c, game, nowMs);
      this._drawOverlay(c, game);
      if (this.flash > 0.01) {
        c.fillStyle = 'rgba(255,240,200,' + (this.flash * 0.35).toFixed(3) + ')';
        c.fillRect(0, 0, D.w, D.h);
      }
      this._drawAchvToast(c);          // 成就解锁提示（所有界面都可能在上面弹）
    },

    _drawBackground: function (c) {
      var D = G.DESIGN, C = G.THEME.colors;
      var bgImg = this.images.bg;
      if (bgImg) {
        // 等比铺满，居中（竖屏裁剪）
        var iw = bgImg.width, ih = bgImg.height;
        var k = Math.max(D.w / iw, D.h / ih);
        var w = iw * k, h = ih * k;
        c.drawImage(bgImg, (D.w - w) / 2, (D.h - h) / 2, w, h);
        // 压暗层：保证球体始终是视觉主体。强度见 config.js 的 G.ART.bgDim
        var dim = G.ART.bgDim;
        if (dim > 0) {
          c.fillStyle = 'rgba(4,3,6,' + dim + ')';
          c.fillRect(0, 0, D.w, D.h);
        }
        return;
      }
      var g = c.createLinearGradient(0, 0, 0, D.h);
      g.addColorStop(0, C.bgTop);
      g.addColorStop(0.5, C.bgMid);
      g.addColorStop(1, C.bgBottom);
      c.fillStyle = g;
      c.fillRect(0, 0, D.w, D.h);
      // 占位：顶部一束烛光
      var gl = c.createRadialGradient(D.w / 2, -60, 10, D.w / 2, -60, D.h * 0.6);
      gl.addColorStop(0, 'rgba(201,162,39,.16)');
      gl.addColorStop(1, 'rgba(201,162,39,0)');
      c.fillStyle = gl;
      c.fillRect(0, 0, D.w, D.h);
    },

    _drawField: function (c, nowMs, game) {
      var F = G.FIELD, C = G.THEME.colors, L = G.LAYOUT;
      var frameImg = this.images.frame;

      if (!frameImg) {
        var fg = c.createLinearGradient(0, F.y, 0, F.bottom);
        fg.addColorStop(0, C.fieldTop);
        fg.addColorStop(1, C.fieldBottom);
        this.roundRect(c, F.x, F.y, F.w, F.h, L.cornerRadius);
        c.fillStyle = fg;
        c.fill();
      } else {
        c.drawImage(frameImg, F.x, F.y, F.w, F.h);
      }
      this.roundRect(c, F.x, F.y, F.w, F.h, L.cornerRadius);
      // 场地描边：换成自己的场地贴图后如果觉得两层边框重复，
      // 把 config.js 里 G.ART.frameStroke 改成 false 即可
      if (G.ART.frameStroke !== false) {
        c.lineWidth = G.ART.frameStrokeWidth;
        c.strokeStyle = 'rgba(' + G.ART.frameStrokeColor + ',' + G.ART.frameStrokeAlpha + ')';
        c.stroke();
      }

      // 警戒线（同时是失败警戒线）。外观全部由 config.js 的 G.ART 控制：
      // ceilLine / ceilLineAlpha / ceilLineColor / ceilLineDash …
      var A = G.ART;
      if (A.ceilLine !== false && A.ceilLineAlpha > 0) {
        c.save();
        c.setLineDash(A.ceilLineDash || [12, 10]);
        c.lineWidth = A.ceilLineWidth || 2;
        c.globalAlpha = game.dead && A.ceilLineFlash !== false
          ? A.ceilLineAlpha * (1.2 + 1.0 * Math.abs(Math.sin(nowMs / 240)))
          : A.ceilLineAlpha;
        c.strokeStyle = 'rgb(' + (game.dead ? A.ceilLineColorOver : A.ceilLineColor) + ')';
        c.beginPath();
        c.moveTo(F.x + 4, G.CEIL_Y);
        c.lineTo(F.right - 4, G.CEIL_Y);
        c.stroke();
        c.restore();
      }
    },

    _drawBalls: function (c, game) {
      var list = game.balls;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        // 出场放大动画：born 从 1 -> 0
        var k = b.born > 0 ? U.mix(1.18, 1, 1 - b.born) : 1;
        this.drawBall(b.x, b.y, b.tier, b.radius * k, b.angle, 1);
      }
    },

    /* 持球的球心位置：让球的**最低点**落在警戒线上方一点（相切）。
     * 球心 = 警戒线 - 缝隙 - 半径 ⇒ 球越大球心越高，球始终完整待在虚线上方。
     * 抽成函数是因为 _drawHold 和 _drawAim 都要用，必须算得一模一样。
     * 可调参数见 config.js 的 G.AIM。 */
    holdPos: function (game, nowMs) {
      var F = G.FIELD, A = G.AIM;
      var r = G.THEME.tiers[game.hold.tier].radius;
      var x = U.clamp(game.holdX, F.x + r, F.right - r);
      var y = G.CEIL_Y - A.tangentGap - r;
      if (nowMs != null) y += Math.sin(nowMs / A.bobSpeed) * A.bobAmp;
      return { x: x, y: y, r: r };
    },

    /* 持球本体。
     * ★ 这个函数画在**球堆之前**（在球堆下面一层），所以球堆永远压得住它——
     *   玩家反馈"持球位置太低把下面的球遮住了"就是这么解决的。
     *   不做裁剪：被球堆盖住是正常的空间关系，比"把球切掉一半"自然。
     * 这里只画球；瞄准光柱和地面落点标记在 _drawAim() 里（球堆上层）。 */
    _drawHold: function (c, game, nowMs) {
      if (!game.hold) return;
      var p = this.holdPos(game, nowMs);
      this.drawBall(p.x, p.y, game.hold.tier, p.r, 0, 0.95);
    },

    /* 瞄准光柱 + 地面落点标记：画在球堆**之上**，所以永远看得见。
     * 球堆长高后持球会被压住，这两个提示就是届时唯一的瞄准依据。
     * 所有数值都从 G.AIM 读（见 config.js），这里只负责按参数画出来。 */
    _drawAim: function (c, game, nowMs) {
      if (!game.hold) return;
      var F = G.FIELD, A = G.AIM;
      var p = this.holdPos(game, nowMs);
      var r = p.r;
      var tint = 'rgba(' + A.colColor + ',';

      // 光柱起点**紧贴持球底部**，跟着球一起上下移动。
      // 不要把它裁到场内：那样 HUD 区会缺一段，看起来像断掉的（试过，不好看）。
      // 球本身画在它上面盖住起点，所以不会显得突兀。
      var top = p.y + r * A.colStart;
      var colBottom = Math.min(F.bottom, top + Math.max(A.colMinLen, r * A.colLen));
      var colW = Math.max(A.colMinWidth, r * A.colWidth);

      c.save();
      if (colBottom > top) {
        var pg = c.createLinearGradient(0, top, 0, colBottom);
        pg.addColorStop(0, tint + A.colAlphaTop + ')');
        pg.addColorStop(A.colMidPos, tint + A.colAlphaMid + ')');
        pg.addColorStop(1, tint + '0)');
        c.fillStyle = pg;
        c.fillRect(p.x - colW / 2, top, colW, colBottom - top);
      }

      // 地面落点标记：一段虚线弧 + 两侧短横线
      var ly = F.bottom - A.groundOffset;
      var lr = Math.min(r * A.groundRadius, A.groundMaxRadius);
      var wingX = r * A.groundWing;
      var wingIn = r * 0.2;

      function groundPath(cc) {
        cc.beginPath();
        cc.arc(p.x, ly, lr, Math.PI, 0);
        cc.stroke();
        cc.beginPath();
        cc.moveTo(p.x - lr - wingX, ly);
        cc.lineTo(p.x - wingIn, ly);
        cc.moveTo(p.x + wingIn, ly);
        cc.lineTo(p.x + lr + wingX, ly);
        cc.stroke();
      }

      if (A.groundShadow > 0) {
        // 先铺一层深色垫底，保证压在浅色球上也看得清
        c.setLineDash([]);
        c.lineWidth = A.groundShadowWidth;
        c.strokeStyle = 'rgba(0,0,0,' + A.groundShadow + ')';
        groundPath(c);
      }

      c.setLineDash([A.groundDash, A.groundGap]);
      c.lineWidth = A.groundWidth;
      c.strokeStyle = 'rgba(' + A.groundColor + ',' + A.groundAlpha + ')';
      groundPath(c);
      c.restore();          // 对应函数开头的 save()
    },

    _drawFx: function (c) {
      for (var i = 0; i < this.fx.length; i++) {
        var f = this.fx[i];
        var k = 1 - f.t / f.life;   // 1 -> 0
        c.save();
        c.globalAlpha = k;
        if (f.kind === 'spark') {
          c.beginPath();
          c.arc(f.x, f.y, f.r * k, 0, Math.PI * 2);
          c.fillStyle = f.color;
          c.fill();
        } else if (f.kind === 'ring') {
          c.beginPath();
          c.arc(f.x, f.y, U.mix(f.r1, f.r0, k), 0, Math.PI * 2);
          c.lineWidth = f.lw * k;
          c.strokeStyle = f.color;
          c.stroke();
        } else if (f.kind === 'text') {
          c.font = '700 34px ' + G.THEME.fontFamily;
          c.textAlign = 'center';
          c.fillStyle = G.THEME.colors.goldBright;
          c.fillText(f.text, f.x, f.y - (1 - k) * 46);
        }
        c.restore();
      }
    },

    /* ---------------- 小胶囊按钮（版本切换 / 返回 共用） ----------------
     * 只负责画；命中区由调用方组装进 this.hits（带约 12px 宽容度，手机手指粗）。
     * ------------------------------------------------------------------ */
    _chip: function (c, x, y, w, h, label, active, fontPx) {
      var C = G.THEME.colors;
      c.beginPath();
      this.roundRect(c, x, y, w, h, 6);
      c.fillStyle = active ? 'rgba(201,162,39,.22)' : 'rgba(0,0,0,.30)';
      c.fill();
      c.lineWidth = active ? 1.6 : 1;
      c.strokeStyle = active ? C.gold : 'rgba(140,130,102,.55)';
      c.stroke();
      c.font = (active ? '700 ' : '') + (fontPx || 15) + 'px ' + G.THEME.fontFamily;
      c.fillStyle = active ? C.goldBright : C.dim;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, x + w / 2, y + h / 2 + 1);
      c.textBaseline = 'alphabetic';
    },

    /* 命名版本切换胶囊的位置（HUD / 开始界面都用这一组坐标） */
    versionRects: function () {
      if (!G.NAME_VERSION_ORDER) return [];
      var out = [];
      var x = 20, y = 86, w = 76, h = 26, gap = 6;
      for (var i = 0; i < G.NAME_VERSION_ORDER.length; i++) {
        var key = G.NAME_VERSION_ORDER[i];
        var set = G.NAME_SETS[key];
        if (!set) continue;
        out.push({
          action: 'version', key: key, label: set.label, active: key === G.nameVersion,
          x: x, y: y, w: w, h: h,
          hitX: x - 10, hitY: y - 12, hitW: w + 20, hitH: h + 24
        });
        x += w + gap;
      }
      return out;
    },

    /* 画版本切换胶囊，并**返回**命中区（不再自己写 this.hits，
     * 因为开始界面还要往里加"开始游戏"、游戏里还要加"返回"） */
    _drawVersionPicker: function (c) {
      var rects = this.versionRects();
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        this._chip(c, r.x, r.y, r.w, r.h, r.label, r.active);
      }
      c.textAlign = 'center';
      return rects;
    },

    /* 游戏内右上角"返回"胶囊（回到开始界面），和版本胶囊同一套样式。
     * 2026-10-11 用户要求"稍微调大一点"：76×26 → 96×32，字号 15 → 18。 */
    backRect: function () {
      var w = 96, h = 32, x = G.DESIGN.w - 22 - w, y = 84;
      return {
        action: 'back', label: '返回', active: false, fontPx: 18,
        x: x, y: y, w: w, h: h,
        hitX: x - 12, hitY: y - 14, hitW: w + 24, hitH: h + 28
      };
    },

    /* 开始界面上"开始游戏"大按钮的位置 */
    titleStartRect: function () {
      var b = G.TITLE.button, x = (G.DESIGN.w - b.w) / 2;
      return {
        action: 'start', label: '开始游戏', active: false,
        x: x, y: b.y, w: b.w, h: b.h,
        hitX: x - 14, hitY: b.y - 14, hitW: b.w + 28, hitH: b.h + 28
      };
    },

    /* ---------------- 开始界面 ----------------
     * 版式数据在 config.js 的 G.TITLE；配色全部来自 G.THEME.colors。 */
    _drawTitle: function (c, game, nowMs) {
      var D = G.DESIGN, C = G.THEME.colors, T = G.TITLE;
      this._drawBackground(c);

      // 再压暗一层 + 四周暗角，标题文字才立得住
      c.fillStyle = 'rgba(4,3,6,' + T.bgDim + ')';
      c.fillRect(0, 0, D.w, D.h);
      var vg = c.createRadialGradient(D.w / 2, D.h * 0.44, D.w * 0.16,
                                      D.w / 2, D.h * 0.44, D.h * 0.74);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.60)');
      c.fillStyle = vg;
      c.fillRect(0, 0, D.w, D.h);
      // 顶部一束烛光（和游戏内那套语汇一致）
      var gl = c.createRadialGradient(D.w / 2, 40, 10, D.w / 2, 40, D.h * 0.5);
      gl.addColorStop(0, 'rgba(201,162,39,.14)');
      gl.addColorStop(1, 'rgba(201,162,39,0)');
      c.fillStyle = gl;
      c.fillRect(0, 0, D.w, D.h);

      c.textAlign = 'center';
      // —— 主标题（副标题留空就不画）——
      c.shadowColor = 'rgba(0,0,0,.85)';
      c.shadowBlur = 22;
      /* 主标题自动缩到安全宽度内：不同系统/手机上的字体宽度差很多，
       * 写死字号会在某些机器上**顶满或溢出**屏幕（实测 92px 已经贴边）。 */
      var maxW = T.titleMaxW || (D.w - 76), fs = 92;
      c.font = '700 ' + fs + 'px ' + G.THEME.fontFamily;
      while (fs > 40 && c.measureText(G.THEME.title).width > maxW) {
        fs -= 2;
        c.font = '700 ' + fs + 'px ' + G.THEME.fontFamily;
      }
      c.fillStyle = C.gold;
      c.fillText(G.THEME.title, D.w / 2, T.titleY);
      if (G.THEME.subtitle) {
        c.font = '600 36px ' + G.THEME.fontFamily;
        c.fillStyle = C.goldBright;
        c.fillText(G.THEME.subtitle, D.w / 2, T.titleY + T.subGap);
      }
      c.shadowBlur = 0;

      // —— 装饰线：两条金线 + 中间菱形 ——
      var ry = T.ruleY, half = 210, gd = 22;
      c.strokeStyle = 'rgba(201,162,39,.55)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(D.w / 2 - half, ry); c.lineTo(D.w / 2 - gd, ry);
      c.moveTo(D.w / 2 + gd, ry); c.lineTo(D.w / 2 + half, ry);
      c.stroke();
      c.beginPath();
      c.moveTo(D.w / 2, ry - 9); c.lineTo(D.w / 2 + 9, ry);
      c.lineTo(D.w / 2, ry + 9); c.lineTo(D.w / 2 - 9, ry);
      c.closePath();
      c.fillStyle = 'rgba(201,162,39,.75)';
      c.fill();

      // ================== "开始游戏"按钮 ==================
      // 血红底 + 四角角铁 + 上沿血滴 + 上下菱形钉子，文字逐字画（惊悚字体）。
      // 2026-10-11 用户要求：改血红色、加花纹、字体惊悚一点。
      var b = T.button, bx = (D.w - b.w) / 2, by = b.y;
      var pulse = 0.5 + 0.5 * Math.sin((nowMs || 0) / 520);
      var blood = C.blood, bloodBright = '#e8452c', bloodDeep = '#3d0709';
      var i;

      // 1) 底色：暗血红渐变 + 随呼吸的红色外发光
      c.save();
      c.shadowColor = 'rgba(192,57,43,' + (0.34 + pulse * 0.38).toFixed(3) + ')';
      c.shadowBlur = 26 + pulse * 20;
      var bgGrad = c.createLinearGradient(0, by, 0, by + b.h);
      bgGrad.addColorStop(0, 'rgba(104,16,18,.97)');
      bgGrad.addColorStop(0.55, 'rgba(62,9,13,.97)');
      bgGrad.addColorStop(1, 'rgba(26,4,7,.97)');
      c.beginPath();
      this.roundRect(c, bx, by, b.w, b.h, b.radius);
      c.fillStyle = bgGrad;
      c.fill();
      c.restore();

      // 2) 血滴花纹：从上沿挂下来，长度写死（随机的话每帧都在抖）
      var drips = [[0.13, 30], [0.29, 16], [0.52, 40], [0.71, 20], [0.88, 26]];
      c.lineCap = 'round';
      for (i = 0; i < drips.length; i++) {
        var dx = bx + b.w * drips[i][0], dl = drips[i][1];
        c.strokeStyle = 'rgba(150,22,24,.9)';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(dx, by + 8);
        c.lineTo(dx, by + 8 + dl);
        c.stroke();
        c.beginPath();                                   // 滴头
        c.arc(dx, by + 10 + dl, 2.8, 0, Math.PI * 2);
        c.fillStyle = 'rgba(150,22,24,.9)';
        c.fill();
      }

      // 3) 双层边框：外粗血红 + 内细亮血红
      c.beginPath();
      this.roundRect(c, bx, by, b.w, b.h, b.radius);
      c.lineWidth = 3;
      c.strokeStyle = blood;
      c.stroke();
      c.beginPath();
      this.roundRect(c, bx + 7, by + 7, b.w - 14, b.h - 14, b.radius - 6);
      c.lineWidth = 1.2;
      c.strokeStyle = 'rgba(232,69,44,.55)';
      c.stroke();

      // 4) 四角角铁（L 形）
      var cs = 24;
      var corners = [[bx, by, 1, 1], [bx + b.w, by, -1, 1],
                     [bx, by + b.h, 1, -1], [bx + b.w, by + b.h, -1, -1]];
      c.strokeStyle = bloodBright;
      c.lineWidth = 2.6;
      for (i = 0; i < corners.length; i++) {
        var o = corners[i];
        c.beginPath();
        c.moveTo(o[0] + o[2] * cs, o[1]);
        c.lineTo(o[0], o[1]);
        c.lineTo(o[0], o[1] + o[3] * cs);
        c.stroke();
      }
      // 上下边缘中点的菱形"钉子"
      var dia = function (x, y, r) {
        c.beginPath();
        c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y);
        c.closePath();
        c.fillStyle = 'rgba(232,69,44,.85)';
        c.fill();
      };
      dia(D.w / 2, by, 7);
      dia(D.w / 2, by + b.h, 7);

      // 5) 文字：逐字画（极轻的晃动 + 深红描边，做出"血字"感）
      //    草书字体本身已经带倾斜和连笔，所以**只留很小的歪斜/大小差**，
      //    不然叠加起来会显得散。字号给大一点：草书字形比隶书小一圈。
      var chars = String(T.startLabel || '开始游戏').replace(/\s+/g, '').split('');
      var lf = T.labelFont || G.THEME.fontFamily;
      var lfs = 58;
      var widths = [], total = 0, gapX = 16;
      c.font = '700 ' + lfs + 'px ' + lf;
      for (i = 0; i < chars.length; i++) {
        widths.push(c.measureText(chars[i]).width);
        total += widths[i];
      }
      total += gapX * (chars.length - 1);
      var tx = D.w / 2 - total / 2;
      var baseY = by + b.h / 2 + lfs * 0.33;
      c.textAlign = 'left';
      for (i = 0; i < chars.length; i++) {
        var wob = Math.sin((nowMs || 0) / 320 + i * 1.7) * 1.2;
        var sc = 1 + ((i % 3) - 1) * 0.03;               // 0.97 / 1 / 1.03，轻微大小不一
        c.save();
        c.translate(tx + widths[i] / 2, baseY + wob);
        c.rotate((i % 2 ? 1 : -1) * 0.015);              // 只歪一点点
        c.scale(sc, sc);
        c.font = '700 ' + lfs + 'px ' + lf;
        c.shadowColor = 'rgba(0,0,0,.9)';
        c.shadowBlur = 12;
        c.lineWidth = 3;
        c.strokeStyle = bloodDeep;                       // 深红描边
        c.strokeText(chars[i], -widths[i] / 2, 0);
        c.fillStyle = bloodBright;                       // 亮血红填充
        c.fillText(chars[i], -widths[i] / 2, 0);
        c.restore();
        tx += widths[i] + gapX;
      }
      c.shadowBlur = 0;
      c.textAlign = 'center';

      // —— 版本切换胶囊（决定放哪首 BGM）+ 组装命中区 ——
      // 注：开始界面上原来的小字说明（按钮下提示 / 最高分 / 底部操作说明 /
      //     "角色版本 · 决定 BGM" 标签）已按用户要求**全部去掉**。
      // —— 底部"成就"入口（显示已解锁进度）+ 版本切换胶囊 + 组装命中区 ——
      var achvRect = this.achvTitleRect();
      this._drawAchvEntry(c, achvRect);
      var picks = this._drawVersionPicker(c);
      this.hits = picks.concat([this.titleStartRect(), achvRect]);
    },

    /* ---------------- 成就面板 ----------------
     * 开始界面底部一个"成就 n/N"胶囊进入；面板里一条条列出（可上下拖动滚动）。
     * 未解锁压暗 + 显示进度；已解锁金色 + ★。
     * ------------------------------------------ */
    /* 开始界面底部入口的命中区（几何来自 G.ACHV_UI.entry*：面积约原来 2 倍，
     * 位置挪到"开始游戏"按钮正下方；绘制见 _drawAchvEntry） */
    achvTitleRect: function () {
      var UI = G.ACHV_UI;
      var w = UI.entryW, h = UI.entryH;
      var x = (G.DESIGN.w - w) / 2, y = UI.entryY;
      return {
        action: 'achv', label: '成就',
        x: x, y: y, w: w, h: h, fontPx: 22,
        hitX: x - 16, hitY: y - 16, hitW: w + 32, hitH: h + 32
      };
    },

    /* 面板右上角"关闭"（和游戏内"返回"同一套版式） */
    achvCloseRect: function () {
      var w = 96, h = 32, x = G.DESIGN.w - 22 - w, y = 84;
      return {
        action: 'achvClose', label: '关闭',
        x: x, y: y, w: w, h: h, fontPx: 18,
        hitX: x - 12, hitY: y - 12, hitW: w + 24, hitH: h + 24
      };
    },

    achvScrollReset: function () { this.achvScroll = 0; this._achvDrag = null; return this; },
    achvDragStart: function (y) { this._achvDrag = { y0: y, s0: this.achvScroll }; return this; },
    achvDragMove: function (y) {
      if (!this._achvDrag || typeof y !== 'number') return this;
      var step = (G.ACHV_UI && G.ACHV_UI.scrollStep) || 1;
      this.achvScroll = this._achvDrag.s0 - (y - this._achvDrag.y0) * step;
      return this;
    },
    achvDragEnd: function () { this._achvDrag = null; return this; },

    /* ---------------- 成就图标（代码画的） ----------------
     * 配色参考背景里的狮子/独角兽/骷髅：**惨白骨色为主 + 一点血红**。
     * kind: eye / egg / cup / apple / skull / key
     * on: 已解锁 = 骨白实心 + 血红点缀；未解锁 = 暗淡描边
     * ------------------------------------------------------ */
    iconOf: function (def) {
      var k = def && def.icon;
      return (G.ACHV_ICONS && G.ACHV_ICONS.indexOf(k) >= 0) ? k : 'eye';
    },

    _achvIcon: function (c, kind, cx, cy, r, on) {
      var C = G.ACHV_COLORS;
      var line = on ? C.bone : C.boneDim;
      var fill = on ? C.bone : 'rgba(214,206,182,.14)';
      var accent = on ? C.bloodBright : 'rgba(149,32,42,.45)';
      c.save();
      c.lineWidth = Math.max(1.6, r * 0.14);
      c.lineJoin = 'round';
      c.strokeStyle = line;
      c.fillStyle = fill;

      if (kind === 'egg') {
        c.beginPath();
        c.ellipse(cx, cy, r * 0.74, r, 0, 0, Math.PI * 2);
        c.fill(); c.stroke();
        c.beginPath();
        c.moveTo(cx - r * 0.4, cy - r * 0.55);
        c.lineTo(cx + r * 0.06, cy - r * 0.06);
        c.lineTo(cx - r * 0.3, cy + r * 0.12);
        c.lineTo(cx + r * 0.3, cy + r * 0.7);
        c.strokeStyle = accent;
        c.stroke();
      } else if (kind === 'cup') {
        c.beginPath();
        c.moveTo(cx - r * 0.72, cy - r * 0.5);
        c.lineTo(cx + r * 0.72, cy - r * 0.5);
        c.lineTo(cx + r * 0.5, cy + r * 0.6);
        c.quadraticCurveTo(cx, cy + r * 0.86, cx - r * 0.5, cy + r * 0.6);
        c.closePath();
        c.fill(); c.stroke();
        c.beginPath();
        c.moveTo(cx + r * 0.7, cy - r * 0.3);
        c.quadraticCurveTo(cx + r * 1.16, cy, cx + r * 0.7, cy + r * 0.28);
        c.strokeStyle = line;
        c.stroke();
        c.beginPath();
        c.moveTo(cx - r * 0.52, cy - r * 0.5);
        c.lineTo(cx + r * 0.52, cy - r * 0.5);
        c.strokeStyle = accent;
        c.lineWidth = Math.max(2, r * 0.24);
        c.stroke();
      } else if (kind === 'apple') {
        c.beginPath();
        c.arc(cx, cy + r * 0.12, r * 0.82, 0, Math.PI * 2);
        c.fill(); c.stroke();
        c.beginPath();
        c.moveTo(cx, cy - r * 0.68); c.lineTo(cx + r * 0.08, cy - r * 1.18);
        c.strokeStyle = line;
        c.stroke();
        c.beginPath();
        c.ellipse(cx + r * 0.44, cy - r * 0.96, r * 0.34, r * 0.16, -0.5, 0, Math.PI * 2);
        c.fillStyle = accent;
        c.fill();
      } else if (kind === 'skull') {
        c.beginPath();
        c.arc(cx, cy - r * 0.18, r * 0.82, Math.PI * 0.92, Math.PI * 0.08);
        c.quadraticCurveTo(cx + r * 0.62, cy + r * 0.72, cx + r * 0.3, cy + r * 0.78);
        c.lineTo(cx - r * 0.3, cy + r * 0.78);
        c.quadraticCurveTo(cx - r * 0.62, cy + r * 0.72, cx - r * 0.82, cy - r * 0.18);
        c.closePath();
        c.fill(); c.stroke();
        c.fillStyle = accent;
        c.beginPath(); c.arc(cx - r * 0.34, cy - r * 0.2, r * 0.22, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(cx + r * 0.34, cy - r * 0.2, r * 0.22, 0, Math.PI * 2); c.fill();
        c.strokeStyle = on ? 'rgba(20,14,12,.78)' : line;
        c.lineWidth = Math.max(1.2, r * 0.1);
        for (var ti = -1; ti <= 1; ti++) {
          c.beginPath();
          c.moveTo(cx + ti * r * 0.24, cy + r * 0.44);
          c.lineTo(cx + ti * r * 0.24, cy + r * 0.76);
          c.stroke();
        }
      } else if (kind === 'key') {
        c.beginPath(); c.arc(cx, cy - r * 0.5, r * 0.44, 0, Math.PI * 2);
        c.fill(); c.stroke();
        c.beginPath();
        c.moveTo(cx, cy - r * 0.06); c.lineTo(cx, cy + r);
        c.strokeStyle = line;
        c.stroke();
        c.beginPath();
        c.moveTo(cx, cy + r * 0.5); c.lineTo(cx + r * 0.44, cy + r * 0.5);
        c.moveTo(cx, cy + r * 0.88); c.lineTo(cx + r * 0.34, cy + r * 0.88);
        c.stroke();
        c.beginPath(); c.arc(cx, cy - r * 0.5, r * 0.17, 0, Math.PI * 2);
        c.fillStyle = accent; c.fill();
      } else {
        /* 默认：杏仁眼 + 血红瞳孔（最贴合这个游戏的调子） */
        c.beginPath();
        c.moveTo(cx - r, cy);
        c.quadraticCurveTo(cx, cy - r * 0.96, cx + r, cy);
        c.quadraticCurveTo(cx, cy + r * 0.96, cx - r, cy);
        c.closePath();
        c.fill(); c.stroke();
        c.beginPath();
        c.arc(cx, cy, r * 0.36, 0, Math.PI * 2);
        c.fillStyle = accent;
        c.fill();
      }
      c.restore();
    },

    /* 文字太长就自动缩字号（保底 minPx）—— 比如那条超长的"爱丽丝…"成就名 */
    _achvFitText: function (c, text, maxW, basePx, minPx) {
      var px = basePx, min = minPx || 12;
      c.font = '700 ' + px + 'px ' + G.THEME.fontFamily;
      while (px > min && c.measureText(text).width > maxW) {
        px -= 1;
        c.font = '700 ' + px + 'px ' + G.THEME.fontFamily;
      }
      return px;
    },

    /* 开始界面底部入口：骨白描边 + 血红点缀 + 小图标（面积约原来的 2 倍） */
    _drawAchvEntry: function (c, rect) {
      var C = G.ACHV_COLORS;
      var got = G.Achv ? G.Achv.count() : 0;
      var all = G.Achv ? G.Achv.total() : 0;
      c.beginPath();
      this.roundRect(c, rect.x, rect.y, rect.w, rect.h, 10);
      c.fillStyle = 'rgba(12,8,9,.62)';
      c.fill();
      c.lineWidth = 1.8;
      c.strokeStyle = C.borderOn;
      c.stroke();
      // 左侧血红竖条
      c.beginPath();
      this.roundRect(c, rect.x + 10, rect.y + rect.h / 2 - 13, 3, 26, 1.5);
      c.fillStyle = C.blood;
      c.fill();
      // 小图标（眼睛）
      this._achvIcon(c, 'eye', rect.x + 44, rect.y + rect.h / 2, 11, got > 0);
      // 文字
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.font = '700 22px ' + G.THEME.fontFamily;
      c.fillStyle = C.bone;
      c.fillText('成就', rect.x + 70, rect.y + rect.h / 2 + 1);
      c.font = '700 20px ' + G.THEME.fontFamily;
      c.fillStyle = got > 0 ? C.bloodBright : C.boneDim;
      c.textAlign = 'right';
      c.fillText(got + ' / ' + all, rect.x + rect.w - 18, rect.y + rect.h / 2 + 1);
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
    },

    /* 解锁一条成就：顶部弹提示条（同时解锁多条会排队依次弹） */
    showAchievement: function (def) {
      if (!def) return this;
      var fill = G.achvFill || function (t) { return t; };
      var item = { name: fill(def.name), desc: fill(def.desc), icon: this.iconOf(def) };
      if (this.achvToast.t > 0) this.achvToasts.push(item);
      else this.achvToast = {
        name: item.name, desc: item.desc, icon: item.icon,
        t: (G.ACHV_UI && G.ACHV_UI.toastMs) || 3.4
      };
      return this;
    },

    /* 成就解锁提示条：开头 0.4 秒滑入，最后 0.5 秒淡出（骨白 + 血红） */
    _drawAchvToast: function (c) {
      var T = this.achvToast;
      if (!T || T.t <= 0) return;
      var D = G.DESIGN, K = G.ACHV_COLORS;
      var total = (G.ACHV_UI && G.ACHV_UI.toastMs) || 3.4;
      var alpha = Math.min(1, T.t / 0.5);
      var slide = Math.min(1, Math.max(0, (total - T.t) / 0.4));
      var y = 96 - (1 - slide) * 70;
      var w = 480, x = (D.w - w) / 2;

      c.save();
      c.globalAlpha = alpha;
      c.beginPath();
      this.roundRect(c, x, y, w, 84, 12);
      c.fillStyle = 'rgba(8,5,5,.92)';
      c.fill();
      c.lineWidth = 1.8;
      c.strokeStyle = K.borderOn;
      c.stroke();
      // 左侧血红竖条
      c.beginPath();
      this.roundRect(c, x + 10, y + 16, 3, 52, 1.5);
      c.fillStyle = K.blood;
      c.fill();
      // 图标
      this._achvIcon(c, T.icon || 'eye', x + 54, y + 42, 17, true);
      // 文字
      c.textAlign = 'left';
      c.font = '13px ' + G.THEME.fontFamily;
      c.fillStyle = K.boneDim;
      c.fillText('成就解锁', x + 88, y + 30);
      this._achvFitText(c, T.name, w - 108, 24, 12);
      c.fillStyle = K.boneBright;
      c.fillText(T.name, x + 88, y + 62);
      c.restore();
      c.textAlign = 'center';
    },

    _drawAchvPanel: function (c, nowMs) {
      var D = G.DESIGN, UI = G.ACHV_UI, K = G.ACHV_COLORS;
      var rows = (G.Achv && G.Achv.rows) ? G.Achv.rows() : [];
      var got = (G.Achv && G.Achv.count) ? G.Achv.count() : 0;

      c.fillStyle = 'rgba(6,3,4,.78)';
      c.fillRect(0, 0, D.w, D.h);

      // 标题：骨白 + 血红辉光
      c.textAlign = 'center';
      c.font = '700 38px ' + G.THEME.fontFamily;
      c.shadowColor = 'rgba(149,32,42,.85)';
      c.shadowBlur = 16;
      c.fillStyle = K.boneBright;
      c.fillText('成 就  ' + got + ' / ' + rows.length, D.w / 2, UI.top - 30);
      c.shadowBlur = 0;
      c.font = '14px ' + G.THEME.fontFamily;
      c.fillStyle = K.boneDim;
      c.fillText('拖动列表可上下滚动', D.w / 2, UI.top - 6);

      var listTop = UI.top + 14;
      var listBottom = D.h - UI.bottom;
      var rowH = UI.rowH, gap = UI.rowGap;
      var totalH = rows.length * (rowH + gap) - gap;
      var maxScroll = Math.max(0, totalH - (listBottom - listTop));
      this.achvScroll = U.clamp(this.achvScroll, 0, maxScroll);

      c.save();
      c.beginPath();
      c.rect(0, listTop, D.w, listBottom - listTop);
      c.clip();

      var px = (D.w - UI.panelW) / 2;
      var nameX = px + 78;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var y = listTop + i * (rowH + gap) - this.achvScroll;
        if (y > listBottom || y + rowH < listTop) continue;

        c.beginPath();
        this.roundRect(c, px, y, UI.panelW, rowH, 10);
        c.fillStyle = r.unlocked ? K.rowOn : K.rowOff;
        c.fill();
        c.lineWidth = r.unlocked ? 1.6 : 1;
        c.strokeStyle = r.unlocked ? K.borderOn : K.borderOff;
        c.stroke();

        // 已解锁：左侧一条血红竖条
        if (r.unlocked) {
          c.beginPath();
          this.roundRect(c, px + 6, y + 12, 3, rowH - 24, 1.5);
          c.fillStyle = K.blood;
          c.fill();
        }

        // 图标（惨白+血红，代码画的）
        this._achvIcon(c, r.icon || 'eye', px + 44, y + rowH / 2,
                       (UI.icon || 30) / 2, !!r.unlocked);

        // 名字：太长自动缩字号（那条超长的"爱丽丝…"）
        c.textAlign = 'left';
        var nameMaxW = UI.panelW - 78 - (r.prog ? 96 : 20);
        this._achvFitText(c, r.name, nameMaxW, 22, 12);
        c.fillStyle = r.unlocked ? K.boneBright : K.boneDim;
        c.fillText(r.name, nameX, y + 27);

        // 说明
        c.font = '13px ' + G.THEME.fontFamily;
        c.fillStyle = r.unlocked ? 'rgba(230,223,200,.68)' : 'rgba(170,162,140,.52)';
        c.fillText(r.desc, nameX, y + 49);

        // 进度
        if (r.prog) {
          c.textAlign = 'right';
          c.font = '16px ' + G.THEME.fontFamily;
          c.fillStyle = r.unlocked ? K.bloodBright : K.boneDim;
          c.fillText(r.prog, px + UI.panelW - 16, y + rowH / 2 + 6);
        }
      }
      c.restore();

      // 滚动条（内容超出时才画）
      if (maxScroll > 0) {
        var trackH = listBottom - listTop;
        var barH = Math.max(36, trackH * trackH / totalH);
        var barY = listTop + (trackH - barH) * (this.achvScroll / maxScroll);
        c.beginPath();
        this.roundRect(c, D.w - 16, barY, 5, barH, 3);
        c.fillStyle = 'rgba(230,223,200,.38)';
        c.fill();
      }

      // 右上角关闭（骨白描边，和面板同一套配色）
      var close = this.achvCloseRect();
      c.beginPath();
      this.roundRect(c, close.x, close.y, close.w, close.h, 8);
      c.fillStyle = 'rgba(0,0,0,.48)';
      c.fill();
      c.lineWidth = 1.4;
      c.strokeStyle = K.borderOn;
      c.stroke();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '700 18px ' + G.THEME.fontFamily;
      c.fillStyle = K.bone;
      c.fillText(close.label, close.x + close.w / 2, close.y + close.h / 2 + 1);
      c.textBaseline = 'alphabetic';
      this.hits = [close];
    },

    _drawHud: function (c, game, nowMs) {
      var D = G.DESIGN, C = G.THEME.colors;
      c.textAlign = 'center';
      // 持球可以升到 HUD 区域，给文字加描边阴影保证任何情况下都读得清
      c.shadowColor = 'rgba(0,0,0,.75)';
      c.shadowBlur = 6;
      c.shadowOffsetY = 1;

      c.font = '600 26px ' + G.THEME.fontFamily;
      c.fillStyle = C.gold;
      // 副标题留空时只画标题（2026-10-11 标题改成"合成爱丽丝"后就不再需要副标题了）
      c.fillText(G.THEME.subtitle ? (G.THEME.title + ' · ' + G.THEME.subtitle) : G.THEME.title,
                 D.w / 2, 62);

      c.font = '700 66px ' + G.THEME.fontFamily;
      c.fillStyle = C.text;
      c.fillText(String(game.score), D.w / 2, 132);

      c.font = '16px ' + G.THEME.fontFamily;
      c.fillStyle = C.dim;
      c.fillText('最高 ' + game.best, D.w / 2, 162);

      // 右上角：静音开关
      c.font = '22px ' + G.THEME.fontFamily;
      c.textAlign = 'right';
      c.fillStyle = C.dim;
      c.fillText(game.muted ? '🔇' : '🔊', D.w - 22, 52);
      // 左上角：重开
      c.textAlign = 'left';
      c.fillText('⟲', 22, 52);
      c.textAlign = 'center';

      // 连击提示：贴场地上沿内侧**左对齐**（右侧是"下一个"预览，不能占）
      if (game.combo > 1) {
        c.font = '700 28px ' + G.THEME.fontFamily;
        c.fillStyle = C.goldBright;
        c.globalAlpha = 0.92;
        c.textAlign = 'left';
        c.fillText('×' + game.combo + ' COMBO', G.FIELD.x + 16, G.FIELD.y + 42);
        c.textAlign = 'center';
        c.globalAlpha = 1;
      }

      // 角色喊话字幕
      if (this.banner.t > 0) {
        c.globalAlpha = Math.min(1, this.banner.t);
        c.font = '700 40px ' + G.THEME.fontFamily;
        c.fillStyle = C.goldBright;
        c.fillText(this.banner.text, D.w / 2, D.h * 0.34);
        c.globalAlpha = 1;
      }
      if (this.toast.t > 0) {
        c.globalAlpha = Math.min(1, this.toast.t);
        c.font = '20px ' + G.THEME.fontFamily;
        c.fillStyle = C.text;
        c.fillText(this.toast.text, D.w / 2, D.h - 40);
        c.globalAlpha = 1;
      }

      // 待投放 / 下一个
      if (G.RULES.nextPreview && game.next != null && !game.dead) {
        c.font = '14px ' + G.THEME.fontFamily;
        c.fillStyle = C.dim;
        c.fillText('下一个', D.w - 74, 118);
        this.drawBall(D.w - 74, 146, game.next, 20, 0, 0.95);
      }

      // 命名版本切换（普通/地狱）+ 右上角"返回"（回到开始界面）
      var picks = this._drawVersionPicker(c);
      var back = this.backRect();
      this._chip(c, back.x, back.y, back.w, back.h, back.label, false, back.fontPx);
      this.hits = picks.concat([back]);

      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
    },

    _drawOverlay: function (c, game) {
      var D = G.DESIGN, C = G.THEME.colors;
      if (game.dead) {
        c.fillStyle = 'rgba(0,0,0,.62)';
        c.fillRect(0, 0, D.w, D.h);
        c.textAlign = 'center';
        c.fillStyle = C.blood;
        c.font = '700 68px ' + G.THEME.fontFamily;
        c.fillText(G.THEME.overTitle, D.w / 2, D.h / 2 - 20);
        c.fillStyle = C.gold;
        c.font = '22px ' + G.THEME.fontFamily;
        c.fillText('分数 ' + game.score + '　' + G.THEME.restartHint, D.w / 2, D.h / 2 + 40);
      } else if (game.paused) {
        c.fillStyle = 'rgba(0,0,0,.5)';
        c.fillRect(0, 0, D.w, D.h);
        c.textAlign = 'center';
        c.fillStyle = C.gold;
        c.font = '700 44px ' + G.THEME.fontFamily;
        c.fillText('已暂停', D.w / 2, D.h / 2);
      }
    },

    roundRect: function (c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }
  };
})(typeof window !== 'undefined' ? window : this);
