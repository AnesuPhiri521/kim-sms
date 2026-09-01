@echo off
REM ---------------------------------------------------------------------------
REM  EduManage - manual Windows launcher (no uv)
REM
REM  Use this instead of start.bat when uv is unavailable (e.g. blocked by
REM  organization policy). It sets up and starts both servers using only the
REM  stock Python venv + pip (backend) and npm (frontend).
REM
REM  Prerequisites on PATH:
REM    - Python 3.12+   (check: python --version)
REM    - Node.js 20.9+  (check: node --version   - bundles npm)
REM
REM  Run this from the project root. It opens two new windows (backend and
REM  frontend); close those windows to stop the servers.
REM ---------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"

where python >nul 2>nul || (echo [error] Python 3.12+ not found on PATH - install from https://www.python.org/ & exit /b 1)
where node   >nul 2>nul || (echo [error] Node.js 20.9+ not found on PATH - install from https://nodejs.org/ & exit /b 1)

REM --- env files ------------------------------------------------------------
if not exist "%BACKEND%\.env" (
  copy /y "%BACKEND%\.env.example" "%BACKEND%\.env" >nul
  echo [setup] created backend\.env from .env.example
)
if not exist "%FRONTEND%\.env.local" (
  copy /y "%FRONTEND%\.env.local.example" "%FRONTEND%\.env.local" >nul
  echo [setup] created frontend\.env.local from .env.local.example
)

REM --- backend: venv + dependencies ---------------------------------------
if not exist "%VENV_PY%" (
  echo [backend] creating virtual environment backend\.venv ...
  python -m venv "%BACKEND%\.venv" || (echo [error] failed to create venv & exit /b 1)
)
echo [backend] installing dependencies ...
"%VENV_PY%" -m pip install --upgrade pip --quiet
"%VENV_PY%" -m pip install -r "%BACKEND%\requirements.txt" || (echo [error] pip install failed & exit /b 1)

REM --- backend: migrations + seed ---------------------------------------
findstr /c:"ADMIN_PASSWORD=ChangeMe123!" "%BACKEND%\.env" >nul 2>nul && (
  echo.
  echo [warn] backend\.env still has the placeholder ADMIN_PASSWORD ^(ChangeMe123!^^).
  echo [warn] The seed step below will fail until you set a real value in backend\.env
  echo [warn] ^(also set a real JWT_SECRET_KEY while you are there^^).
  echo.
)
pushd "%BACKEND%"
echo [backend] applying database migrations ...
"%VENV_PY%" -m alembic upgrade head
echo [backend] seeding baseline data ...
"%VENV_PY%" -m app.db.seed
popd

REM --- frontend: dependencies -------------------------------------------
if not exist "%FRONTEND%\node_modules" (
  echo [frontend] installing dependencies ^(npm install^) ...
  pushd "%FRONTEND%"
  call npm install || (popd & echo [error] npm install failed & exit /b 1)
  popd
)

REM --- launch both servers, each in its own window --------------------
echo.
echo [dev] starting backend  -^> http://127.0.0.1:8000  (API docs: /docs)
echo [dev] starting frontend -^> http://127.0.0.1:3000
echo [dev] close the two spawned windows to stop the servers.
echo.
start "EduManage Backend"  cmd /k call "%ROOT%scripts\run-backend.bat"
start "EduManage Frontend" cmd /k call "%ROOT%scripts\run-frontend.bat"

endlocal
