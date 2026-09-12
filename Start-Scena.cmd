@echo off
setlocal
cd /d "%~dp0"
set "SCENA_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "SCENA_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%SCENA_NODE%" scripts\launch.mjs
if errorlevel 1 pause
