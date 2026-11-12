@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo ============================================================================
echo   Anki Audio Card Creator - Release Build (Windows)
echo ============================================================================
echo Raiz do Projeto: %CD%
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto :err_node

where yarn >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto :err_yarn

if not exist "exec" mkdir "exec"

if not exist "node_modules\" (
  echo node_modules nao encontrada - executando yarn install...
  call yarn install
  if %ERRORLEVEL% NEQ 0 goto :err_install
)

echo.
echo [1/2] Compilando aplicacao (TypeScript Electron + Angular Build)...
call yarn compile:all
if %ERRORLEVEL% NEQ 0 goto :err_compile

echo.
echo [2/2] Empacotando instalador e versao portatil com Electron Builder...
call yarn pack:installer
if %ERRORLEVEL% NEQ 0 goto :err_pack

echo.
echo ============================================================================
echo   Geracao de Release Concluida com Sucesso!
echo ============================================================================
echo Artefatos gerados na pasta: %CD%\exec
echo.
dir /b "exec\*.exe" 2>nul
echo.
echo Instalador:  AnkiCardCreator-Setup-*.exe
echo Portatil:    AnkiCardCreator-Portable-*.exe
echo.
exit /b 0

:err_node
echo [ERRO] Node.js nao encontrado no PATH do sistema.
exit /b 1

:err_yarn
echo [ERRO] Yarn nao encontrado no PATH do sistema.
exit /b 1

:err_install
echo [ERRO] Falha ao executar yarn install.
exit /b 1

:err_compile
echo [ERRO] Falha na compilacao (yarn compile:all).
exit /b 1

:err_pack
echo [ERRO] Falha ao empacotar com o Electron Builder.
exit /b 1
