@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 禁漫下载 (Edge)

:loop
echo ================================================
echo      禁漫天堂 一键下载（可循环 / 用 Edge 登录态）
echo ================================================
echo   粘贴专辑链接后回车（多个链接用空格分隔）
echo   直接回车 = 用 待下载.txt 里列的链接批量跑
echo   输入 q 回车 = 退出
echo.
echo   首次使用需先完全关闭 Edge 一次（脚本要复制一份登录态），
echo   之后就一直用那份副本，不用再关。
echo.
set "URLS="
set /p "URLS=  链接: "
if /i "%URLS%"=="q" goto done
if /i "%URLS%"=="quit" goto done
if /i "%URLS%"=="exit" goto done
echo.
node "_scripts\jm\jm-auto.mjs" "%URLS%"
echo.
echo ---------------- 本轮结束，可以继续粘下一个链接 ----------------
echo.
goto loop

:done
echo 已退出。
pause