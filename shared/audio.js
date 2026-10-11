/* =============================================================================
 * 音频子系统
 * -----------------------------------------------------------------------------
 * 设计要点：
 *  1. 不依赖任何外部库，播放能力由平台适配层注入（网页 = WebAudio，微信 =
 *     InnerAudioContext）。核心只管"什么时候该响什么"。
 *  2. 所有调用都是安全的：资源没加载好、平台不支持、用户还没交互过，
 *     一律静默失败，绝不抛错打断游戏。
 *  3. iOS/微信的自动播放限制：必须由用户第一次触摸解锁，见 unlock()。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;

  var Sound = G.Sound = {
    ready: false,
    muted: false,
    _impl: null,
    _registry: {},

    /* 平台适配层调用：注入播放实现
     * impl = {
     *   load(name, url) -> void
     *   play(name, opts) -> void          opts: { rate, volume }
     *   loop(name, on) -> void
     *   unlock() -> void
     *   supported: boolean
     * }
     */
    attach: function (impl) {
      this._impl = impl || null;
      this.ready = !!(impl && impl.supported);
      return this;
    },

    /* 注册一个音效名 -> 资源地址 */
    register: function (name, url) {
      this._registry[name] = url;
      if (this._impl && this.ready) {
        try { this._impl.load(name, url); } catch (e) { /* 静默 */ }
      }
      return this;
    },

    /* 一次性注册 config 里定义的整套音效 */
    registerAll: function (assets) {
      var i;
      this.register('drop', assets.drop);
      this.register('over', assets.over);
      this.register('ui', assets.ui);
      for (i = 0; i < assets.merge.length; i++) this.register('merge' + i, assets.merge[i]);
      this.setBgmForVersion();          // BGM 按当前命名版本注册
      return this;
    },

    /* 按命名版本切换 BGM（玩家点"正常版 / 地狱版"时调用）。
     * 正在播的话先停再换，听到的就是新曲子的开头。 */
    setBgmForVersion: function (version) {
      var url = G.bgmPathFor ? G.bgmPathFor(version) : '';
      var wanted = this._bgmWanted;
      if (wanted) this.bgm(false);        // 先停旧的（同时清掉适配层的"正在播"状态）
      this._bgmUrl = url;
      if (url) this.register('bgm', url);
      if (wanted) this.bgm(true);         // 再起新的
      return this;
    },

    /* 用户在触摸后调用一次，解锁自动播放限制 */
    unlock: function () {
      if (!this.ready) return;
      try { this._impl.unlock(); } catch (e) { /* 静默 */ }
    },

    /* 名字 + 可选参数。合成音按阶数变调（rate > 1 更清脆） */
    play: function (name, opts) {
      if (!this.ready || this.muted) return;
      try { this._impl.play(name, opts || {}); } catch (e) { /* 静默 */ }
    },

    playMerge: function (tier) {
      // tier 是"合成出来的新阶"，索引 0 起。音高随阶数升高，最高阶额外加一层
      var idx = G.util.clamp(tier - 1, 0, G.ASSETS.audio.merge.length - 1);
      this.play('merge' + idx, { rate: 1 + idx * 0.045 });
    },

    /* 投放某个角色时，播**这个角色自己的音效**（就是他的合成音，用户 2026-10-11 要求）。
     * tier 是 **0 起的阶索引**；艾露玛（0）没有专属音效 → 回退到通用投放音 'drop'。
     * 这里**不升调**（rate 保持 1），保持素材原音。 */
    playDropFor: function (tier) {
      var name = G.characterSoundName ? G.characterSoundName(tier) : '';
      if (name) this.play(name);
      else this.play('drop');
    },

    bgm: function (on) {
      this._bgmWanted = !!on;            // 记住"想不想要"，换版本/换曲后好恢复
      if (!this.ready) return;
      try { this._impl.loop('bgm', !!on && !this.muted); } catch (e) { /* 静默 */ }
    },

    toggleMute: function () {
      this.muted = !this.muted;
      if (this.muted) this.bgm(false);
      else this.bgm(true);
      return this.muted;
    }
  };

  /* BGM 音量：从 config 读，读不到就用 0.32 */
  function bgmVol() {
    var a = G.ASSETS && G.ASSETS.audio;
    return (a && a.bgmVolume != null) ? a.bgmVolume : 0.32;
  }

  /* -------- 空实现：平台不支持音频时挂这个，保证接口永远可用 -------- */
  G.Sound.noop = function () {
    return {
      supported: false,
      load: function () {}, play: function () {}, loop: function () {}, unlock: function () {}
    };
  };

  /* -------- 微信/小程序实现 --------
   * 用 wx.createInnerAudioContext()。每个音效预建一个实例并复用，
   * 比每次 new 一个省内存也不会有播放延迟。
   * -------------------------------- */
  G.Sound.WxImpl = function () {
    if (typeof wx === 'undefined' || !wx.createInnerAudioContext) return G.Sound.noop();
    var pool = {};
    var unlocked = false;
    return {
      supported: true,
      load: function (name, url) {
        /* 换曲（切换命名版本）时先销毁旧实例，否则会漏掉 InnerAudioContext */
        var old = pool[name];
        if (old) { try { old.stop(); old.destroy(); } catch (e) { /* 静默 */ } }
        var a = wx.createInnerAudioContext();
        a.src = url;
        a.obeyMuteSwitch = false;
        if (name === 'bgm') { a.loop = true; a.volume = bgmVol(); }
        pool[name] = a;
      },
      unlock: function () { unlocked = true; },
      play: function (name, opts) {
        var a = pool[name];
        if (!a || !unlocked) return;
        try {
          a.stop();
          if (opts.rate) a.playbackRate = opts.rate;
          a.volume = opts.volume == null ? 1 : opts.volume;
          a.play();
        } catch (e) { /* 静默 */ }
      },
      loop: function (name, on) {
        var a = pool[name];
        if (!a || !unlocked) return;
        try { if (on) a.play(); else a.stop(); } catch (e) { /* 静默 */ }
      }
    };
  };
})(typeof window !== 'undefined' ? window : this);
