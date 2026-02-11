@echo off
chcp 65001 >nul
:: ─────────────────────────────────────────────────────────────
:: AntiDante — добавить / удалить из автозагрузки Windows
:: ─────────────────────────────────────────────────────────────

set "APP_NAME=AntiDante"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_FOLDER%\%APP_NAME%.lnk"
set "TARGET=%~dp0start.bat"

if "%~1"=="remove" goto :remove

:: ── Добавление ──
if exist "%SHORTCUT%" (
    echo [%APP_NAME%] Уже добавлен в автозагрузку.
    echo Путь: %SHORTCUT%
    echo.
    echo Чтобы удалить, запустите:  autostart.bat remove
    pause
    exit /b 0
)

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Description = '%APP_NAME% — Audio Streamer'; $s.Save()"

if exist "%SHORTCUT%" (
    echo [%APP_NAME%] Добавлен в автозагрузку!
    echo Ярлык: %SHORTCUT%
) else (
    echo [%APP_NAME%] Ошибка: не удалось создать ярлык.
)
pause
exit /b 0

:: ── Удаление ──
:remove
if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo [%APP_NAME%] Удалён из автозагрузки.
) else (
    echo [%APP_NAME%] Не найден в автозагрузке.
)
pause
exit /b 0
