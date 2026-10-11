/* =============================================================================
 * BLACK SOULS · 合成 —— 全局配置
 * -----------------------------------------------------------------------------
 * 这是**唯一**需要改玩法数值和美术资源的地方。
 * 贴图到位后：把 assets.tiers 换成你的文件名，把 theme.tiers 的 name 换成角色名。
 * ========================================================================== */
(function (root) {
  'use strict';

  var G = root.G = root.G || {};

  G.VERSION = '0.1.0';

  /* -------- 设计分辨率（逻辑坐标）：竖屏 9:16 -------- */
  G.DESIGN = { w: 720, h: 1280 };

  /* -------- 场地几何（逻辑坐标） -------- */
  G.LAYOUT = {
    padX: 14,          // 场地左右外边距
    top: 190,          // 场地顶部 y
    bottom: 14,        // 场地底部外边距
    /* 静态墙体/地板厚度。★ 必须远大于 maxSpeed：Matter 用的是离散碰撞，
     * 球在一帧内走过的距离若超过墙厚，就会整颗跳过墙体（tunneling）。
     * 80px 厚 vs 单帧最大 20px 位移 = 至少 4 帧可供检测，安全。 */
    wallThickness: 80,
    ceilOffset: 34,    // 警戒线在场地顶部上方多少像素
    dropOffset: 30,    // 物理球的出生点：场地顶部下方多少像素
    cornerRadius: 18
  };

  /* -------- 瞄准提示（持球位置 + 光柱 + 地面落点标记） --------
   * 想微调这些外观，改这一段就够了，不用碰 render.js。
   * 带「r」字样的参数是"持球半径的倍数"，所以球越大提示按比例越大。
   * ------------------------------------------------------------ */
  G.AIM = {
    // —— 持球位置 ——
    tangentGap: 3,        // 球的最低点离警戒线多少像素。0 = 严格相切，越大离虚线越远
    bobAmp: 2.5,          // 上下呼吸幅度（像素）。0 = 完全不浮动
    bobSpeed: 420,        // 呼吸周期，数值越大越慢

    // —— 瞄准光柱 ——
    colStart: 0.72,       // 光柱起点在球心往下多少（× 半径）。越小越往球里缩
    colLen: 2.3,          // 光柱长度（× 半径）
    colMinLen: 110,       // 光柱最短像素数（小球时也不会短得看不见）
    colWidth: 0.22,       // 光柱宽度（× 半径）
    colMinWidth: 5,       // 光柱最细像素数
    colColor: '232,205,140',   // 光柱颜色（RGB）
    colAlphaTop: 0.55,    // 起点透明度
    colAlphaMid: 0.28,    // 中段透明度
    colMidPos: 0.35,      // 中段位置（0 = 起点，1 = 终点）

    // —— 地面落点标记 ——
    groundOffset: 12,     // 标记离场地底边往上多少像素
    groundRadius: 0.7,    // 虚线弧半径（× 半径）
    groundMaxRadius: 46,  // 虚线弧半径上限（像素）
    groundColor: '232,205,140',
    groundAlpha: 0.8,     // 虚线透明度
    groundWidth: 2.4,     // 虚线线宽
    groundDash: 10,       // 虚线段长
    groundGap: 9,         // 虚线间隔
    groundWing: 0.32,     // 两侧短横线长度（× 半径）
    groundShadow: 0.42,   // 深色垫底的透明度，保证压在浅色球上也看得清。0 = 不要垫底
    groundShadowWidth: 5.5
  };

  /* -------- 物理参数（调这几个数就是调手感） --------
   * 单位说明：Matter.js 内部以像素为长度单位，gravity.y = 1 表示
   * 每帧给物体增加约 1px/帧 的竖直速度。实测 0.9~1.1 最接近原版手感。
   * -------------------------------------------------- */
  G.PHYSICS = {
    gravityY: 1.0,
    fixedStepMs: 1000 / 60,   // 固定步长：物理与显示刷新率解耦
    maxStepsPerFrame: 5,      // 单帧最多补几步（防止切后台回来瞬移炸开）
    maxFrameMs: 200,          // 单帧 dt 上限
    positionIterations: 10,   // Matter 默认 6，球挤球时解不开重叠。
                              // 注意别超 20：positionDamping = clamp(20/iterations,0,1)
                              // 到 1.0 后修正过激，反而更容易抖。
    velocityIterations: 8,    // 默认 4。这个直接决定"抖不抖、堆得稳不稳"
    constraintIterations: 2,  // 本项目没有 Constraint，保持默认即可（调了纯烧 CPU）
    enableSleeping: true,     // 静止球休眠：省 CPU + 消除堆叠抖动
    // 速度上限（像素/帧）。自由落体到底部时速度可达 25px/帧，可能一帧跨过
    // 墙厚造成穿墙；限制上限可从源头堵住 tunneling，代价是落体最快速度受控。
    maxSpeed: 20,
    // 几何分离修正：物理步之后把仍然深嵌的球对解析分开。
    // 0 = 关闭，1~3 有效。必须同时平移 position/positionPrev 否则球会炸开。
    sepPasses: 2,
    sepMinPenetration: 1.0,   // 小于这个重叠量视为正常接触，不动
    // 渲染插值：物理固定 60Hz，屏幕可能是 120Hz。开启后按"当前处于两个物理
    // 步之间的比例"插值绘制，高刷屏上明显更丝滑；关掉就退化成直接画物理位置。
    interpolate: true,
    // 兜底：每步检查球是否跑出场地，跑出去的贴回墙面（正常游玩不会触发）
    contain: true,
    // 球体材质
    ball: {
      restitution: 0.06,      // 低弹性：不要弹弹球
      friction: 0.42,         // 高摩擦：球堆不滑
      frictionStatic: 1.0,
      frictionAir: 0.008,
      density: 0.0011,
      slop: 0.04,             // 允许轻微重叠，显著减少抖动
      sleepThreshold: 45      // 45 次 update ≈ 0.75s 静止后入睡（默认 60 偏久）
    },
    wall: {
      friction: 0.28,
      restitution: 0.02
    }
  };

  /* -------- 玩法数值 -------- */
  G.RULES = {
    tierCount: 8,             // 阶数
    spawnPool: 4,             // 投放池：只用最低的 5 阶（0..4），同原版
    dropCooldownMs: 340,      // 两次投放的最小间隔
    mergeScore: 1,            // 合成第 n 阶（0 起）得分 = mergeScore << n
    nextPreview: true,        // 是否显示"下一个球"
    // 失败判定：球静止 + 顶部越过警戒线，持续超过这个时间就结束
    overLineMs: 900,
    overLineSpeed: 0.35,      // 视为"静止"的速度阈值
    overLineDepth: 0,         // 需要越线多少像素才算（0 = 贴上就算）
    // 连击：短时间内连续合成有加成
    comboWindowMs: 1200,
    comboBonus: 0.25
  };

  /* -------- 素材路径（贴图到位后只改这里） -------- */
  G.ASSETS = {
    bg: 'assets/bg.png',
    panel: 'assets/panel.png',
    frame: 'assets/frame.png',
    tiers: [                  // 索引 0 = 最小阶
      'assets/tiers/tier1.png',
      'assets/tiers/tier2.png',
      'assets/tiers/tier3.png',
      'assets/tiers/tier4.png',
      'assets/tiers/tier5.png',
      'assets/tiers/tier6.png',
      'assets/tiers/tier7.png',
      'assets/tiers/tier8.png'
    ],
    audio: {
      drop: 'assets/audio/drop.wav',
      merge: [                // 按阶数变调，索引 0 = 合成出第 2 阶
        'assets/audio/merge1.wav', 'assets/audio/merge2.wav',
        'assets/audio/merge3.wav', 'assets/audio/merge4.wav',
        'assets/audio/merge5.wav', 'assets/audio/merge6.wav',
        'assets/audio/merge7.wav', 'assets/audio/merge8.wav'
      ],
      over: 'assets/audio/gameover.wav',
      ui: 'assets/audio/ui.wav'
    }
  };

  /* -------- 角色与美术配置 --------
   * name  : 显示名（合成提示、图鉴用）
   * radius: 逻辑像素半径
   * color : 占位球颜色；贴图加载成功后不再使用
   * ------------- 这些是占位角色名，等你的角色表来了直接换 ------------- */
  G.THEME = {
    title: 'BLACK SOULS',
    subtitle: '合成',
    overTitle: 'YOU DIED',
    restartHint: '点击重开',
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif',
    colors: {
      gold: '#c9a227',
      goldBright: '#e8d79a',
      text: '#efe4c2',
      dim: '#8c8266',
      blood: '#c0392b',
      fieldTop: 'rgba(46,32,44,.85)',
      fieldBottom: 'rgba(20,12,20,.95)',
      bgTop: '#151119',
      bgMid: '#0c0a10',
      bgBottom: '#060509'
    },
    tiers: [
      { name: '火柴少女', color: '#8e2b32', radius: 27 },
      { name: '骷髅兵',   color: '#b8763a', radius: 37 },
      { name: '狂人',     color: '#d8b45a', radius: 50 },
      { name: '食尸鬼',   color: '#6f8f4a', radius: 64 },
      { name: '黑骑士',   color: '#3f7d8c', radius: 80 },
      { name: '魔女',     color: '#7d4a8f', radius: 99 },
      { name: '巨龙',     color: '#b03a2e', radius: 120 },
      { name: '魔王',     color: '#c9a227', radius: 145 }
    ]
  };

  /* -------- 由上面的配置推导出来的运行时常量（不要手改） -------- */
  G.derive = function () {
    var L = G.LAYOUT, D = G.DESIGN;
    G.FIELD = {
      x: L.padX,
      y: L.top,
      w: D.w - L.padX * 2,
      h: D.h - L.top - L.bottom
    };
    G.FIELD.right = G.FIELD.x + G.FIELD.w;
    G.FIELD.bottom = G.FIELD.y + G.FIELD.h;
    G.FIELD.floorY = G.FIELD.bottom;
    G.CEIL_Y = G.FIELD.y - L.ceilOffset;
    G.DROP_Y = G.FIELD.y + L.dropOffset;
    G.SPAWN_POOL = [];
    for (var i = 0; i <= Math.min(G.RULES.spawnPool, G.THEME.tiers.length - 1); i++) G.SPAWN_POOL.push(i);
    return G;
  };

  /* -------- 工具函数（两端共用，避免各自实现） -------- */
  G.util = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    mix: function (a, b, k) { return a + (b - a) * k; },
    randInt: function (n) { return (Math.random() * n) | 0; },
    pick: function (arr) { return arr[(Math.random() * arr.length) | 0]; },
    hex2rgb: function (hex) {
      if (hex.charAt(0) === '#') hex = hex.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      var n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    lighten: function (hex, k) { return G.util.mixHex(hex, [255, 255, 255], k); },
    darken: function (hex, k) { return G.util.mixHex(hex, [0, 0, 0], k); },
    mixHex: function (hex, target, k) {
      var c = G.util.hex2rgb(hex);
      return 'rgb(' + Math.round(G.util.mix(c[0], target[0], k)) + ',' +
        Math.round(G.util.mix(c[1], target[1], k)) + ',' +
        Math.round(G.util.mix(c[2], target[2], k)) + ')';
    }
  };

  G.derive();
})(typeof window !== 'undefined' ? window : this);
