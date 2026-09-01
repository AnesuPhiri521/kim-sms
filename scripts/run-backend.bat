@echo off
REM Runs the EduManage backend (FastAPI/uvicorn) using the plain-pip virtualenv.
REM Set up by ..\start-manual.bat. Run that first if .venv is missing.
setlocal
set "HERE=%~dp0"
cd /d "%HERE%..\backend" || exit /b 1

if not exist ".venv\Scripts\python.exe" (
  echo [backend] backend\.venv not found.
  echo [backend] Run start-manual.bat from the project root first, or manually:
  echo     python -m venv .venv
  echo     .venv\Scripts\python -m pip install -r requirements.txt
  echo     .venv\Scripts\python -m alembic upgrade head
  echo     .venv\Scripts\python -m app.db.seed
  exit /b 1
)

".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
