@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   mydraft 原型工具 - 画布 + 本机保存 一键启动
echo ============================================
echo.
echo 将同时启动:
echo   [1] 文档存储服务器  127.0.0.1:8901 (保存到本机用)
echo   [2] 应用开发服务器  http://localhost:5173
echo.
echo 浏览器打开 http://localhost:5173 即可使用,"保存到本机"已可用。
echo 文件保存在项目目录 diagrams\ 文件夹下。
echo.
call npm run start:full
pause
