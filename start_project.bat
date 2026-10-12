@echo off
cd /d "%~dp0"
start "Blood CP AI backend" cmd /k start_backend.bat
start "Blood CP Express" cmd /k "cd /d server && npm.cmd run dev"
start "Blood CP Frontend" cmd /k "cd /d client && npm.cmd run dev"
echo Open http://localhost:5173 after all three services start.
