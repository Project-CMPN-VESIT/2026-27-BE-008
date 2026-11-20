# Start FinPilot Video Engine Backend
param(
    [int]$Port = 8500,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$finpilotRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $scriptDir "backend"

$venvPython = Join-Path $finpilotRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    $venvPython = Join-Path $finpilotRoot "venve\Scripts\python.exe"
}
if (-not (Test-Path $venvPython)) {
    $venvPython = "python"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   FinPilot Nifty Shorts Video Engine   " -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Backend Directory: $backendDir"
Write-Host "Port: $Port"
Write-Host "Using Python: $venvPython"

# Check if port is already in use
$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    $existingPid = $existing.OwningProcess
    Write-Host "Notice: Port $Port is currently in use by process ID $existingPid." -ForegroundColor Yellow
    Write-Host "Terminating previous process $existingPid to free port $Port..." -ForegroundColor Cyan
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Set-Location $backendDir
& $venvPython -m uvicorn main:app --host 127.0.0.1 --port $Port --reload
