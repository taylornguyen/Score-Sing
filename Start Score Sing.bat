@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missingNode
where npm >nul 2>nul
if errorlevel 1 goto missingNode
if not exist "node_modules\jose\package.json" (
  echo Installing Score Sing dependencies for the first run...
  call npm ci
  if errorlevel 1 goto failed
)
echo Starting Score Sing. The one-run sign-in code will be shown below.
call npm start
if errorlevel 1 goto failed
exit /b 0
:missingNode
echo Install Node.js 24 or newer, then double-click this file again.
goto failed
:failed
pause
exit /b 1
