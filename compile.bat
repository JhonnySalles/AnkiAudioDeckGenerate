@echo off
echo Compilando e gerando os executaveis do Anki Audio Card Creator...
call yarn build:electron
exit /b %ERRORLEVEL%
