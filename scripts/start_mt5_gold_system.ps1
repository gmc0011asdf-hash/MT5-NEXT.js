#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$MT5_EXE      = "C:\Program Files\MetaTrader 5\terminal64.exe"
$PROJECT_ROOT = "E:\PROJACT-AHMED\MT5-gold-clone"
$PYTHON_DIR   = "$PROJECT_ROOT\mt5_readonly_service"
$GOLD_URL     = "http://localhost:3000/gold"

function Step($m) {
    Write-Host ""
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m) -ForegroundColor Cyan
}
function Ok($m)   { Write-Host ("OK: {0}" -f $m) -ForegroundColor Green }
function Warn($m) { Write-Host ("WARN: {0}" -f $m) -ForegroundColor Yellow }
function Fail($m) { Write-Host ("FAIL: {0}" -f $m) -ForegroundColor Red }

Write-Host ""
Write-Host "MT5 Gold System - Local Runtime Launcher v1" -ForegroundColor Yellow
Write-Host "------------------------------------------------"

Step "Checking requirements"

if (-not (Test-Path $MT5_EXE)) {
    Fail "MetaTrader 5 not found: $MT5_EXE"
    exit 1
}

if (-not (Test-Path $PYTHON_DIR)) {
    Fail "Python service folder not found: $PYTHON_DIR"
    exit 1
}

if (-not (Get-Command uvicorn -ErrorAction SilentlyContinue)) {
    Fail "uvicorn is not installed. Run: pip install uvicorn fastapi"
    exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail "pnpm is not installed. Run: npm install -g pnpm"
    exit 1
}

Ok "Requirements found"

Step "Starting MetaTrader 5"
try {
    Start-Process -FilePath $MT5_EXE
    Ok "MetaTrader 5 started"
} catch {
    Warn "Could not start MT5: $($_.Exception.Message)"
}

Step "Waiting 10 seconds for MT5"
Start-Sleep -Seconds 10

Step "Starting Python MT5 Bridge on 127.0.0.1:8010"

$pythonCmd = "Set-Location '$PYTHON_DIR'; `$env:MT5_DEMO_EXECUTION_ENABLED='1'; Write-Host 'Python MT5 Bridge starting...' -ForegroundColor Cyan; uvicorn main:app --host 127.0.0.1 --port 8010 --reload"

Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $pythonCmd
)

Ok "Python Bridge window opened"

Step "Waiting 5 seconds for Python Bridge"
Start-Sleep -Seconds 5

Step "Starting Next.js"

$nextCmd = "Set-Location '$PROJECT_ROOT'; Write-Host 'Next.js starting...' -ForegroundColor Cyan; pnpm dev"

Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $nextCmd
)

Ok "Next.js window opened"

Step "Waiting 8 seconds for Next.js"
Start-Sleep -Seconds 8

Step "Opening Gold Command Center"
Start-Process $GOLD_URL

Ok "Done"
Write-Host ""
Write-Host "Check status with:"
Write-Host "curl.exe http://127.0.0.1:8010/health"
Write-Host "curl.exe http://localhost:3000/api/mt5-readonly/connection-status"
Write-Host ""
