@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Create the project Python virtual environment first. See docs/blood-cp-integration.md.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ai-backend --host 0.0.0.0 --port 8000 --reload
pause
