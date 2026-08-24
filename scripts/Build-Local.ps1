param(
  [switch]$Install,
  [ValidateSet('x64', 'arm64')]
  [string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
  npm ci
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed with exit code $LASTEXITCODE"
  }
}

npm run build
if ($LASTEXITCODE -ne 0) {
  throw "npm run build failed with exit code $LASTEXITCODE"
}

npm run electron:build -- --win --$Architecture --publish never
if ($LASTEXITCODE -ne 0) {
  throw "Electron packaging failed with exit code $LASTEXITCODE"
}

$installer = Get-ChildItem -Path (Join-Path $repoRoot 'release') -Filter '*.exe' -File |
  Where-Object { $_.Name -notmatch 'uninstaller' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw 'No Windows installer was found in release/.'
}

Write-Host "Installer: $($installer.FullName)" -ForegroundColor Green

if ($Install) {
  Write-Host 'Starting the installer. Close the running PaperQuay app first if it is open.' -ForegroundColor Yellow
  Start-Process -FilePath $installer.FullName -Wait
}
