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

  /* -------- 美术整体观感（背景图 / 场地贴图） --------
   * 换了背景图之后，最常要动的就是这几个数。
   * -------------------------------------------------- */
  G.ART = {
    /* 背景压暗层。铺在背景图之上，数值越大整张背景越暗、球越突出。
     * 0 = 背景图原样显示（想看清美术细节就调小），0.6 以上会很暗。
     * 参考：0.35 偏暗（背景只当纹理）／0.18 能看清画面又不抢眼／0 最亮。 */
    bgDim: 0.12,
    /* 场地贴图（frame.png）之上那圈描边线。**现在是完全透明（不画）**。
     * 想再启用就把 frameStroke 改成 true，再用下面两个值调它的样子。 */
    frameStroke: false,
    frameStrokeWidth: 3,
    frameStrokeColor: '190,150,80',   // RGB
    frameStrokeAlpha: 0,              // 0 = 完全透明

    /* 球体贴图的绘制大小（相对物理碰撞半径的倍数）。
     * 1.0 = 贴图边缘正好等于碰撞体边缘，两球接触时**刚好相切、不会陷进去**。
     * 大于 1 会让球看起来更大，但重叠时就会出现"陷进对方"的视觉错误。
     * 贴图如果自己留了透明边（球体没占满画布），可以适当调大来补偿。 */
    ballArtScale: 1.0,

    /* —— 警戒线（场地顶部那条横虚线）——
     * 它同时是"失败警戒线"，所以不建议完全去掉；太平淡也可以调淡一点。
     * 注意：越淡，玩家越不容易察觉"球快堆到顶了"。 */
    ceilLine: true,           // false = 完全不画
    ceilLineAlpha: 0.5,      // 平时透明度。0 = 隐形（等于关掉）；0.35 是原来的值
    ceilLineWidth: 2,
    ceilLineColor: '201,162,39',      // 平时的颜色（现在的金色）
    ceilLineColorOver: '192,57,43',   // 失败/越线时的颜色（现在的血红）
    ceilLineDash: [12, 10],   // 虚线的"段长, 间隔"
    ceilLineFlash: true       // 判负时是否闪烁
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
    colStart: 0.98,       // 光柱起点在球心往下多少（× 半径）。越小越往球里缩
    colLen: 2.3,          // 光柱长度（× 半径）
    colMinLen: 110,       // 光柱最短像素数（小球时也不会短得看不见）
    colWidth: 0.22,       // 光柱宽度（× 半径）
    colMinWidth: 5,       // 光柱最细像素数
    colColor: '232,205,140',   // 光柱颜色（RGB）
    colAlphaTop: 0.55,    // 起点透明度
    colAlphaMid: 0.28,    // 中段透明度
    colMidPos: 0.35,      // 中段位置（0 = 起点，1 = 终点）

    // —— 地面落点标记 ——
    groundOffset: 7,     // 标记离场地底边往上多少像素
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
    /* ★ 碰撞半径 = **贴图半径** × 这个系数（2026-10-12 用户要求："碰撞体积略小于贴图"）。
     * 只影响物理；贴图照旧按 G.THEME.tiers[].radius 画 —— 于是球与球之间会留一点缝，
     * 看起来像"贴图刚好相切"，而不是"还没碰到就被弹开"。
     *   1.00 = 碰撞边缘正好等于贴图边缘（旧行为）
     *   0.94 = 碰撞比贴图小 6%（首版试过，用户觉得缝偏大）
     *   0.98 = **当前**：几乎贴着、只剩一点点缝（用户 2026-10-12 亲自调定）
     * 想更松就调小，想贴回去就调 1.0。 */
    collisionScale: 0.98,
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
    /* ★ 2026-10-12 物理审计：原来 1.0 —— 等于"正常接触的残留重叠也要去修"。
     * Matter 静置球堆的残留重叠本来就有 0.5~1.0px（实测平均 0.77 / 最大 1.00），
     * 于是分离修正每帧都在跟求解器互相拉扯，某些堆型会卡进**永久微抖**：
     *   实测（26 次投放那组）：只有 1/14 睡着、静置 60 步总位移 76px；
     *   把门槛提到 2.0 后同一球堆：14/14 睡着、位移 0、最大穿透仍只有 1.6px。
     * 2px 落在贴图的黑描边之内、肉眼不可见；而"2px 以上解不开的重叠"才是这层要管的事。
     * 证据：tools/_phys_audit.py（8 配置对照）；详见 交接文档.md 的 v1.10 段。 */
    sepMinPenetration: 2.0,   // 小于这个重叠量视为正常接触，不动
    // 渲染插值：物理固定 60Hz，屏幕可能是 120Hz。开启后按"当前处于两个物理
    // 步之间的比例"插值绘制，高刷屏上明显更丝滑；关掉就退化成直接画物理位置。
    interpolate: true,
    // 兜底：每步检查球是否跑出场地，跑出去的贴回墙面（正常游玩不会触发）
    contain: true,
    /* ★ 2026-10-12 审计加的兜底：每 N 步扫一次"悬空还睡着"的球并叫醒它。
     * 为什么需要：休眠的球不受重力，"失去支撑"又不是碰撞事件；主路径
     * （合成删球 → removeBall 里唤醒）已经堵了，但极端堆型仍会漏出极少数
     * （审计实测：44 次快速投放在某些堆型下会剩 1 颗，根因未完全定位）。
     * 这层兜底与触发路径无关，误报代价极低（只让球晚 0.75 秒再睡）。 */
    rescueFloat: true,
    rescueFloatSteps: 30,     // 每 30 步（0.5 秒）扫一次；球数 ≤40，开销可忽略
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

  /* -------- 开始界面（标题画面）--------
   * 全部是设计分辨率（720×1280）的逻辑像素；配色沿用 G.THEME.colors，
   * 所以和游戏内是同一套色（金 + 骨白 + 血红 + 近黑底）。
   * 想改按钮大小 / 位置 / 延迟，只改这里。
   * -------------------------------------------------- */
  G.TITLE = {
    bgmDelay: 0.5,        // 点"开始游戏"后，等多少秒再起 BGM（用户要求 0.5）
    bgDim: 0.58,          // 标题画面在背景图之上再压暗多少（字才立得住）
    titleY: 424,          // 主标题基线
    titleMaxW: 610,       // 主标题最大宽度（不同手机字体宽度不同，超出就自动缩小字号）
    subGap: 64,           // 副标题在主标题下方多少像素
    ruleY: 538,           // 装饰分隔线（两条金线 + 菱形）的 y
    /* "开始游戏"按钮：血红底 + 角饰/血滴花纹（比胶囊按钮大得多）。
     * 2026-10-11 用户要求：改血红色、加花纹、文字换惊悚一点的字体；
     * 同一轮把开始界面上**所有小字说明**（按钮下提示 / 最高分 / 底部操作说明）都去掉了。 */
    button: { w: 420, h: 118, y: 752, radius: 16 },
    startLabel: '开始游戏',          // 按钮文字（逐字排开画，见 render.js 的 _drawTitle）
    /* 按钮字体：**草书**（网页字体，@font-face 定义在 web/index.html）
     * → 华文行楷 → 华文隶书 → 隶书 → 楷体 → 系统衬线。
     * 草书字体只裁了 11 个字（7.5KB），**改按钮文字要重新裁剪**，见交接文档。 */
    labelFont: 'BSLabel, STXingkai, STLiti, LiSu, KaiTi, serif',
    /* ---- 版本切换胶囊（2026-10-16 用户测试版）----
     * 用户反馈：原来太小、配色不好看 → 尺寸放大一圈；
     * **纯白打底、无渐变、50% 不透明、文字纯红**。
     * 想还原旧外观：把 chip 整段删掉即可（render.js 里都有默认值兜底）。
     * ⚠️ 这套样式现在**同时作用于**"正常版 / 地狱版"和游戏内右上角的"返回"。 */
    chip: {
      x: 20, y: 86, w: 96, h: 34, gap: 6,   // 原先是 w=76 h=26（字号 15）
      fontPx: 18, radius: 8,
      bg: 'rgba(255,255,255,.5)',           // 纯白打底 50%（无渐变）
      text: '#ff0000',                      // 文字：纯红
      activeBorder: '#ff0000', activeBorderW: 2,
      idleBorder: 'rgba(120,120,120,.55)', idleBorderW: 1
    },
    /* 标题上方那束金色烛光（标题上方的黄色发光）：0 = 关掉。
     * 2026-10-16 用户想试试去掉的效果，所以先关；想恢复填 0.14。 */
    topGlowAlpha: 0,
    /* "开始游戏"按钮那圈**随呼吸的红外发光**：0 = 关掉（渐变底保留，不受影响）。
     * 2026-10-16 用户要求："开始游戏"把发光去掉、但不要动渐变。 */
    buttonGlow: 0
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
      /* merge[i] = 合成时播的声音。**下标语义见下（2026-10-11 实测确认，别凭直觉改）**：
       *   两颗 T 阶球合成 → 新球是 (T+1) 阶，音效取 assets.merge[T]
       *   也就是 **合成出第 N 阶（1 起）→ 播下标 N-2**
       *     · 合成出第 2 阶        → 下标 0（merge1.wav）
       *     · 合成出第 8 阶（爱丽丝）→ 下标 6（**merge7.mp3**）
       *     · 下标 7（merge8.wav）  = 合成出第 9 阶，**永远达不到**（`_tryMerge` 里"满级不再合成"）
       * 这个映射有回归测试 + `tools/_audio_probe.py` 双重钉住。 */
      merge: [
        'assets/audio/merge1.mp3',   // ← 古兹（第 2 阶）：用户提供，源严重过载(+5.71dBTP)已归一 -12.64dB
        'assets/audio/merge2.mp3',   // ← 维多利亚（第 3 阶）：用户提供（压缩提升）
        'assets/audio/merge3.mp3',   // ← 伊丽莎白（第 4 阶）：原作 SE《どりんくみー》+ 峰值归一 +11.3dB
        'assets/audio/merge4.mp3',   // ← 多萝茜（第 5 阶）：原作 SE《Barrier》
        'assets/audio/merge5.mp3',   // ← 蕾克（第 6 阶）：用户提供 + 音量提升（+6dB 限幅）
        'assets/audio/merge6.mp3',   // ← 库嘻嘻（第 7 阶）：原作 SE《Flash1》
        'assets/audio/merge7.mp3',   // ← 原作 ME《Fanfare3》：合成出爱丽丝
        'assets/audio/merge8.wav'    // 达不到的第 9 阶，占位
      ],
      // 失败音效：原作 VOICE《主人公死ぬ》（2026-10-11 换掉占位音）
      over: 'assets/audio/gameover.mp3',
      ui: 'assets/audio/ui.wav',
      /* —— 背景音乐：按命名版本各一首 ——
       * 2026-10-11 起从"实时合成和弦垫"改成放真实音乐文件（用户提供的原作曲目）。
       * 某项留空字符串 = 那个版本没有 BGM 文件，会退回 audio-web.js 的实时合成。
       * ⚠️ 这两个是 **.ogg**：Chrome / Edge / Firefox / 安卓 都能放，
       *    但 **iOS Safari 和微信 iOS 不支持 ogg**，那边会自动退回实时合成的和弦垫。
       *    以后要上微信端，必须转成 .m4a / .mp3（小游戏包体上限 4MB，这两首共 3MB，也要压）。 */
      bgm: {
        normal: 'assets/audio/bgm_normal.mp3',   // 不思議の国 · 2026-10-11 转成真 MP3（iOS 能放了）
        hell: 'assets/audio/bgm_hell.mp3'        // 時計塔 · 2026-10-11 转成真 MP3（iOS 能放了）
      },
      bgmVolume: 0.32         // BGM 音量（0~1）；实时合成那套的音量另在 audio-web.js 里
    }
  };

  /* 当前命名版本该放哪首 BGM（该版本没配就回退到正常版那首） */
  G.bgmPathFor = function (version) {
    var m = (G.ASSETS.audio && G.ASSETS.audio.bgm) || {};
    var v = version || G.nameVersion;
    return m[v] || m[G.NAME_VERSION_DEFAULT] || '';
  };

  /* 某个角色（**0 起的阶索引**）该用哪个音效名（'merge0'…）。
   * 和"合成音下标差一位"是同一条映射：合成出第 N 阶(1 起) 播 merge[N-2]，
   * 所以 0 起的第 t 阶角色 → 'merge' + (t-1)。
   * 第 1 阶（艾露玛，t=0）不会作为合成结果出现、没有专属音效 → 返回 ''（调用方回退通用投放音）。 */
  G.characterSoundName = function (tier) {
    if (!(tier >= 1)) return '';
    var idx = tier - 1;
    return idx < G.ASSETS.audio.merge.length ? 'merge' + idx : '';
  };

  /* -------- 角色与美术配置 --------
   * radius: 逻辑像素半径（尺寸曲线，想调手感就改这里）
   * color : 占位球颜色；贴图加载成功后不再使用
   * name  : **留空**，实际显示名来自下面的 G.NAME_SETS（两套命名版本）
   * ------------------------------------------------------------------ */
  G.THEME = {
    title: '合成爱丽丝',      // 游戏标题（2026-10-11 用户要求由 'BLACK SOULS' 改）
    subtitle: '',            // 留空 = 不画副标题（"合成"已经含在标题里了）
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
    /* 尺寸历史（别搞混，改这里就等于改球的实际大小和手感）：
     *   原本是 27/37/50/64/80/99/120/145，那时贴图按「半径 ×1.22」画（ballArtScale=1.22），
     *   所以屏幕上的球比碰撞体大 22%。
     *   后来 ballArtScale 改成 1.0（贴图边缘 = 碰撞边缘，不再"陷进去"），球在屏幕上就小了 22%。
     *   2026-10-11：为了把屏幕上的大小还原，把这 8 个半径整组 ×1.22。
     *   现在 ballArtScale=1.0 → **贴图多大完全由这里的 radius 决定**。
     *   ★ 2026-10-12：碰撞半径另外再 × `G.PHYSICS.collisionScale`（数值见文件顶部那个系数，别在这里写死），
     *     即"碰撞略小于贴图"。**想调碰撞手感请改那个系数，不要改这里的 radius**（否则贴图跟着变）。 */
    tiers: [
      { name: '', color: '#8e2b32', radius: 33 },   // 27  ×1.22
      { name: '', color: '#b8763a', radius: 45 },   // 37  ×1.22
      { name: '', color: '#d8b45a', radius: 61 },   // 50  ×1.22
      { name: '', color: '#6f8f4a', radius: 78 },   // 64  ×1.22
      { name: '', color: '#3f7d8c', radius: 98 },   // 80  ×1.22
      { name: '', color: '#7d4a8f', radius: 121 },  // 99  ×1.22
      { name: '', color: '#b03a2e', radius: 146 },  // 120 ×1.22
      { name: '', color: '#c9a227', radius: 177 }   // 145 ×1.22
    ]
  };

  /* -------- 角色名：两套命名版本，游戏里可以切换 --------
   * 每套 8 个名字，顺序和上面的 tiers 一一对应（第 1 个 = 最小阶）。
   * 想改名就改这里；想加第三套，照着复制一段、再加进 versionOrder 即可。
   * ------------------------------------------------------ */
  G.NAME_SETS = {
    normal: {
      label: '正常版',
      names: ['艾露玛', '古兹', '维多利亚', '伊丽莎白', '多萝茜', '蕾克', '库嘻嘻', '爱丽丝']
    },
    hell: {
      label: '地狱版',
      names: ['吊死鬼', '手撕鸡', '禁止掉头', '褒姒', '肚包肉', '永远二十', '库嘻嘻', '爱丽丝']
    }
  };

  /* -------- 球体贴图：也按命名版本分开 --------
   * 现在两套版本**共用同一批图**（都指向 G.ASSETS.tiers），
   * 以后想给某个版本单独出图，只要：
   *   1) 把图放到 web/assets/tiers-hell/tier1.png …
   *   2) 在下面的 variants 里加一段，或者改掉 hell 的 dir
   * 不用改任何绘制代码。
   * ------------------------------------------------ */
  G.TEXTURE_VARIANTS = {
    default: { dir: 'assets/tiers' },                    // 默认那套
    hell: { dir: 'assets/tiers-hell' }                   // 地狱版专属（目录不存在就自动回退到 default）
  };
  G.textureVariantOf = { default: 'normal', hell: 'hell' };   // 命名版本 -> 贴图版本
  G.TEXTURE_VARIANT_FALLBACK = 'default';

  /* 当前用哪套贴图（跟着命名版本走） */
  G.textureVariantName = function () {
    var v = G.textureVariantOf[G.nameVersion];
    return G.TEXTURE_VARIANTS[v] ? v : G.TEXTURE_VARIANT_FALLBACK;
  };

  /* 某阶贴图该用哪个路径：先找当前贴图版本，没有就回退到默认那套 */
  G.texturePathFor = function (tier) {
    var v = G.textureVariantName();
    var spec = G.TEXTURE_VARIANTS[v];
    if (spec && spec.dir) return spec.dir + '/tier' + (tier + 1) + '.png';
    return G.ASSETS.tiers[tier];
  };

  /* 某阶贴图的**完整候选路径**（按优先级，加载失败的依次往下试）：
   *   1) 当前贴图版本自己的目录（地狱版 = assets/tiers-hell/）
   *   2) 默认那套目录（assets/tiers/）
   * 这样某个版本还没出图时，玩家看到的是**共用贴图**，而不是代码画的占位球。
   * ★ 2026-10-11 修：以前只有 1)，而 2) 只写在注释里、代码根本没实现，
   *   导致切到地狱版后 8 张图全部 404、退回占位球。
   * ★ 这条链**两个加载器都要走**：web/main.js 的预加载 + render.js 的懒加载
   *   （切换版本时不重新预加载，只有懒加载会跑）。 */
  G.texturePathCandidatesFor = function (v, tier) {
    var out = [];
    var spec = G.TEXTURE_VARIANTS[v];
    var def = G.TEXTURE_VARIANTS[G.TEXTURE_VARIANT_FALLBACK];
    if (spec && spec.dir) out.push(spec.dir + '/tier' + (tier + 1) + '.png');
    if (def && def.dir) {
      var p = def.dir + '/tier' + (tier + 1) + '.png';
      if (out.indexOf(p) < 0) out.push(p);
    }
    if (G.ASSETS.tiers[tier] && out.indexOf(G.ASSETS.tiers[tier]) < 0) {
      out.push(G.ASSETS.tiers[tier]);
    }
    return out;
  };

  /* 同上，但**显式指定贴图版本**（不读当前版本）。
   * ★ 2026-10-11 加：云端第一次访问时切版本会先看到占位球，原因是懒加载那时才开始下载。
   *   render.js 的 preloadVariant() 用这个函数提前把**另一个版本**也下下来。 */
  G.texturePathCandidates = function (tier) {
    return G.texturePathCandidatesFor(G.textureVariantName(), tier);
  };

  /* 界面上的排列顺序 + 默认选中哪个（用户要求默认"正常版"） */
  G.NAME_VERSION_ORDER = ['normal', 'hell'];
  G.NAME_VERSION_DEFAULT = 'normal';
  G.NAME_VERSION_KEY = 'bs_suika_names';   // 存档键名

  /* 当前生效的版本。运行时会被游戏改成用户选的那个。 */
  G.nameVersion = G.NAME_VERSION_DEFAULT;

  /* 取某阶的角色名（**始终取当前版本**，所以切换后自动生效） */
  G.tierName = function (tier) {
    var set = G.NAME_SETS[G.nameVersion] || G.NAME_SETS[G.NAME_VERSION_DEFAULT];
    return (set && set.names[tier]) || G.THEME.tiers[tier].name || '';
  };

  /* 切换版本，返回是否切换成功 */
  G.setNameVersion = function (key) {
    if (!G.NAME_SETS[key]) return false;
    G.nameVersion = key;
    return true;
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

  /* -------- 成就系统（2026-10-11 新增）--------
   * 每条：id（唯一，存档用它）/ name / desc / test(stats) / prog(stats)（可选，面板进度）
   * · 角色类成就的文案里用 {0}~{7} 占位，显示时按**当前命名版本**替换
   *   （正常版叫"古兹"，地狱版叫"手撕鸡"）。
   * · stats 的字段见 shared/achievements.js 的 blankStats()。
   * -------------------------------------------- */
  G.achvNames = function () {
    var set = G.NAME_SETS[G.nameVersion] || G.NAME_SETS[G.NAME_VERSION_DEFAULT];
    return (set && set.names) || [];
  };

  /* 把文案里的 {0}~{7} 换成角色名。
   * version 省略时用当前命名版本；成就自带 ver（如地狱版专属成就）就传它 ——
   * 这样地狱版成就的文案永远用**地狱版**角色名，不受当前版本影响。
   * 另外 G.ACHV_CHAR_NAMES 能覆盖**成就文案里**的角色名（游戏里不变）。 */
  G.achvFill = function (text, version) {
    var key = version || G.nameVersion;
    var set = G.NAME_SETS[key] || G.NAME_SETS[G.NAME_VERSION_DEFAULT];
    var names = (set && set.names) || [];
    /* 覆盖表支持两种写法：按版本分 {normal:{6:'x'}, hell:{6:'y'}} 或全局扁平 {6:'x'} */
    var ovAll = G.ACHV_CHAR_NAMES || {};
    var ov = ovAll[key] || ovAll[G.NAME_VERSION_DEFAULT] || ovAll;
    return String(text).replace(/\{(\d)\}/g, function (m, d) {
      var i = parseInt(d, 10);
      if (ov && typeof ov[i] === 'string') return ov[i];
      var n = names[i];
      return n == null ? m : n;
    });
  };

  /* 成就文案里的角色名覆盖 —— **按命名版本分开**（用户 2026-10-11 要求）：
   *   · 正常版成就里，第 6 阶叫"莉耶芙"
   *   · 地狱版成就里，第 6 阶叫"玛丽苏"
   * （游戏里的角色名不受影响，改的是 NAME_SETS） */
  G.ACHV_CHAR_NAMES = {
    normal: { 6: '莉耶芙' },
    hell: { 6: '玛丽苏' }
  };

  /* 角色类成就的名字覆盖（用户指定；没列到的用默认"合成出{角色名}"）。
   * ⚠️ 键是**0 起的阶索引**：1=古兹 2=维多利亚 3=伊丽莎白 4=多萝茜 5=蕾克 6=库嘻嘻 7=爱丽丝。
   * ⚠️ 必须定义在 G.ACHIEVEMENTS **之前**：下面那个 IIFE 会立刻读它。 */
  G.ACHV_TIER_NAMES = {
    1: '下金蛋的鸟',
    2: '皇家红茶',
    3: '魂之贵夫人',
    4: '教师节快乐',
    5: '怨头帽耋',
    6: '腹击',
    7: '爱丽丝爱丽丝爱丽丝爱丽丝爱丽丝&&*……%#@！#￥*'
  };

  /* 每条角色成就用哪个图标（画法见 render.js 的 _achvIcon）。
   * 目前支持：eye / egg / cup / apple / skull / key。回归测试会检查别写错。 */
  G.ACHV_ICONS = ['eye', 'egg', 'cup', 'apple', 'skull', 'key'];
  G.ACHV_TIER_ICONS = { 1: 'egg', 2: 'cup', 3: 'eye', 4: 'apple', 5: 'skull', 6: 'key', 7: 'key' };

  /* 「**一局内**合成出 N 个某角色」这一系列（2026-10-11 用户改版：
   * 原来跨局累计 → 现在**单局内**计数；并且**按命名版本分流**）：
   *   · 门槛（键=0 起的阶索引，越高阶越难合所以递减）
   *   · 名字（用户指定）
   *   · ⚠️ 正常版一套（`cum_N`）+ 地狱版一套（`hell_cum_N`），各算各的、互不解锁 */
  G.ACHV_CUM_THRESHOLDS = { 1: 40, 2: 25, 3: 20, 4: 15, 5: 12, 6: 7, 7: 5 };
  G.ACHV_CUM_NAMES = {
    1: '子孙满堂',
    2: '国王来了',
    3: 'AAAAA戒指批发',
    4: '三人行必有我师',
    5: '我砍我砍我砍',
    6: '莉耶芙还是玛丽苏还是玛丽安！？',
    7: '蠕动潜行而来'
  };
  /* 地狱版那套 —— 用户说名字稍后给，先用**占位名**（给名字就替换这里） */
  G.ACHV_HELL_CUM_NAMES = {
    1: 'kfc全家桶', 2: 'AAAAA杯子批发', 3: '释然了', 4: '触手养殖场',
    5: '至少加起来远超常人寿命不是吗？', 6: '库嘻嘻', 7: '蠕动潜行而来'
  };
  /* 地狱版的"第一次合成出第 N 阶"（镜像正常版那 7 条）—— 用户 2026-10-11 给定，低阶→高阶 */
  G.ACHV_HELL_TIER_NAMES = {
    1: '吮指原味鸡',
    2: '杯子',
    3: 'zxf老师',
    4: '肚包肉在地上',
    5: '永葆青春',
    6: '库嘻嘻',
    7: '%…*%@￥%……@'
  };

  G.ACHIEVEMENTS = (function () {
    var tierList = [];
    /* 角色类：合成出第 2~8 阶各一条（第 1 阶不会作为合成结果出现） */
    for (var t = 1; t < 8; t++) {
      (function (idx) {
        var icon = G.ACHV_TIER_ICONS[idx] || 'eye';
        var cumN = G.ACHV_CUM_THRESHOLDS[idx];
        /* ① 第一次合成出这个角色 —— **只有正常版能拿**（数据也用正常版专用的）
         *    地狱版有自己的一条（下面 ①'），名字待用户给 */
        tierList.push({
          id: 'tier_' + idx,
          ver: 'normal',
          name: G.ACHV_TIER_NAMES[idx] || ('合成出{' + idx + '}'),
          desc: '把两个{' + (idx - 1) + '}合成在一起',
          icon: icon,
          test: function (s) { return s.tierMergesNormal[idx] >= 1; }
        });
        /* ①' 地狱版对应的那条（同一图标，说明用地狱版角色名） */
        tierList.push({
          id: 'hell_tier_' + idx,
          ver: 'hell',
          name: G.ACHV_HELL_TIER_NAMES[idx] || ('（地狱·待命名·首合' + idx + '阶）'),
          desc: '在地狱版第一次合成出{' + idx + '}',
          icon: icon,
          test: function (s) { return s.tierMergesHell[idx] >= 1; }
        });
        /* ② 一局内合成出 N 个（**只在正常版能拿**） */
        if (cumN) {
          tierList.push({
            id: 'cum_' + idx,
            ver: 'normal',
            name: G.ACHV_CUM_NAMES[idx] || ('量产{' + idx + '}'),
            desc: '一局内合成出 ' + cumN + ' 个{' + idx + '}',
            icon: icon,
            test: function (s) { return s.gameTierNormal[idx] >= cumN; },
            prog: function (s) { return Math.min(s.gameTierNormal[idx], cumN) + '/' + cumN; }
          });
          /* ③ 地狱版专属的同类成就（名字待用户给，先用占位；数据也各算各的） */
          tierList.push({
            id: 'hell_cum_' + idx,
            ver: 'hell',
            name: G.ACHV_HELL_CUM_NAMES[idx] || ('（地狱·待命名' + idx + '阶）'),
            desc: '一局内合成出 ' + cumN + ' 个{' + idx + '}',
            icon: icon,
            test: function (s) { return s.gameTierHell[idx] >= cumN; },
            prog: function (s) { return Math.min(s.gameTierHell[idx], cumN) + '/' + cumN; }
          });
        }
      })(t);
    }
    var mile = [
      /* 「初次合成」：**只有正常版能拿**（用户 2026-10-11 要求）。
       * ★ 2026-10-11 用户又说"地狱版初次合成这个成就可以不要了" → 地狱版那条已删除；
       *   地狱版仍有自己的 7 条"第一次合成出各阶" + 7 条"一局内合成 N 个"，不缺内容。 */
      { id: 'first_merge', name: '初次合成', desc: '完成第一次合成', icon: 'eye', ver: 'normal',
        test: function (s) { return s.merges >= 1; } },
      { id: 'first_game', name: '第一局', desc: '玩完一局（无论输赢）', icon: 'key',
        test: function (s) { return s.games >= 1; } },
      { id: 'combo3', name: '连锁反应', desc: '一次连击达到 3 连', icon: 'skull',
        test: function (s) { return s.maxCombo >= 3; },
        prog: function (s) { return Math.min(s.maxCombo, 3) + '/3'; } },
      { id: 'combo6', name: '停不下来', desc: '一次连击达到 6 连', icon: 'skull',
        test: function (s) { return s.maxCombo >= 6; },
        prog: function (s) { return Math.min(s.maxCombo, 6) + '/6'; } },
      { id: 'score1000', name: '千分达成', desc: '单局拿到 1000 分', icon: 'cup',
        test: function (s) { return s.best >= 1000; },
        prog: function (s) { return Math.min(s.best, 1000) + '/1000'; } },
      { id: 'score5000', name: '五千分', desc: '单局拿到 5000 分', icon: 'skull',
        test: function (s) { return s.best >= 5000; },
        prog: function (s) { return Math.min(s.best, 5000) + '/5000'; } },
      { id: 'drops100', name: '手熟', desc: '累计投放 100 次', icon: 'egg',
        test: function (s) { return s.drops >= 100; },
        prog: function (s) { return Math.min(s.drops, 100) + '/100'; } },
      { id: 'merges100', name: '熟能生巧', desc: '累计合成 100 次', icon: 'egg',
        test: function (s) { return s.merges >= 100; },
        prog: function (s) { return Math.min(s.merges, 100) + '/100'; } },
      { id: 'games10', name: '常客', desc: '累计游玩 10 局', icon: 'apple',
        test: function (s) { return s.games >= 10; },
        prog: function (s) { return Math.min(s.games, 10) + '/10'; } },
      { id: 'alice5', name: '收藏家', desc: '累计合成出 5 次最高阶角色', icon: 'key',
        test: function (s) { return s.aliceCount >= 5; },
        prog: function (s) { return Math.min(s.aliceCount, 5) + '/5'; } },
      /* 2026-10-11 追加：用上"命名版本"和"单局收集"两条数据 */
      { id: 'hell_world', name: '另一个世界', desc: '在地狱版玩一局', icon: 'skull',
        test: function (s) { return s.hellGames >= 1; } },
      { id: 'all_tiers', name: '全图鉴', desc: '单局内把 7 个角色都合出来一次', icon: 'key',
        test: function (s) { return s.allTiersInOneGame >= 1; } }
    ];
    /* 顺序：初次合成 → 角色一路合成上去 → 里程碑 */
    return [mile[0]].concat(tierList, mile.slice(1));
  })();

  /* 成就系统的配色：**惨白为主 + 一点血红**，参考背景里的狮子/独角兽/骷髅 */
  G.ACHV_COLORS = {
    bone: '#e6dfc8',                          // 惨白（骨白）
    boneBright: '#f4eeda',
    boneDim: 'rgba(214,206,182,.32)',
    blood: '#95202a',                         // 暗红
    bloodBright: '#c2402f',
    rowOn: 'rgba(146,32,42,.20)',             // 已解锁行底（带血色）
    rowOff: 'rgba(0,0,0,.42)',
    borderOn: 'rgba(230,223,200,.70)',
    borderOff: 'rgba(170,162,140,.24)'
  };

  /* 成就面板的排版参数 */
  G.ACHV_UI = {
    panelW: 640, top: 150, bottom: 130,
    rowH: 64, rowGap: 8,
    icon: 30,             // 图标直径（逻辑像素）
    scrollStep: 1,        // 手指移动 1px = 列表滚 1px（直接拖动的手感）
    toastMs: 3.4,         // 解锁提示条停留秒数
    /* 开始界面入口：长宽比不变、面积约原来的 2 倍（168×40 → 238×57），位置挪到
     * "开始游戏"按钮正下方（按钮 y 752~870，取 900 留 30px 间距） */
    entryW: 238, entryH: 57, entryY: 900
  };

  /* 合成时的"角色喊话"字幕样式。
   * ★ 2026-10-11 用户要求：**地狱版**字幕 = **红字 + 白色描边**（不加深色底板！），
   *   字体用**行书**（志莽行书，比草书好认）；正常版保持原来的金色字。
   *   ⚠️ BSRun / BSLabel 都是网页里嵌入的子集字体（见 index.html 的 @font-face），
   *      子集里必须包含所有角色名用字，否则会回退成系统字体（见交接文档"草书字体"一节）。 */
  G.BANNER = {
    t: 1.3,                                        // 停留秒数
    y: 0.34,                                       // 纵向位置（屏幕高度比例）
    /* 2026-10-11 用户反馈"字号有些小" → 地狱版 46 → 58px，正常版 40 → 50px，描边同步加粗 */
    hellFont: '700 58px BSRun, STXingkai, STLiti, KaiTi, serif',
    hellFill: '#d5322c',                           // 字的颜色：红
    hellStroke: '#f6f1e2',                         // 边缘：白色描边
    hellStrokeW: 8,
    normalFont: '700 50px ' + G.THEME.fontFamily   // 正常版维持金色字，只调大字号
  };

  G.derive();
})(typeof window !== 'undefined' ? window : this);
