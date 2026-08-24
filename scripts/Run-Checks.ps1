$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

npm run build
if ($LASTEXITCODE -ne 0) {
  throw "npm run build failed with exit code $LASTEXITCODE"
}

npm test
if ($LASTEXITCODE -ne 0) {
  throw "npm test failed with exit code $LASTEXITCODE"
}

Write-Host 'Build and tests passed.' -ForegroundColor Green
