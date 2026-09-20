@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo   先导入 _zips 目录里的压缩包...
node "_scripts\jm\import-zips.mjs"
echo.
echo   监视下载目录, 你手动下的包会自动入库并重建书库...
echo   关掉这个窗口就停止。
echo.
node "_scripts\jm\watch-downloads.mjs" 5
pause