@echo off
rem Fleet Live launcher for Windows: starts the read-only collector and opens the app window.
where py >nul 2>nul && (py -3 "%~dp0fleet_live.py" --open %*) || (python "%~dp0fleet_live.py" --open %*)
