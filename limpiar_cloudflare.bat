@echo off
chcp 65001 >nul
cls

echo.
echo ============================================================
echo   LIMPIADOR DE PROTECCION CLOUDFLARE
echo ============================================================
echo.

REM Verificar si Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no esta instalado o no esta en el PATH
    echo.
    echo Por favor, instala Python desde https://www.python.org/
    echo.
    pause
    exit /b 1
)

REM Verificar si existe el script Python
if not exist "%~dp0remove_cloudflare_protection.py" (
    echo ERROR: No se encuentra el archivo remove_cloudflare_protection.py
    echo.
    echo Asegurate de que este .bat esta en el mismo directorio que el script Python
    echo.
    pause
    exit /b 1
)

REM Buscar archivos HTML en el directorio actual
echo Buscando archivos HTML en el directorio...
echo.

set found=0
for %%f in (*.html) do (
    set found=1
    echo   - %%f
)

if %found%==0 (
    echo No se encontraron archivos HTML en este directorio
    echo.
    echo Por favor, copia este .bat al directorio donde esta tu archivo HTML
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo.

REM Solicitar nombre del archivo
set /p filename="Introduce el nombre del archivo HTML (ejemplo: index1.html): "

if "%filename%"=="" (
    echo.
    echo ERROR: No introdujiste ningun nombre de archivo
    echo.
    pause
    exit /b 1
)

if not exist "%filename%" (
    echo.
    echo ERROR: El archivo '%filename%' no existe
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   PROCESANDO: %filename%
echo ============================================================
echo.

REM Ejecutar el script Python
python "%~dp0remove_cloudflare_protection.py" "%filename%"

echo.
echo ============================================================
echo   PROCESO FINALIZADO
echo ============================================================
echo.
echo Si hubo cambios, se ha creado un backup: %filename%.bak
echo.
pause
