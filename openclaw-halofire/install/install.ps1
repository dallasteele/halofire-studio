# OpenClaw-HaloFire — Windows install (PowerShell)
# Prereqs: Python 3.12+, Node 22+, bun, Ollama
# Usage:   .\install.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "[openclaw] root = $Root"

# 1. Pre-pull Gemma (the only LLM HaloFire runs)
Write-Host "[openclaw] pulling gemma3:4b via Ollama..."
ollama pull gemma3:4b | Out-Null

# 2. Python deps for the runtime + pricing sync
Write-Host "[openclaw] installing Python deps..."
pip install --quiet duckdb openpyxl pdfplumber beautifulsoup4

# 3. Seed the pricing DB if empty
$DbPath = Join-Path $Root "..\services\halofire-cad\pricing\supplies.duckdb"
if (-not (Test-Path $DbPath)) {
  Write-Host "[openclaw] seeding pricing DB..."
  python (Join-Path $Root "..\services\halofire-cad\pricing\seed.py")
}

# 4. Validate the module registry parses
Write-Host "[openclaw] validating modules..."
python (Join-Path $Root "bin\openclaw") --root $Root list

# 5. Register a Windows service (optional)
$svc = Read-Host "Register 'OpenClaw-HaloFire' as a Windows service? (y/N)"
if ($svc -eq "y") {
  $A = New-ScheduledTaskAction -Execute "python.exe" `
    -Argument "`"$Root\bin\openclaw`" --root `"$Root`" start"
  $T = New-ScheduledTaskTrigger -AtStartup
  $P = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
  Register-ScheduledTask -TaskName "OpenClaw-HaloFire" `
    -Action $A -Trigger $T -Principal $P -Force
  Write-Host "[openclaw] installed as scheduled task 'OpenClaw-HaloFire'"
}

Write-Host "[openclaw] done. start with:  python $Root\bin\openclaw --root $Root start"
