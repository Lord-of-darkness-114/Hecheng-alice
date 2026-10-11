/* =============================================================================
 * 网页音频实现（WebAudio 合成）
 * -----------------------------------------------------------------------------
 * 占位音效不下载任何第三方素材 —— 全部用振荡器和噪声在本地合成，
 * 因此没有任何版权问题（CC0 都不用管，因为是原创合成音）。
 * 你的正式音频到位后：把 G.ASSETS.audio 指向文件，这个文件自动让位。
 *
 * 对外只暴露 shared/audio.js 约定的五个方法。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G;

  /* ---------------- 合成基元 ---------------- */

  // 一个带包络的振荡器音
  function tone(ctx, dest, o) {
    var t0 = o.at, dur = o.dur;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol, t0 + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    return osc;
  }

  // 短噪声（气声/破碎感）
  function noise(ctx, dest, o) {
    var t0 = o.at, dur = o.dur;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 900, t0);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur);
    f.Q.value = o.q == null ? 1.2 : o.q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(o.vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0);
    return src;
  }

  var A4 = 440;
  function semi(n) { return A4 * Math.pow(2, n / 12); }   // n 为相对 A4 的半音数

  /* ---------------- 音效配方 ----------------
   * 全部按"角色在黑暗里的一次动作"来设计：干净、短促、带一点金属味。
   * ------------------------------------------ */
  var RECIPES = {
    // 投放：一记轻微的落石气声
    drop: function (ctx, out, at) {
      noise(ctx, out, { at: at, dur: 0.09, vol: 0.22, freq: 1600, freqTo: 420, filter: 'bandpass', q: 0.9 });
      tone(ctx, out, { at: at, freq: semi(-17), freqTo: semi(-24), dur: 0.10, vol: 0.16, type: 'sine' });
    },
    // 合成：两音上行 + 金属泛音，按阶数变调（rate 由调用方给）
    merge: function (ctx, out, at, rate) {
      rate = rate || 1;
      var base = semi(3) * rate;
      tone(ctx, out, { at: at, freq: base, dur: 0.20, vol: 0.22, type: 'triangle' });
      tone(ctx, out, { at: at + 0.055, freq: base * 1.5, dur: 0.26, vol: 0.18, type: 'triangle' });
      tone(ctx, out, { at: at, freq: base * 2, dur: 0.14, vol: 0.06, type: 'sine' });
      noise(ctx, out, { at: at, dur: 0.12, vol: 0.10, freq: base * 2.4, freqTo: base * 0.8, q: 2 });
    },
    // 满级：低音钟 + 长尾，仪式感
    finale: function (ctx, out, at) {
      tone(ctx, out, { at: at, freq: semi(-24), dur: 1.5, vol: 0.26, type: 'sine' });
      tone(ctx, out, { at: at + 0.02, freq: semi(-12), dur: 1.2, vol: 0.14, type: 'triangle' });
      tone(ctx, out, { at: at + 0.06, freq: semi(-5), dur: 0.9, vol: 0.10, type: 'triangle' });
    },
    // 失败：下行小调琶音，参考魂系死亡音效的语感
    over: function (ctx, out, at) {
      var notes = [0, -3, -7, -12, -19];
      for (var i = 0; i < notes.length; i++) {
        tone(ctx, out, {
          at: at + i * 0.13, freq: semi(notes[i]), dur: 1.1 - i * 0.1,
          vol: 0.22 - i * 0.02, type: i < 2 ? 'triangle' : 'sine'
        });
      }
      tone(ctx, out, { at: at, freq: semi(-31), dur: 2.2, vol: 0.20, type: 'sine' });
    },
    // UI 点击
    ui: function (ctx, out, at) {
      tone(ctx, out, { at: at, freq: semi(7), dur: 0.07, vol: 0.14, type: 'square' });
    }
  };

  /* ---------------- 背景音乐 ----------------
   * 2026-10-11：这里原本有一整套**实时合成的和弦垫**（Am-F-C-G 四小节循环，
   * 低声部持续音 + 三度 + 气声尾）。用户要求"把原 BGM 删了"，整段已移除。
   * 现在 BGM **只放 config 里配的音频文件**（按命名版本各一首，见 G.ASSETS.audio.bgm）。
   * ⚠️ 因此浏览器放不出 .ogg 时（iOS Safari / 微信 iOS）就是**没有 BGM**，
   *    不再有合成音顶替 —— 要兼容就得把 BGM 转成 .m4a / .mp3。
   * ---------------------------------------------------- */

  /* ---------------- 主实现 ---------------- */
  function noop() {}

  G.AudioWeb = function () {
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return G.Sound.noop();

    var ctx = null, master = null, unlocked = false;
    var urls = {};             // 正式音频文件（配置里给了就用文件）
    var els = {};              // HTMLAudio 兜底
    var bgmOn = false;         // BGM 文件是否正在播（合成 BGM 已删除，见文件开头）

    function ensure() {
      if (ctx) return ctx;
      try {
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; }
      return ctx;
    }

    function playRecipe(kind, opts) {
      if (!ensure()) return;
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 静默 */ } }
      RECIPES[kind](ctx, master, ctx.currentTime + 0.001, opts && opts.rate);
    }

    /* BGM 音量（config 里可调） */
    function bgmVol() {
      var a = G.ASSETS && G.ASSETS.audio;
      return (a && a.bgmVolume != null) ? a.bgmVolume : 0.32;
    }

    /* 这个浏览器放不放得出这首 BGM。
     * 重点：iOS Safari 不支持 ogg，必须提前判断，否则会静默地没声音。 */
    function canPlayBgm(url) {
      if (!url) return false;
      var dot = url.lastIndexOf('.');
      var ext = dot > 0 ? url.slice(dot).toLowerCase() : '';
      if (ext !== '.ogg' && ext !== '.oga') return true;   // mp3 / m4a / wav 都能放
      try {
        var probe = new root.Audio();
        return !!(probe.canPlayType && probe.canPlayType('audio/ogg; codecs="vorbis"'));
      } catch (e) { return false; }
    }

    function startBgmFile() {
      var a = els['bgm'];
      if (!a) return;
      try {
        a.loop = true;
        a.volume = bgmVol();
        a.currentTime = 0;
        var pr = a.play();
        if (pr && pr.catch) pr.catch(noop);
      } catch (e) { /* 静默 */ }
    }

    function stopBgmFile() {
      var a = els['bgm'];
      if (!a) return;
      try { a.pause(); a.currentTime = 0; } catch (e) { /* 静默 */ }
    }

    return {
      supported: true,

      load: function (name, url) {
        urls[name] = url;
        // 先用 HTMLAudio 兜底，正式文件加载成功就优先用它
        try {
          var a = new root.Audio();
          a.src = url;
          a.preload = 'auto';
          els[name] = a;
        } catch (e) { /* 静默 */ }
      },

      unlock: function () {
        unlocked = true;
        if (!ensure()) return;
        try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) { /* 静默 */ }
      },

      play: function (name, opts) {
        if (!unlocked) return;
        // 1) 有正式音频文件且已解码好 -> 用它（音质更好，也是微信端实际听到的）
        var a = els[name];
        if (a && a.readyState >= 2) {
          try {
            a.currentTime = 0;
            if (opts && opts.rate && 'playbackRate' in a) a.playbackRate = opts.rate;
            else if ('playbackRate' in a) a.playbackRate = 1;
            var pr = a.play();
            if (pr && pr.catch) pr.catch(noop);
            return;
          } catch (e) { /* 落到合成音 */ }
        }
        // 2) 没有文件 / 还没加载好 -> 实时合成（保证任何时候都有声音）
        if (name === 'drop') playRecipe('drop', opts);
        else if (name === 'over') playRecipe('over', opts);
        else if (name === 'ui') playRecipe('ui', opts);
        else if (name.indexOf('merge') === 0) {
          var idx = parseInt(name.slice(5), 10) || 0;
          var isFinal = idx >= G.THEME.tiers.length - 2;
          playRecipe('merge', { rate: 1 + idx * 0.05 });
          if (isFinal) playRecipe('finale', opts);
        }
      },

      loop: function (name, on) {
        if (name !== 'bgm') return;

        /* 只放文件：config 里按命名版本各一首（微信端用的也是同一套文件）。
         * 2026-10-11：原来这里还有一套"实时合成和弦垫"的兜底，按用户要求删了，
         * 所以放不出 .ogg 的浏览器（iOS）就是没有 BGM，不会有合成音顶替。 */
        if (!els['bgm'] || !canPlayBgm(urls['bgm'])) return;
        if (!on) { bgmOn = false; stopBgmFile(); return; }
        if (bgmOn || !unlocked) return;
        bgmOn = true;
        startBgmFile();
      }
    };
  };
})(typeof window !== 'undefined' ? window : this);
