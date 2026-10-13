@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Fractical needs Node.js 22 or newer.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
call npm.cmd start
