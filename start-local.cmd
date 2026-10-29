@echo off
rem Start agents-observe server locally (no Docker). Dashboard: http://localhost:4981
set HOME=%USERPROFILE%
set AGENTS_OBSERVE_RUNTIME=local
set AGENTS_OBSERVE_SHUTDOWN_DELAY_MS=0
cd /d "%~dp0"
node start.mjs --skip-install
