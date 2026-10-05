[CmdletBinding()]
param(
    [ValidateRange(1, 1440)]
    [int]$ScrapeIntervalMinutes = 30,
    [switch]$ScrapeOnce,
    [string]$MistralApiKey
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvDirName = ".venv"
if (Test-Path (Join-Path $repoRoot "venve")) {
    $venvDirName = "venve"
}
$pythonExe = Join-Path $repoRoot "$venvDirName\Scripts\python.exe"
$activateScript = Join-Path $repoRoot "$venvDirName\Scripts\Activate.ps1"
$envFile = Join-Path $repoRoot ".env"

$frontendDir = $repoRoot
$indiaTradeCliDir = Join-Path $repoRoot "india-trade-cli"
$newsFeedDir = Join-Path $repoRoot "news-feed"
$paperTradingDir = Join-Path $repoRoot "paper-trading"
$scrapperDir = Join-Path $repoRoot "scrapper"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found at $pythonExe. Create/activate your project .venv first."
}

if (-not (Test-Path $activateScript)) {
    throw "Activation script not found at $activateScript."
}

foreach ($path in @($frontendDir, $indiaTradeCliDir, $newsFeedDir, $paperTradingDir, $scrapperDir)) {
    if (-not (Test-Path $path)) {
        throw "Required directory not found: $path"
    }
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found in PATH. Install Node.js and run again."
}

if ($MistralApiKey) {
    if (Test-Path $envFile) {
        $existing = Get-Content $envFile
        $hasKey = $false
        for ($i = 0; $i -lt $existing.Count; $i++) {
            if ($existing[$i] -match '^\s*MISTRAL_API_KEY\s*=') {
                $existing[$i] = "MISTRAL_API_KEY=$MistralApiKey"
                $hasKey = $true
                break
            }
        }

        if (-not $hasKey) {
            $existing += "MISTRAL_API_KEY=$MistralApiKey"
        }

        Set-Content -Path $envFile -Value $existing
    }
    else {
        Set-Content -Path $envFile -Value "MISTRAL_API_KEY=$MistralApiKey"
    }

    $env:MISTRAL_API_KEY = $MistralApiKey
}

if (-not $env:MISTRAL_API_KEY -and (Test-Path $envFile)) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*MISTRAL_API_KEY\s*=' } | Select-Object -First 1
    if ($line) {
        $value = ($line -split '=', 2)[1].Trim()
        if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        elseif ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ($value) {
            $env:MISTRAL_API_KEY = $value
        }
    }
}

if (-not $env:MISTRAL_API_KEY) {
    Write-Host "Warning: MISTRAL_API_KEY is not set. Mentor endpoints will return fallback text." -ForegroundColor Yellow
}

