@echo off
setlocal
cd /d "%~dp0"

set "CUTLINE_EXE=%~dp0src-tauri\target\release\cutline.exe"
set "CUTLINE_INSTALLER=%~dp0src-tauri\target\release\bundle\nsis\Cutline_0.1.0_x64-setup.exe"

if /i "%~1"=="release" goto release

where pnpm >nul 2>nul
if errorlevel 1 goto release
if not exist "%~dp0node_modules\" goto release

echo [Cutline] Starting the latest source in desktop development mode...
echo [Cutline] Use "run.bat release" to start the existing release executable.
call pnpm desktop:dev
exit /b %errorlevel%

:release
if exist "%CUTLINE_EXE%" (
  start "Cutline" "%CUTLINE_EXE%"
  exit /b 0
)

echo [Cutline] No runnable development environment or release executable was found.
echo [Cutline] Run "pnpm install", or build the app with "pnpm desktop:build".
if exist "%CUTLINE_INSTALLER%" echo [Cutline] Installer: %CUTLINE_INSTALLER%
pause
exit /b 1
