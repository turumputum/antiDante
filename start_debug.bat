@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ══════════════════════════════════════════════════
echo   AntiDante — режим отладки
echo ══════════════════════════════════════════════════
echo.

:: Проверка node_modules
if not exist "node_modules" (
    echo [!] node_modules не найден, запускаю npm install...
    call npm install
    echo.
)

:: Проверка GStreamer
where gst-launch-1.0 >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] ВНИМАНИЕ: gst-launch-1.0 не найден в PATH
    echo     Убедитесь, что GStreamer установлен и добавлен в PATH
    echo.
) else (
    for /f "tokens=*" %%v in ('gst-launch-1.0 --version 2^>^&1') do (
        echo [OK] %%v
        goto :gst_done
    )
    :gst_done
    echo.
)

echo Запуск Electron с выводом логов...
echo Для остановки нажмите Ctrl+C
echo ──────────────────────────────────────────────────
echo.

npx electron .

echo.
echo ──────────────────────────────────────────────────
echo Приложение завершено.
pause
