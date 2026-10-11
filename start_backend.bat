@echo off
title Medical AI Backend Server
echo ========================================================
echo  Starting Medical AI Backend Service (FastAPI)
echo  Endpoint: http://localhost:8000
echo  Swagger Docs: http://localhost:8000/docs
echo ========================================================
echo.

if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
) else (
    echo [WARNING] .venv not found. Running with global python.
)

python -m uvicorn app.main:app --app-dir ai-backend --host 0.0.0.0 --port 8000 --reload
pause
