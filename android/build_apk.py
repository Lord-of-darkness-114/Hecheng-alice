"""合成爱丽丝 → APK（不用 Gradle：aapt2 + javac + d8 + zipalign + apksigner）

为什么不用 Gradle：这台机器连不上 maven.google.com（AGP 插件源），
而上面这几个工具都在 SDK 的 build-tools / platform 里，从 dl.google.com 就能拿到。

流水线：
  1. publish/（网页版摊平后的文件）→ app/assets/www
  2. aapt2 compile  编译资源（图标）
  3. aapt2 link     生成 base.apk（含 assets，但还没有代码）
  4. javac + d8     编译 Java → classes.dex
  5. 把 classes.dex 塞进 apk；并确保 resources.arsc 是"未压缩"（Android 11+ 硬性要求）
  6. zipalign 4     对齐（必须在签名之前）
  7. apksigner      签名（keystore 首次自动生成；之后复用，保证能覆盖安装）

用法：
    python build_apk.py

★ 改了网页版之后：先跑 blacksouls-suika/tools/make_publish.py，再跑本脚本。
"""
import glob
import os
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)            # ...\blacksouls-suika
PUB = os.path.join(GAME, 'publish')
APP = os.path.join(HERE, 'app')
BUILD = os.path.join(HERE, 'build')
WORKSPACE = os.path.dirname(GAME)       # ...\default-workspace
TOOLCHAIN = os.path.join(WORKSPACE, 'android-build')   # JDK/SDK 这类大件放仓库外面
SDK = os.path.join(TOOLCHAIN, 'sdk')
OUT = os.path.join(HERE, '合成爱丽丝.apk')
KEYSTORE = os.path.join(HERE, 'keystore.jks')
KS_PASS = 'bssuika'          # 自用签名口令；换机器重建要沿用同一个 keystore 才能覆盖安装


def die(msg, out=''):
    print('\n❌ ' + msg)
    if out:
        print(out[-3000:])
    sys.exit(1)


