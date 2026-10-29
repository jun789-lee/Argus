@echo off
rem Start agents-observe server locally (no Docker). Dashboard: http://localhost:4981
rem Output goes to a log file, not this console: clicking inside a console window
rem enters QuickEdit "Select" mode, which blocks console writes and freezes the server.
set HOME=%USERPROFILE%
set AGENTS_OBSERVE_RUNTIME=local
set AGENTS_OBSERVE_SHUTDOWN_DELAY_MS=0
set LOGDIR=%USERPROFILE%\.agents-observe\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
cd /d "%~dp0"
echo Server running at http://localhost:4981  (log: %LOGDIR%\server.log)
echo Close this window to stop the server.
node start.mjs --skip-install >> "%LOGDIR%\server.log" 2>&1
