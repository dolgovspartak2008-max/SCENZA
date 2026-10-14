@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "VENV_PY=.scena\venv\Scripts\python.exe"
if exist "%VENV_PY%" goto install
echo Создаю Python-окружение для анализа видео...
py -3.12 -m venv .scena\venv 2>nul
if not exist "%VENV_PY%" python -m venv .scena\venv
if not exist "%VENV_PY%" (
  echo Python 3.12 не найден. Установите его с https://www.python.org/downloads/ с галочкой "Add python.exe to PATH" и запустите этот файл снова.
  pause
  exit /b 1
)
:install
echo Устанавливаю библиотеки распознавания речи и поиска сцен. Это может занять несколько минут...
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install -r server\ai\requirements.txt
if errorlevel 1 (
  echo Установка не удалась. Проверьте интернет и запустите файл снова.
  pause
  exit /b 1
)
"%VENV_PY%" -c "import faster_whisper, scenedetect, cv2"
if errorlevel 1 (
  echo Библиотеки установились с ошибкой. Запустите файл снова.
  pause
  exit /b 1
)
echo Готово. Перезагрузите компьютер или завершите процессы node и запустите Start-Scena.cmd.
pause
