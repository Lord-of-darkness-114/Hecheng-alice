/* =============================================================================
 * 成就系统（2026-10-11 新增）
 * -----------------------------------------------------------------------------
 * 设计要点：
 *  1. **统计**（stats）跨局累计并持久化：总合成数、各阶合成次数、最高分、最高阶、
 *     游玩局数、最高连击、合出最高阶角色的次数…
 *  2. 成就是一份表（见 config.js 的 G.ACHIEVEMENTS），每条自带 test(stats)。
 *     判定逻辑是**纯函数**（newlyUnlocked / parse / serialize），方便自测，
 *     也不怕存档损坏（解析失败回退成空白，绝不崩）。
 *  3. 存储走适配层的 getData/setData（网页 = localStorage，微信 = setStorageSync）；
 *     适配层没提供就退化成"只在内存里记着"，不影响游戏本身。
 *  4. 所有对外方法都**不抛异常**：成就系统坏了也绝不该影响玩。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;
  var KEY = 'bs_suika_achv_v1';

  function blankStats() {
    return {
      merges: 0,        // 累计合成次数
      drops: 0,         // 累计投放次数
      games: 0,         // 累计开局数
      best: 0,          // 单局最高分
      totalScore: 0,    // 累计得分
      maxTier: 0,       // 到达过的最高阶（0 起索引）
      maxCombo: 0,      // 最高连击
      aliceCount: 0,    // 合出最高阶角色的次数
      hellGames: 0,     // 在地狱版开局的次数（「另一个世界」）
      hellMerges: 0,    // 在地狱版合成过的次数（地狱版那条「初次合成」）
      allTiersInOneGame: 0,   // 有没有过"单局集齐 7 个角色"（0/1，「全图鉴」）
      tierMerges: [0, 0, 0, 0, 0, 0, 0, 0],        // 合成出第 N 阶（0 起索引）的次数（跨局累计）
      /* 「一局内合成出 N 个某角色」用：**单局最高**次数，按命名版本分开记 */
      gameTierNormal: [0, 0, 0, 0, 0, 0, 0, 0],
      gameTierHell: [0, 0, 0, 0, 0, 0, 0, 0]
    };
  }

  /* 序列化 / 解析：**纯函数**，自测直接调，坏数据也绝不抛错 */
  function serialize(stats, unlocked) {
    try { return JSON.stringify({ v: 1, stats: stats, unlocked: unlocked || {} }); }
    catch (e) { return ''; }
  }

  function parse(text) {
    var out = { stats: blankStats(), unlocked: {} };
    var o;
    try { o = JSON.parse(text || ''); } catch (e) { return out; }
    if (!o || typeof o !== 'object') return out;

    var base = blankStats();
    var s = (o.stats && typeof o.stats === 'object') ? o.stats : {};
    for (var k in base) {
      if (Object.prototype.toString.call(base[k]) === '[object Array]') {
        /* 任何"数字数组"字段（tierMerges / gameTierNormal / gameTierHell…）逐个校验：
         * 缺失或非法一律补 0 —— 老存档（没这些字段）也能平滑升级 */
        var src = s[k];
        for (var i = 0; i < base[k].length; i++) {
          var v = src ? src[i] : 0;
          base[k][i] = (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0;
        }
      } else if (typeof s[k] === 'number' && isFinite(s[k]) && s[k] > 0) {
        base[k] = s[k];
      }
    }
    out.stats = base;

    var u = o.unlocked;
    if (u && typeof u === 'object') {
      for (var id in u) { if (u[id]) out.unlocked[id] = u[id]; }
    }
    return out;
  }

  var Achv = G.Achv = {
    stats: blankStats(),
    unlocked: {},
    _ad: null,
    KEY: KEY,

    /* 暴露纯函数给自测用 */
    blankStats: blankStats,
    serialize: serialize,
    parse: parse,

    /* 接上适配层并读存档（没存档就是全新） */
    init: function (adapter) {
      this._ad = adapter || null;
      var raw = '';
      try { if (adapter && adapter.getData) raw = adapter.getData(KEY); } catch (e) { raw = ''; }
      var d = parse(raw);
      this.stats = d.stats;
      this.unlocked = d.unlocked;
      return this;
    },

    save: function () {
      try {
        if (this._ad && this._ad.setData) this._ad.setData(KEY, serialize(this.stats, this.unlocked));
      } catch (e) { /* 隐私模式 / 存储满：静默 */ }
      return this;
    },

    list: function () { return G.ACHIEVEMENTS || []; },

    byId: function (id) {
      var l = this.list();
      for (var i = 0; i < l.length; i++) { if (l[i].id === id) return l[i]; }
      return null;
    },

    /* 纯逻辑：找出"还没解锁、条件已满足"的成就 id（不写存档，自测可随便调）。
     * version 省略时用当前命名版本；带 ver 标记的成就只在该版本里判定
     * （正常版 7 条单局累计 + 初次合成 / 地狱版另一套，两套各算各的）。 */
    newlyUnlocked: function (stats, unlocked, version) {
      var out = [];
      var l = this.list();
      var u = unlocked || {};
      var v = version || G.nameVersion;
      for (var i = 0; i < l.length; i++) {
        var a = l[i];
        if (!a || !a.id || u[a.id]) continue;
        if (a.ver && a.ver !== v) continue;        // 版本限定
        try { if (a.test(stats)) out.push(a.id); } catch (e) { /* 单条坏了不影响其它 */ }
      }
      return out;
    },

    /* 正式解锁：写进 unlocked + 存盘，返回新解锁的成就定义（给上层弹提示） */
    check: function (version) {
      var v = version || G.nameVersion;
      var ids = this.newlyUnlocked(this.stats, this.unlocked, v);
      var out = [];
      var now = (root.Date && root.Date.now && root.Date.now()) || 0;
      for (var i = 0; i < ids.length; i++) {
        this.unlocked[ids[i]] = now;
        var def = this.byId(ids[i]);
        if (def) out.push(def);
      }
      if (ids.length) this.save();
      return out;
    },

    /* ---------------- 事件入口（都由 game.js 调） ---------------- */
    beginGame: function () {
      this.stats.games++;
      if (G.nameVersion === 'hell') this.stats.hellGames++;   // 「另一个世界」
      return this.check();
    },

    /* 单局内集齐全部角色时由 game.js 调（「全图鉴」）。只会在第一次时返回成就。 */
    noteAllTiers: function () {
      if (this.stats.allTiersInOneGame) return [];
      this.stats.allTiersInOneGame = 1;
      var out = this.check();
      this.save();
      return out;
    },

    noteDrop: function () {
      this.stats.drops++;
      return this.check();
    },

    /* newTier 是**合成出来的新阶**（0 起索引）；combo 传当前连击 */
    noteMerge: function (newTier, combo) {
      var s = this.stats;
      s.merges++;
      if (typeof newTier === 'number' && newTier >= 0 && newTier < s.tierMerges.length) {
        s.tierMerges[newTier]++;
      }
      if (typeof newTier === 'number' && newTier > s.maxTier) s.maxTier = newTier;
      if (newTier === G.THEME.tiers.length - 1) s.aliceCount++;
      if (combo && combo > s.maxCombo) s.maxCombo = combo;
      return this.check();
    },

    /* 每次合成时由 game.js 调：告诉它"本局这个阶已经合出几个了"（用户 2026-10-11 改版）。
     * · 按命名版本分开记（normal / hell 各一套，互不解锁）
     * · 记的是**单局最高**次数（跨局取 max），所以条件就是"某一局内做到过 N 个"
     * · 顺便累计地狱版合成次数（给地狱版那条「初次合成」用） */
    noteGameTier: function (version, tier, countInGame) {
      var v = (version === 'hell') ? 'hell' : 'normal';
      var arr = (v === 'hell') ? this.stats.gameTierHell : this.stats.gameTierNormal;
      if (typeof tier === 'number' && tier >= 0 && tier < arr.length
          && typeof countInGame === 'number' && countInGame > arr[tier]) {
        arr[tier] = countInGame;
      }
      if (v === 'hell') this.stats.hellMerges++;
      return this.check(v);
    },

    noteGameOver: function (score) {
      var s = this.stats;
      var sc = (typeof score === 'number' && isFinite(score)) ? score : 0;
      if (sc > s.best) s.best = sc;
      s.totalScore += sc;
      var out = this.check();
      this.save();                       // 局末一定落盘
      return out;
    },

    /* ---------------- 给界面用 ---------------- */
    count: function () {
      var n = 0;
      for (var id in this.unlocked) { if (this.unlocked[id]) n++; }
      return n;
    },

    total: function () { return this.list().length; },

    /* 面板一行所需的全部显示数据（角色名按当前命名版本替换） */
    rows: function () {
      var out = [];
      var l = this.list();
      var fill = G.achvFill || function (t) { return t; };
      for (var i = 0; i < l.length; i++) {
        var a = l[i];
        var prog = '';
        try { prog = a.prog ? a.prog(this.stats) : ''; } catch (e) { prog = ''; }
        out.push({
          id: a.id,
          name: fill(a.name, a.ver),        // 带 ver 的成就固定用那个版本的角色名
          desc: fill(a.desc, a.ver),
          icon: a.icon || 'eye',            // 图标类型（画法见 render.js 的 _achvIcon）
          ver: a.ver || '',
          prog: prog,
          unlocked: !!this.unlocked[a.id]
        });
      }
      return out;
    },

    /* 调试 / 自测：清空（面板里不暴露按钮，避免误触） */
    reset: function () {
      this.stats = blankStats();
      this.unlocked = {};
      this.save();
      return this;
    }
  };
})(typeof window !== 'undefined' ? window : this);
