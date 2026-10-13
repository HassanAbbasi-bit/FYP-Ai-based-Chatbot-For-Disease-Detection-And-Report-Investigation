@echo off
cd /d "%~dp0"
set "OLLAMA_MODELS=%~dp0ai-backend\.ollama-models"
set "OLLAMA_HOST=127.0.0.1:11434"
set "OLLAMA_NUM_PARALLEL=1"
set "OLLAMA_MAX_LOADED_MODELS=1"
set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not exist "%OLLAMA_EXE%" set "OLLAMA_EXE=ollama"
"%OLLAMA_EXE%" list >nul 2>&1
if not errorlevel 1 (
  echo Ollama is already running. Model storage is configured on drive F.
  exit /b 0
)
"%OLLAMA_EXE%" serve