def run(cmd, quiet=False):
    if not quiet:
        print('  $ ' + ' '.join(os.path.basename(c) if i == 0 else c
                                for i, c in enumerate(cmd)))
    p = subprocess.run(cmd, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if p.returncode != 0:
        die('命令失败: ' + ' '.join(cmd[:3]), (p.stdout or '') + '\n' + (p.stderr or ''))
    return (p.stdout or '') + (p.stderr or '')


def newest(pattern):
    hits = sorted(glob.glob(pattern))
    return hits[-1] if hits else None


def main():
    print('=== 0/7 检查工具链 ===')
    jdk = newest(os.path.join(TOOLCHAIN, 'jdk', '*'))
    bt = newest(os.path.join(SDK, 'build-tools', '*'))
    plat = newest(os.path.join(SDK, 'platforms', '*'))
    tools = {
        'jdk': jdk,
        'build-tools': bt,
        'platform': plat,
    }
    for k, v in tools.items():
        if not v:
            die('缺少 %s（先跑 setup_toolchain 那一步）' % k)
    android_jar = os.path.join(plat, 'android.jar')
    exe = {
        'aapt2': os.path.join(bt, 'aapt2.exe'),
        'd8': os.path.join(bt, 'd8.bat'),
        'zipalign': os.path.join(bt, 'zipalign.exe'),
        'apksigner': os.path.join(bt, 'apksigner.bat'),
        'javac': os.path.join(jdk, 'bin', 'javac.exe'),
        'keytool': os.path.join(jdk, 'bin', 'keytool.exe'),
    }
    for k, v in exe.items():
        if not os.path.exists(v):
            die('缺少 %s：%s' % (k, v))
    env = dict(os.environ)
    env['JAVA_HOME'] = jdk
    env['PATH'] = os.path.join(jdk, 'bin') + os.pathsep + env.get('PATH', '')
    print('  jdk=%s' % os.path.basename(jdk))
    print('  build-tools=%s  platform=%s' % (os.path.basename(bt), os.path.basename(plat)))

    def run2(cmd, quiet=False):
        p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                           errors='replace', env=env)
        if not quiet:
            print('  $ ' + os.path.basename(cmd[0]) + ' ' + ' '.join(cmd[1:3]))
        if p.returncode != 0:
            die('命令失败: ' + os.path.basename(cmd[0]),
                (p.stdout or '') + '\n' + (p.stderr or ''))
        return (p.stdout or '') + (p.stderr or '')

    print('=== 1/7 同步游戏本体（publish → app/assets/www）===')
    if not os.path.isdir(PUB):
        die('找不到 %s（先在游戏目录跑 tools/make_publish.py）' % PUB)
    www = os.path.join(APP, 'assets', 'www')
    if os.path.isdir(www):
        shutil.rmtree(www)
    shutil.copytree(PUB, www)
    total = sum(os.path.getsize(os.path.join(r, f))
                for r, _, fs in os.walk(www) for f in fs)
    print('  资源 %.2f MB' % (total / 1024.0 / 1024.0))

    print('=== 2/7 aapt2 compile（资源）===')
    if os.path.isdir(BUILD):
        shutil.rmtree(BUILD)
    os.makedirs(BUILD)
    res_zip = os.path.join(BUILD, 'res.zip')
    run2([exe['aapt2'], 'compile', '--dir', os.path.join(APP, 'res'), '-o', res_zip])

    print('=== 3/7 aapt2 link（生成 base.apk，含 assets）===')
    base_apk = os.path.join(BUILD, 'base.apk')
    run2([exe['aapt2'], 'link', '-o', base_apk,
          '-I', android_jar,
          '--manifest', os.path.join(APP, 'AndroidManifest.xml'),
          '-R', res_zip,
          '-A', os.path.join(APP, 'assets'),
          '--min-sdk-version', '21', '--target-sdk-version', '34',
          '--version-code', '1', '--version-name', '1.0',
          '--auto-add-overlay'])

    print('=== 4/7 javac + d8（生成 classes.dex）===')
    classes = os.path.join(BUILD, 'classes')
    os.makedirs(classes)
    sources = []
    for r, _, fs in os.walk(os.path.join(APP, 'src')):
        sources += [os.path.join(r, f) for f in fs if f.endswith('.java')]
    # android.jar 放 -classpath；用 -source/-target 8 让 class 版本是 52（d8 接受）
    run2([exe['javac'], '-source', '1.8', '-target', '1.8', '-encoding', 'UTF-8',
          '-nowarn', '-classpath', android_jar, '-d', classes] + sources)
    class_files = []
    for r, _, fs in os.walk(classes):
        class_files += [os.path.join(r, f) for f in fs if f.endswith('.class')]
    dex_dir = os.path.join(BUILD, 'dex')
    os.makedirs(dex_dir)
    run2([exe['d8'], '--lib', android_jar, '--min-api', '21',
          '--output', dex_dir] + class_files)
    dex = os.path.join(dex_dir, 'classes.dex')
    print('  classes.dex %.1f KB' % (os.path.getsize(dex) / 1024.0))

    print('=== 5/7 把 classes.dex 塞进 apk ===')
    unsigned = os.path.join(BUILD, 'unsigned.apk')
    shutil.copyfile(base_apk, unsigned)
    with zipfile.ZipFile(unsigned) as zf:
        arsc = zf.read('resources.arsc') if 'resources.arsc' in zf.namelist() else None
    # ★ Android 11+ 要求 resources.arsc 未压缩且 4 字节对齐，否则拒绝安装。
    #   Python 的 zipfile 无法原地改写，所以重建：先写新的，再替换。
    tmp = unsigned + '.new'
    with zipfile.ZipFile(unsigned) as zin, \
            zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename == 'resources.arsc':
                continue
            data = zin.read(item.filename)
            if item.filename == 'classes.dex':
                continue
            # 原本就是"存储"的条目保持存储（例如 resources.arsc 之外的资源表/清单）
            if item.compress_type == zipfile.ZIP_STORED:
                zout.writestr(item, data, compress_type=zipfile.ZIP_STORED)
            else:
                zout.writestr(item, data, compress_type=zipfile.ZIP_DEFLATED)
        with open(dex, 'rb') as f:
            zout.writestr('classes.dex', f.read(), compress_type=zipfile.ZIP_DEFLATED)
        if arsc is not None:
            zout.writestr('resources.arsc', arsc, compress_type=zipfile.ZIP_STORED)
            print('  resources.arsc 保持未压缩（%.1f KB）' % (len(arsc) / 1024.0))
    os.replace(tmp, unsigned)

    print('=== 6/7 zipalign ===')
    aligned = os.path.join(BUILD, 'aligned.apk')
    run2([exe['zipalign'], '-f', '-p', '4', unsigned, aligned])

    print('=== 7/7 签名 ===')
    if not os.path.exists(KEYSTORE):
        print('  首次运行：生成自用签名（之后每次复用，保证能覆盖安装）')
        run2([exe['keytool'], '-genkeypair', '-keystore', KEYSTORE, '-alias', 'bs',
              '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
              '-storepass', KS_PASS, '-keypass', KS_PASS,
              '-dname', 'CN=BS Suika, O=Personal, C=CN'])
    if os.path.exists(OUT):
        os.remove(OUT)
    run2([exe['apksigner'], 'sign', '--ks', KEYSTORE, '--ks-key-alias', 'bs',
          '--ks-pass', 'pass:' + KS_PASS, '--key-pass', 'pass:' + KS_PASS,
          '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
          '--out', OUT, aligned])

    print('\n=== 结果 ===')
    print(run2([exe['apksigner'], 'verify', '--print-certs', OUT], quiet=True).strip()[:600])
    badging = run2([exe['aapt2'], 'dump', 'badging', OUT], quiet=True)
    for line in badging.splitlines()[:5]:
        print('  ' + line)
    print('  APK: %s  %.2f MB' % (OUT, os.path.getsize(OUT) / 1024.0 / 1024.0))


if __name__ == '__main__':
    main()
