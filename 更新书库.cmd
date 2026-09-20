@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "LIB=%~dp0"
set "LIB=%LIB:~0,-1%"
echo.
echo   正在重新扫描书库目录, 生成 书库.html ...
echo.
node "_scripts\build-library.mjs" --lib "%LIB%"
echo.
if errorlevel 1 (echo   失败, 请看上面的错误信息) else (echo   完成! 双击 书库.html 即可打开.)
echo.
pause