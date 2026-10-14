# =============================================================================
#  一键搭好 Android 打包工具链（本机原先什么都没有）
# -----------------------------------------------------------------------------
#  为什么要这么干：
#    · 本机没有 JDK / Android SDK；maven.google.com 不通 → **不能用 Gradle**
#    · GitHub 直连下载只有 0.3MB/s（要几小时）→ 改用国内镜像：
#        华为云 OpenJDK      4.3 MB/s
#        dl.google.com      5.6 MB/s   ← SDK 官方源，反而很快
#      全部约 440MB，1~2 分钟下完
#
#  装完得到：
#    jdk\jdk-17.0.2\...                  javac / keytool / java
#    sdk\cmdline-tools\latest\...        sdkmanager
#    sdk\platforms\android-34\           android.jar
#    sdk\build-tools\34.0.0\             aapt2 / d8 / zipalign / apksigner
#
#  用法： powershell -ExecutionPolicy Bypass -File setup_toolchain.ps1
#  装完直接： python build_apk.py
# =============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'android-build'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$t0 = Get-Date

# ---------- 1) JDK 17（华为云镜像，失败则依次回退）----------
Write-Host '=== 1/3 下载 JDK 17 ==='
$jdkZip = Join-Path $base 'jdk.zip'
if (-not (Test-Path $jdkZip) -or (Get-Item $jdkZip).Length -lt 100MB) {
    $urls = @(
        'https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip',
        'https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip',
        'https://cdn.azul.com/zulu/bin/zulu17.54.21-ca-jdk17.0.13-win_x64.zip'
    )
    $ok = $false
    foreach ($u in $urls) {
        Remove-Item $jdkZip -Force -ErrorAction SilentlyContinue
        try {
            Write-Host "  试: $u"
            Invoke-WebRequest $u -OutFile $jdkZip -UseBasicParsing -TimeoutSec 1200
            if ((Get-Item $jdkZip).Length -gt 100MB) { $ok = $true; break }
        } catch { Write-Host "  ❌ $($_.Exception.Message)" }
    }
    if (-not $ok) { throw 'JDK 下载失败' }
}
Write-Host "  ✅ $([math]::Round((Get-Item $jdkZip).Length/1MB,0))MB"
if (-not (Test-Path (Join-Path $base 'jdk'))) {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($jdkZip, (Join-Path $base 'jdk'))
}
$jdkHome = (Get-ChildItem (Join-Path $base 'jdk') -Directory | Select-Object -First 1).FullName
Write-Host "  JDK: $jdkHome"

# ---------- 2) Android cmdline-tools ----------
Write-Host '=== 2/3 下载 Android cmdline-tools ==='
$toolsZip = Join-Path $base 'cmdline.zip'
if (-not (Test-Path $toolsZip) -or (Get-Item $toolsZip).Length -lt 100MB) {
    Remove-Item $toolsZip -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-12266719_latest.zip' `
        -OutFile $toolsZip -UseBasicParsing -TimeoutSec 1200
}
Write-Host "  ✅ $([math]::Round((Get-Item $toolsZip).Length/1MB,0))MB"
$sdk = Join-Path $base 'sdk'
if (-not (Test-Path (Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
    $tmp = Join-Path $base 'sdk-tmp'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($toolsZip, $tmp)
    New-Item -ItemType Directory -Force -Path (Join-Path $sdk 'cmdline-tools') | Out-Null
    Move-Item (Join-Path $tmp 'cmdline-tools') (Join-Path $sdk 'cmdline-tools\latest')
}

# ---------- 3) 接受许可并安装 platform / build-tools ----------
Write-Host '=== 3/3 安装 platform-34 + build-tools-34 ==='
$env:JAVA_HOME = $jdkHome
$env:PATH = "$jdkHome\bin;$env:PATH"
$sm = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
("y`r`n" * 40) | & $sm --sdk_root="$sdk" --licenses 2>&1 | Select-Object -Last 1
& $sm --sdk_root="$sdk" 'platforms;android-34' 'build-tools;34.0.0' 'platform-tools' 2>&1 | Select-Object -Last 3

Write-Host ''
Write-Host '=== 校验 ==='
$btVer = (Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -EA SilentlyContinue | Select-Object -First 1).Name
$platVer = (Get-ChildItem (Join-Path $sdk 'platforms') -Directory -EA SilentlyContinue | Select-Object -First 1).Name
foreach ($p in @(
    (Join-Path $sdk "build-tools\$btVer\aapt2.exe"),
    (Join-Path $sdk "build-tools\$btVer\d8.bat"),
    (Join-Path $sdk "build-tools\$btVer\zipalign.exe"),
    (Join-Path $sdk "build-tools\$btVer\apksigner.bat"),
    (Join-Path $sdk "platforms\$platVer\android.jar"),
    (Join-Path $jdkHome 'bin\javac.exe'),
    (Join-Path $jdkHome 'bin\keytool.exe'))) {
    Write-Host ("  {0,-16} {1}" -f (Split-Path $p -Leaf), $(if (Test-Path $p) { '✅' } else { '❌' }))
}
Write-Host ("=== 完成，用时 {0:N1} 分钟；接下来跑： python build_apk.py ===" -f ((Get-Date) - $t0).TotalMinutes)
