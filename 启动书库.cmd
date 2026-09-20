@echo off
chcp 65001 >nul
cd /d "%~dp0_app"
if not exist "node_modules\electron\dist\electron.exe" (
  echo    Electron 未安装, 正在安装...
  call npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
  node node_modules\electron\install.js
)
start "" "node_modules\electron\dist\electron.exe" .