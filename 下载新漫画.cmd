@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "LIB=%~dp0"
set "LIB=%LIB:~0,-1%"
echo ================================================
echo              下  载  新  漫  画
echo ================================================
echo.
echo   请粘贴漫画目录页地址, 例如:
echo       https://manhua.zaimanhua.com/details/65391      (再漫画)
echo       https://www.xmanhua.net/35231xm/                (xmanhua)
echo   (支持站点见 _scripts\sites\index.mjs, 与 App 的「下载漫画 -^> 通用链接」同一条链路)
echo.
set /p "URL=  地址: "
if "%URL%"=="" (echo. & echo   没有输入, 已取消. & pause & exit /b 1)
echo.
node "_scripts\add-comic.mjs" --url "%URL%" --lib "%LIB%"
echo.
pause