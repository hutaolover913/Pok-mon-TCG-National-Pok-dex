@echo off
chcp 65001 >/dev/null
cd /d "%~dp0"
python start_app.py
if errorlevel 1 (
    echo.
    echo 啟動失敗。請確認電腦已安裝 Python 並且可以在命令列執行 python 指令。
    pause
)
