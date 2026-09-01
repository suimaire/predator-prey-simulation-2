@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting local preview...
echo Open http://127.0.0.1:5173/predator-prey-simulation-2/ in your browser.
call npm run dev -- --host 127.0.0.1
