# 打包入口（真正的逻辑在 build_apk.py，那个更好维护、不容易出引号/括号的坑）
#   python build_apk.py    ← 直接跑这个也行
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = 'C:\Users\HP\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe' }
if (-not (Test-Path $py)) { throw '找不到 python，请手动运行： python build_apk.py' }

& $py (Join-Path $here 'build_apk.py')
exit $LASTEXITCODE
