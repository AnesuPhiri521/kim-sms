@echo off
REM Starts the EduManage backend + frontend together (Windows).
setlocal
set "DIR=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run this script. Install it from https://nodejs.org/ and try again.
  exit /b 1
)

node "%DIR%scripts\dev.js" %*
