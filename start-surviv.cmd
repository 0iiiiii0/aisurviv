@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-surviv.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo Launcher failed with exit code %EXIT_CODE%.
echo %* | findstr /I /C:"-ExitAfterReady" >nul
if errorlevel 1 (
    echo Launcher exited. Close this window or press any key...
    pause >nul
)
exit /b %EXIT_CODE%
