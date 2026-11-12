@echo off
echo Iniciando Anki Audio Card Creator em modo de Desenvolvimento...
call yarn electron:dev
exit /b %ERRORLEVEL%
