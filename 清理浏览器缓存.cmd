@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo   正在清理"登录用浏览器"的缓存(Chrome / Edge 的 profile)...
echo   只删缓存, 不动登录态(Cookies)...
echo.
node "_scripts\jm\clear-profile-cache.mjs"
echo.
pause
