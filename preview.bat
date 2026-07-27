@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM This file is ASCII-only so cmd.exe does not mis-parse UTF-8 Korean bytes.

if not exist "package.json" (
  echo ERROR: package.json not found.
  echo Current folder:
  cd
  echo.
  echo Move preview.bat into the jodong-content-hub project folder, then try again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm not found.
  echo Install Node.js LTS from https://nodejs.org then try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies (may take 1-2 minutes^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
  echo.
)

echo.
echo Dev server: http://localhost:4321
echo Browser may open automatically in ~6 seconds.
echo Stop server: press Ctrl+C in this window.
echo.

REM Open default browser after a short delay (avoids nested cmd quoting issues)
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; try { Start-Process 'http://localhost:4321/' } catch { }"

call npm run dev

echo.
echo Server stopped. If you saw errors above, copy them for support.
pause
endlocal
