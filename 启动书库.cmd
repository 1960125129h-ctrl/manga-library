@echo off
chcp 65001 >nul
rem Clear this var: it makes electron.exe run as pure Node (no window).
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0_app"
if not exist "node_modules\electron\dist\electron.exe" (
  echo   Electron not installed, installing...
  call npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
  node node_modules\electron\install.js
)
start "" "node_modules\electron\dist\electron.exe" .
