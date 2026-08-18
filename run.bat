@echo off
setlocal
cd /d "%~dp0"

set "EDITWEAVE_EXE=%~dp0src-tauri\target\release\editweave.exe"
set "EDITWEAVE_INSTALLER=%~dp0src-tauri\target\release\bundle\nsis\EditWeave_0.1.0_x64-setup.exe"

if /i "%~1"=="release" goto release

where pnpm >nul 2>nul
if errorlevel 1 goto release
if not exist "%~dp0node_modules\" goto release

echo [EditWeave] Starting the latest source in desktop development mode...
echo [EditWeave] Use "run.bat release" to start the existing release executable.
call pnpm desktop:dev
exit /b %errorlevel%

:release
if exist "%EDITWEAVE_EXE%" (
  start "EditWeave" "%EDITWEAVE_EXE%"
  exit /b 0
)

echo [EditWeave] No runnable development environment or release executable was found.
echo [EditWeave] Run "pnpm install", or build the app with "pnpm desktop:build".
if exist "%EDITWEAVE_INSTALLER%" echo [EditWeave] Installer: %EDITWEAVE_INSTALLER%
pause
exit /b 1
