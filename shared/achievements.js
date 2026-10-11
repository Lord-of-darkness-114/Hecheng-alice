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
      tierMerges: [0, 0, 0, 0, 0, 0, 0, 0]   // 合成出第 N 阶（0 起索引）的次数
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
      if (k === 'tierMerges') {
        var tm = s.tierMerges;
        for (var i = 0; i < base.tierMerges.length; i++) {
          var v = tm ? tm[i] : 0;
          base.tierMerges[i] = (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0;
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

    /* 纯逻辑：找出"还没解锁、条件已满足"的成就 id（不写存档，自测可随便调） */
    newlyUnlocked: function (stats, unlocked) {
      var out = [];
      var l = this.list();
      var u = unlocked || {};
      for (var i = 0; i < l.length; i++) {
        var a = l[i];
        if (!a || !a.id || u[a.id]) continue;
        try { if (a.test(stats)) out.push(a.id); } catch (e) { /* 单条坏了不影响其它 */ }
      }
      return out;
    },

    /* 正式解锁：写进 unlocked + 存盘，返回新解锁的成就定义（给上层弹提示） */
    check: function () {
      var ids = this.newlyUnlocked(this.stats, this.unlocked);
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
      return this.check();
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
          name: fill(a.name),
          desc: fill(a.desc),
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
