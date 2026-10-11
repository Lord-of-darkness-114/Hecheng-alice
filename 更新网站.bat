@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 更新线上网站（推完再关这个窗口）

echo ============================================================
echo   把刚才改的东西更新到线上网站
echo ============================================================
echo.
echo   线上地址：https://lord-of-darkness-114.github.io/Hecheng-alice/
echo   仓库地址：https://github.com/Lord-of-darkness-114/Hecheng-alice
echo.
echo   这个脚本会做 4 件事：
echo     1. 重新生成 publish 成品（把 web/ 摊平、改好路径）
echo     2. 把改动提交到本地 git
echo     3. 推送到 GitHub 的 main 分支（完整源码）
echo     4. 推送到 gh-pages 分支（线上网站的内容）
echo.
echo   推完等 1~2 分钟，刷新线上地址就能看到新版。
echo   （首次授权已经记住了，正常情况下不会再弹登录窗口）
echo.
echo ============================================================
pause

echo.
echo [1/4] 重新生成 publish 成品...
python tools\make_publish.py
if errorlevel 1 (
  echo   [失败] 生成成品出错，后面不做了。把窗口内容截图发给助手。
  pause >nul & exit /b 1
)

echo.
echo [2/4] 提交改动...
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -q -m "更新网站 %date% %time%"
  echo   已提交
) else (
  echo   没有新改动，跳过提交
)

echo.
echo [3/4] 推送 main（完整源码）...
git push origin main

echo.
echo [4/4] 推送 gh-pages（线上网站内容）...
git subtree push --prefix publish origin gh-pages

echo.
echo ============================================================
echo   完成！等 1~2 分钟后刷新：
echo   https://lord-of-darkness-114.github.io/Hecheng-alice/
echo.
echo   如果上面有报错（橙红色），把窗口内容截图发给助手。
echo ============================================================
echo.
echo 按任意键关闭窗口。
pause >nul
