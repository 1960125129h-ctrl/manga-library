@echo off
chcp 65001 >nul
rem Demo mode launcher. Real work is done in demo-run.mjs (safe with non-ASCII paths).
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
node "_scripts\jm\probe\demo-run.mjs"
if errorlevel 1 pause