function Start-ServiceTerminal {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    $safeWorkingDirectory = $WorkingDirectory.Replace("'", "''")
    $safeTitle = $Title.Replace("'", "''")

    $terminalCommand = @"
Set-Location -Path '$safeWorkingDirectory'
`$host.UI.RawUI.WindowTitle = '$safeTitle'
$Command
"@

    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($terminalCommand))

    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        $encodedCommand
    ) | Out-Null
}

$safeActivate = $activateScript.Replace("'", "''")
$safePython = $pythonExe.Replace("'", "''")
$unSleepSeconds = [Math]::Max(60, $ScrapeIntervalMinutes * 60)

# ── ChromaDB path (configurable via env) ──────────────────────────────────────
$chromaDbPath = if ($env:CHROMA_DB_PATH) { $env:CHROMA_DB_PATH } else { Join-Path $indiaTradeCliDir "chroma_db" }

$frontendCommand = "npm run dev"

$indiaTradeCliCommand = @"
& '$safeActivate'
& '$safePython' -m web.api
"@

$newsFeedCommand = @"
& '$safeActivate'
& '$safePython' run.py
"@

$paperTradingCommand = @"
& '$safeActivate'
& '$safePython' run.py
"@

$regulatoryApiCommand = @"
& '$safeActivate'
& '$safePython' run.py serve
"@

$screenerApiCommand = @"
& '$safeActivate'
& '$safePython' run.py serve-screener
"@

# ── ChromaDB server (port 8100) ───────────────────────────────────────────────
$safeChromaPath = $chromaDbPath.Replace("'", "''")
$chromaExe = (Join-Path $repoRoot "$venvDirName\Scripts\chroma.exe").Replace("'", "''")
$chromaCommand = @"
& '$safeActivate'
Write-Host '[ChromaDB] Starting vector database server on port 8100...' -ForegroundColor Cyan
if (-not (Test-Path '$safeChromaPath')) {
    New-Item -ItemType Directory -Force -Path '$safeChromaPath' | Out-Null
}
& '$chromaExe' run --path '$safeChromaPath' --host 127.0.0.1 --port 8100
"@

if ($ScrapeOnce) {
    $pipelineScraperCommand = @"
& '$safeActivate'
& '$safePython' run.py pipeline --source all
Write-Host "[Regulatory Scraper] One-time run complete." -ForegroundColor Green
"@
}
else {
    $pipelineScraperCommand = @"
& '$safeActivate'
& '$safePython' run.py pipeline --source all
while (`$true) {
    Write-Host "[Regulatory Scraper] Sleeping for $ScrapeIntervalMinutes minutes..." -ForegroundColor Yellow
    Start-Sleep -Seconds $unSleepSeconds
    & '$safePython' run.py pipeline --source all
}
"@
}

$cyroLogCommand = @"
`$logFile = Join-Path '$repoRoot' `"logs\cyro.ndjson`"
`$logDir  = Join-Path '$repoRoot' `"logs`"
"@ + @'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
if (-not (Test-Path $logFile)) { New-Item -ItemType File -Path $logFile | Out-Null }

Write-Host ""
Write-Host "  +----------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |   CYRO STRUCTURED LOG TERMINAL - LIVE STREAM       |" -ForegroundColor Cyan
Write-Host "  +----------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  Watching: $logFile" -ForegroundColor Gray
Write-Host "  Press Ctrl+C to exit" -ForegroundColor Gray
Write-Host ""

$agentColors = @{
    "agent_1" = "Cyan"; "agent_2" = "Blue"; "agent_3" = "Magenta"; "agent_4" = "Green"; "agent_5" = "Green"
    "agent_6" = "Green"; "agent_7" = "Green"; "agent_8" = "Green"; "agent_9" = "Yellow"; "agent_10" = "White"
    "mistral_client" = "DarkCyan"; "cyro" = "White"
}
$statusColors = @{
    "success" = "Green"; "running" = "Cyan"; "warning" = "Yellow"
    "error" = "Red"; "started" = "Blue"; "completed" = "Green"; "info" = "Gray"
}

function Format-CyroLogLine {
    param([string]$jsonLine)
    try { $r = $jsonLine | ConvertFrom-Json -ErrorAction Stop } catch { return }

    $ts = if ($r.timestamp) { $r.timestamp.Substring(11, 8) } else { "        " }
    $agent = if ($r.agent) { $r.agent.ToUpper() } else { "CYRO" }
    $event = if ($r.event) { $r.event } else { "" }
    $status = if ($r.status) { $r.status } else { "info" }
    $summary = if ($r.summary) { $r.summary } else { "" }
    $duration = if ($r.duration_ms -ne $null) { "(" + $r.duration_ms + "ms)" } else { "" }
    $sec = if ($r.security_id) { " [" + $r.security_id + "]" } else { "" }

    $agentCol = if ($agentColors.ContainsKey($r.agent)) { $agentColors[$r.agent] } else { "White" }
    $statCol = if ($statusColors.ContainsKey($status)) { $statusColors[$status] } else { "Gray" }

    if ($event -in @("llm_call") -and $status -ne "error") { return }

    Write-Host "$ts " -NoNewline -ForegroundColor DarkGray
    Write-Host "[$agent]" -NoNewline -ForegroundColor $agentCol
    if ($sec) { Write-Host $sec -NoNewline -ForegroundColor Gray }
    Write-Host " $event" -NoNewline -ForegroundColor $statCol
    if ($summary) { Write-Host (" | {0}" -f $summary) -NoNewline -ForegroundColor White }
    if ($duration) { Write-Host " $duration" -NoNewline -ForegroundColor DarkGray }

    if ($r.metadata) {
        if ($r.metadata.key_slot) { Write-Host (" slot={0}" -f $r.metadata.key_slot) -NoNewline -ForegroundColor DarkCyan }
        if ($r.metadata.evidence_count) { Write-Host (" evidence={0}" -f $r.metadata.evidence_count) -NoNewline -ForegroundColor DarkGray }
    }
    Write-Host ""
}

