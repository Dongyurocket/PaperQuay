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

# D8-11：sqlite-vec 0.1.9 只有 windows-x64 原生扩展，没有 windows-arm64。
# 显式拒绝并说明原因，避免打包到 afterPack 才失败。
if ($Architecture -ne 'x64') {
  throw "Windows $Architecture is not supported: sqlite-vec 0.1.9 publishes only sqlite-vec-windows-x64. Use -Architecture x64, or add an in-process vector fallback before enabling Windows arm64 builds."
}

# electron:build 已经包含 npm run build（typecheck + vite build），这里不再重复构建前端。
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
