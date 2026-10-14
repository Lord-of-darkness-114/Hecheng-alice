# 合成爱丽丝 · Android APK

> ⚠️ **APK 不上传、不发布**（用户 2026-10-14 明确要求）：只留在这台机器本地。
> 仓库里只放**源码**（外壳 Java、打包脚本、图标），`*.apk` 已被 `.gitignore` 排除；
> 备份快照里也不含 APK（它是可再生的，`python build_apk.py` 20 秒就能重打）。

把网页版游戏包成的一个**离线 Android App**（WebView 外壳 + 游戏本体打进 assets）。

| | |
| --- | --- |
| 产物 | `合成爱丽丝.apk`（约 6.6 MB） |
| 包名 / 版本 | `com.bs.suika` / 1.0（versionCode 1） |
| 系统要求 | Android 5.0+（minSdk 21），targetSdk 34 |
| 权限 | **一个都不要**（完全离线，不联网） |
| 签名 | 自签名（`keystore.jks`，口令 `bssuika`，写在 `build_apk.py` 里） |

## 怎么装到手机

1. 把 `合成爱丽丝.apk` 传到手机（微信/QQ 传文件、数据线、网盘都行）
2. 手机上点开这个 apk → 系统会提示"**未知来源**"，允许一次即可
   （小米/华为/OPPO 等会弹"安全提示"，选"继续安装"；安装完可以在设置里把权限关回去）
3. 装好后桌面会出现图标（深色圆底 + 血光 + 爱丽丝球）

> 微信里直接点 apk 可能会被拦，建议**用文件管理器打开**，或者传到手机后再点。

## 操作

- 全屏竖屏，和网页版完全一样
- **返回键**：局内先回开始界面；已经在开始界面才退出 App
- 存档（成就进度）存在 WebView 的 localStorage 里，卸载 App 会一起清掉

## 改了游戏怎么重新打包

```powershell
cd C:\Users\HP\Documents\deepseek-harness\default-workspace\blacksouls-suika
python tools\make_publish.py          # 1) 生成 publish/（网页版摊平后的样子）
cd ..\android-build
python build_apk.py                   # 2) 重新打包（会自动同步 publish → assets/www）
```

- **务必保留 `keystore.jks`**：换签名的话，手机上必须先卸载旧版才能装新版。
- 改了 `app/res` 里的图标就重跑一次 `python make_icon.py`。
- 改了 Java 代码（`app/src/.../MainActivity.java`）直接重跑 `build_apk.py` 即可。

## 这套构建是怎么搭起来的（换机器时看这里）

本机原先**没有任何 Android 工具链**，而且 `maven.google.com` 不通 → **不能用 Gradle**。
所以走的是官方命令行工具的手工流水线（`aapt2` / `javac` / `d8` / `zipalign` / `apksigner`）。

```
android-build\
  setup_toolchain.ps1   ← 一键下载并安装 JDK + Android SDK（约 440MB，走国内镜像，1~2 分钟）
  jdk\                  ← Temurin/华为云 OpenJDK 17（javac / keytool / java）
  sdk\                  ← Android cmdline-tools + platform-34 + build-tools-34
  app\
    AndroidManifest.xml ← 应用声明（竖屏、全屏主题、无权限）
    src\com\bs\suika\MainActivity.java  ← WebView 外壳（约 150 行）
    res\mipmap-*\        ← 图标（由 make_icon.py 用球体贴图生成）
    assets\www\          ← 游戏本体（build_apk.py 从 publish/ 同步过来）
  make_icon.py          ← 生成图标
  build_apk.py          ← 打包 + 签名（入口）
  合成爱丽丝.apk         ← 产物
```

`MainActivity` 做的几件事（都是踩过的坑）：

| 设置 | 为什么 |
| --- | --- |
| `setDomStorageEnabled(true)` | 成就存在 localStorage |
| `setAllowFileAccessFromFileURLs(true)` | file:// 下默认禁止读同源文件，**字体(@font-face)会加载失败** |
| `setMediaPlaybackRequiresUserGesture(false)` | 否则开局的 BGM 会被浏览器策略拦掉 |
| `FLAG_KEEP_SCREEN_ON` | 玩的时候别熄屏 |
| 沉浸式全屏 + `screenOrientation="portrait"` | 游戏是 720×1280 竖屏 |
| `KEYCODE_BACK` → 局内 `backToTitle()`，否则 `finish()` | 返回键符合直觉 |

打包脚本里的两个坑（注释里也写了）：

1. `javac` 在 JDK 17 下 `-bootclasspath` 已失效 → android.jar 要放 `-classpath`，
   并且用 `-source/-target 8` 让 class 版本是 52（d8 接受的范围）。
2. **Android 11+ 要求 `resources.arsc` 未压缩且 4 字节对齐**，否则拒绝安装 →
   塞完 `classes.dex` 后显式把它重写成"存储"，再 `zipalign -p 4`。

## 已验证 / 待你在手机上确认

已验证（在本机）：
- `aapt2 dump badging`：包名、版本、标签「合成爱丽丝」、图标、minSdk 21 / targetSdk 34 ✅
- `apksigner verify`：v1+v2 签名有效 ✅
- APK 内含 `classes.dex`（魔数正确）、`resources.arsc` 未压缩、38 个游戏文件 ✅
- **用 `file://` 协议（和 App 内完全一致的加载方式）跑游戏内置回归 → 79/79 通过** ✅
  且没有任何 `ERR_`/`Failed to load`（字体、音频、配置都能加载）✅

待你确认（只能真机测）：
- 声音能否正常播放（WebView 的音频策略各机型略有差异）
- 成就进度在**关掉 App 再打开**后是否还在（file:// 源的 localStorage 持久性）
  → 如果发现进度不保留，告诉我，我改成"用拦截器把资源挂在 https 假域名下"的方式（约 20 行）
