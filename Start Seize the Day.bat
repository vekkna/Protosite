@echo off
setlocal
title Seize the Day - Local Server
pushd "%~dp0" || exit /b 1

python -u tools\serve.py 8173 --open
set "server_exit=%errorlevel%"
popd

if not "%server_exit%"=="0" pause
exit /b %server_exit%