$position = (Get-Item $logFile -ErrorAction SilentlyContinue).Length
if ($position -eq $null) { $position = 0 }
while ($true) {
    $currentSize = (Get-Item $logFile -ErrorAction SilentlyContinue).Length
    if ($currentSize -ne $null -and $currentSize -gt $position) {
        $stream = [System.IO.File]::Open($logFile, 'Open', 'Read', 'ReadWrite')
        $stream.Seek($position, [System.IO.SeekOrigin]::Begin) | Out-Null
        $reader = New-Object System.IO.StreamReader($stream)
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ($line.Trim()) { Format-CyroLogLine -jsonLine $line }
        }
        $position = $stream.Position
        $reader.Close()
        $stream.Close()
    }
    Start-Sleep -Milliseconds 250
}
'@

Start-ServiceTerminal -Title "FinPilot ChromaDB Vector DB (8100)" -WorkingDirectory $indiaTradeCliDir -Command $chromaCommand
Start-ServiceTerminal -Title "FinPilot Frontend (3000)" -WorkingDirectory $frontendDir -Command $frontendCommand
Start-ServiceTerminal -Title "FinPilot CYRO Engine (8765)" -WorkingDirectory $indiaTradeCliDir -Command $indiaTradeCliCommand
Start-ServiceTerminal -Title "FinPilot News Feed Backend (8002)" -WorkingDirectory $newsFeedDir -Command $newsFeedCommand
Start-ServiceTerminal -Title "FinPilot Paper Trading Backend (8001)" -WorkingDirectory $paperTradingDir -Command $paperTradingCommand
Start-ServiceTerminal -Title "FinPilot Regulatory API (8000)" -WorkingDirectory $scrapperDir -Command $regulatoryApiCommand
Start-ServiceTerminal -Title "FinPilot Screener API (8003)" -WorkingDirectory $scrapperDir -Command $screenerApiCommand
Start-ServiceTerminal -Title "FinPilot Regulatory Scraper" -WorkingDirectory $scrapperDir -Command $pipelineScraperCommand
Start-ServiceTerminal -Title "CYRO Structured Log Viewer" -WorkingDirectory $repoRoot -Command $cyroLogCommand

Write-Host "Launched all services in separate terminals:" -ForegroundColor Green
Write-Host "1. ChromaDB Vector DB  -> http://localhost:8100  (RAG/embeddings)"
Write-Host "2. Frontend            -> http://localhost:3000"
Write-Host "3. CYRO Engine         -> http://localhost:8765"
Write-Host "4. News Feed backend   -> http://localhost:8002"
Write-Host "5. Paper Trading       -> http://localhost:8001"
Write-Host "6. Regulatory API      -> http://localhost:8000"
Write-Host "7. Screener API        -> http://localhost:8003"
Write-Host "8. Regulatory scraper  -> pipeline all at startup, then recurring"
Write-Host "9. CYRO Log Viewer     -> logs/cyro.ndjson viewer"
Write-Host ""
Write-Host "ChromaDB data path: $chromaDbPath" -ForegroundColor DarkGray
Write-Host "(Override via env: `$env:CHROMA_DB_PATH = 'D:\your\path')" -ForegroundColor DarkGray
