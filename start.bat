@echo off
REM Starts the EduManage backend + frontend together (Windows).
REM
REM First run on a new machine is self-bootstrapping: scripts\dev.js installs uv
REM (+ Python 3.12), the backend and frontend dependencies, creates the .env
REM files, applies DB migrations and seeds baseline data before starting both
REM servers. The only prerequisite is Node.js 20.9+ (which also ships npm).
setlocal
set "DIR=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.9+ is required to run this script. Install it from https://nodejs.org/ and try again.
  exit /b 1
)

node "%DIR%scripts\dev.js" %*
