# Wrapper to start the video engine from backend directory
param(
    [int]$Port = 8500,
    [switch]$Force
)

$script = Join-Path (Split-Path -Parent $PSScriptRoot) "start-video-engine.ps1"
if (-not (Test-Path $script)) {
    $script = Join-Path (Split-Path -Parent (Get-Location)) "start-video-engine.ps1"
}
& $script -Port $Port
