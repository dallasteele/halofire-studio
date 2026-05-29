# HaloFire internal-alpha one-command verifier.
# Seeds a temp DB, runs the full focused test suite (which includes a live
# spawned-server smoke in evidence-api.test.js: login + claim gates stay
# blocked + auto-bid), and runs the workspace agentic-rules check.
#
# NOTE: live-API behavior is verified inside evidence-api.test.js (Node spawns
# the server with explicit env). We do NOT start a server from PowerShell here
# because Windows PowerShell 5.1 Start-Process does not reliably propagate
# session $env: vars to the child, which made an ad-hoc smoke unreliable.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-internal-alpha.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:HALOFIRE_ADMIN_USER = "admin"
$env:HALOFIRE_ADMIN_PASSWORD = "verify-internal-alpha"
$env:HALOFIRE_ALLOW_DEV_DEFAULTS = "0"
$tmpDb = Join-Path $env:TEMP ("halofire-verify-" + [System.Guid]::NewGuid().ToString("N") + ".db")
$env:HALOFIRE_DB_PATH = $tmpDb

try {
  Write-Host "== Seeding temp DB =="
  node src/db/seed.js

  Write-Host "== Verifying seeded evidence + claim gates =="
  node -e "const D=require('better-sqlite3');const d=new D(process.env.HALOFIRE_DB_PATH);const g=d.prepare('SELECT COUNT(*) c FROM claim_gates').get().c;const e=d.prepare('SELECT COUNT(*) c FROM project_evidence').get().c;if(g<5||e<5)throw new Error('expected >=5 gates and >=5 evidence, got '+g+'/'+e);console.log('  gates='+g+' evidence='+e)"

  Write-Host "== Unit/integration tests (incl. live-server evidence-api smoke) =="
  npx vitest run tests/bid-package.test.js tests/bid-log-importer.test.js tests/pricebook-importer.test.js tests/evidence-gates.test.js tests/evidence-api.test.js tests/api-security.test.js tests/seed-source-data.test.js tests/sprinkler-layout.test.js tests/geometry.test.js tests/pricebook-pricing.test.js tests/floorplan-import.test.js
  if ($LASTEXITCODE -ne 0) { throw "vitest failed" }
} finally {
  Remove-Item "$tmpDb*" -Force -ErrorAction SilentlyContinue
}

Write-Host "== Agentic rules =="
& C:/Python312/python.exe E:/ClaudeBot/scripts/verify_agentic_rules.py

Write-Host "== HaloFire internal-alpha verification PASSED =="
