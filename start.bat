@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: Запуск без окна терминала — через вспомогательный VBS
set "VBSCRIPT=%TEMP%\antidante_launch.vbs"
(
    echo Set WshShell = CreateObject("WScript.Shell"^)
    echo WshShell.CurrentDirectory = "%~dp0"
    echo WshShell.Run "cmd /c npx electron .", 0, False
) > "%VBSCRIPT%"

wscript //nologo "%VBSCRIPT%"
del "%VBSCRIPT%" 2>nul
