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

where python >nul 2>nul
if errorlevel 1 goto :no_python
where node >nul 2>nul
if errorlevel 1 goto :no_node

REM --- env files ----------------------------------------------------------
if not exist "%BACKEND%\.env" copy /y "%BACKEND%\.env.example" "%BACKEND%\.env" >nul
if not exist "%FRONTEND%\.env.local" copy /y "%FRONTEND%\.env.local.example" "%FRONTEND%\.env.local" >nul

REM --- backend: virtualenv ------------------------------------------------
if not exist "%VENV_PY%" (
  echo [backend] creating virtual environment backend\.venv ...
  python -m venv "%BACKEND%\.venv"
)
if not exist "%VENV_PY%" goto :venv_failed

REM --- backend: dependencies --------------------------------------------
echo [backend] installing dependencies ...
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install -r "%BACKEND%\requirements.txt"
if errorlevel 1 goto :pip_failed

REM --- backend: migrations + seed -------------------------------------
findstr /c:"ADMIN_PASSWORD=ChangeMe123!" "%BACKEND%\.env" >nul 2>nul
if not errorlevel 1 echo [warn] backend\.env still has the placeholder ADMIN_PASSWORD - set a real value in backend\.env or the admin account will not be seeded.
echo [backend] applying database migrations ...
pushd "%BACKEND%"
"%VENV_PY%" -m alembic upgrade head
echo [backend] seeding baseline data ...
"%VENV_PY%" -m app.db.seed
popd

REM --- frontend: dependencies ---------------------------------------
if not exist "%FRONTEND%\node_modules" (
  echo [frontend] installing dependencies with npm install ...
  pushd "%FRONTEND%"
  call npm install
  popd
)

REM --- launch both servers, each in its own window ----------------
echo.
echo [dev] starting backend  on http://127.0.0.1:8000  (API docs at /docs)
echo [dev] starting frontend on http://127.0.0.1:3000
echo [dev] close the two spawned windows to stop the servers.
echo.
start "EduManage Backend"  cmd /k call "%ROOT%scripts\run-backend.bat"
start "EduManage Frontend" cmd /k call "%ROOT%scripts\run-frontend.bat"
goto :eof

:no_python
echo [error] Python 3.12+ not found on PATH. Install from https://www.python.org/ and reopen the terminal.
exit /b 1

:no_node
echo [error] Node.js 20.9+ not found on PATH. Install from https://nodejs.org/ and reopen the terminal.
exit /b 1

:venv_failed
echo [error] Could not create backend\.venv - check that "python -m venv" works.
exit /b 1

:pip_failed
echo [error] pip install failed - see the output above.
exit /b 1
