@echo off
REM Wrapper de conveniencia: executa o build de release para Windows
call "%~dp0scripts\build-release.bat" %*
exit /b %ERRORLEVEL%

