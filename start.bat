@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 18 或更高版本。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

echo 正在启动 tidc VPS 服务中心...
echo 浏览器地址：http://localhost:3000
start "" "http://localhost:3000"
node server.js
pause
