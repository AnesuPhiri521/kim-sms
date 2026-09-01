@echo off
REM Runs the EduManage frontend (Next.js dev server).
setlocal
set "HERE=%~dp0"
cd /d "%HERE%..\frontend" || exit /b 1

if not exist ".env.local" (
  copy /y ".env.local.example" ".env.local" >nul
  echo [frontend] created .env.local from .env.local.example
)
if not exist "node_modules" (
  echo [frontend] installing dependencies ...
  call npm install || exit /b 1
)

npm run dev
