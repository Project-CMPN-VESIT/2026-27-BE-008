[CmdletBinding()]
param(
    [ValidateRange(1, 1440)]
    [int]$ScrapeIntervalMinutes = 30,
    [switch]$ScrapeOnce,
    [string]$MistralApiKey
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
$activateScript = Join-Path $repoRoot ".venv\Scripts\Activate.ps1"
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

Start-ServiceTerminal -Title "FinPilot Frontend (3000)" -WorkingDirectory $frontendDir -Command $frontendCommand
Start-ServiceTerminal -Title "FinPilot CYRO Engine (8765)" -WorkingDirectory $indiaTradeCliDir -Command $indiaTradeCliCommand
Start-ServiceTerminal -Title "FinPilot News Feed Backend (8002)" -WorkingDirectory $newsFeedDir -Command $newsFeedCommand
Start-ServiceTerminal -Title "FinPilot Paper Trading Backend (8001)" -WorkingDirectory $paperTradingDir -Command $paperTradingCommand
Start-ServiceTerminal -Title "FinPilot Regulatory API (8000)" -WorkingDirectory $scrapperDir -Command $regulatoryApiCommand
Start-ServiceTerminal -Title "FinPilot Screener API (8003)" -WorkingDirectory $scrapperDir -Command $screenerApiCommand
Start-ServiceTerminal -Title "FinPilot Regulatory Scraper" -WorkingDirectory $scrapperDir -Command $pipelineScraperCommand

Write-Host "Launched all services in separate terminals:" -ForegroundColor Green
Write-Host "1. Frontend            -> http://localhost:3000"
Write-Host "2. CYRO Engine         -> http://localhost:8765"
Write-Host "3. News Feed backend   -> http://localhost:8002"
Write-Host "4. Paper Trading       -> http://localhost:8001"
Write-Host "5. Regulatory API      -> http://localhost:8000"
Write-Host "6. Screener API        -> http://localhost:8003"
Write-Host "7. Regulatory scraper  -> pipeline all at startup, then recurring"
