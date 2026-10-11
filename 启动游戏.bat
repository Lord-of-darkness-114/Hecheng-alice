@echo off
chcp 65001 >nul
cd /d "%~dp0"
title BLACK SOULS 合成 - 本地服务器（不要关这个窗口）

echo ============================================================
echo   BLACK SOULS 合成 - 正在启动本地服务器
echo ============================================================
echo.
echo   这个黑窗口就是游戏服务器，【不要关掉它】。
echo   关掉游戏就打不开了。玩完再关。
echo.

rem 优先用系统里的 python，找不到就用打包自带的
set PY=python
where python >nul 2>nul
if errorlevel 1 (
  set PY=C:\Users\HP\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe
)

echo   正在打开浏览器...
start "" http://127.0.0.1:8080/web/

echo.
echo   电脑上玩：http://127.0.0.1:8080/web/
echo   手机上玩：看下面打印出来的那一行「手机访问」
echo.
echo   改完 config.js 保存后，【在网页上按 F5 刷新】就能看到效果，
echo   不需要重启这个窗口。
echo.

"%PY%" tools\serve.py 8080 --lan

echo.
echo 服务器已停止。按任意键关闭窗口。
pause >nul
