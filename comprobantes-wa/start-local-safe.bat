@echo off
title Servidor de Pruebas Local (Sin WhatsApp)
echo ========================================================
echo   Iniciando el servidor de forma segura para pruebas local...
echo   El bot de WhatsApp esta DESACTIVADO para evitar conflictos.
echo ========================================================
echo.
set DISABLE_WHATSAPP=true
node server.js
pause
