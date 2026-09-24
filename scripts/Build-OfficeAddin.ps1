<#
.SYNOPSIS
  构建 PaperQuay Word 加载项静态资源（共享引用模块 bundle + 清单图标）。

.DESCRIPTION
  只构建 office-addin 需要的产物，不触发主应用构建：
    1. scripts/build-citation.mjs --addin-only  → office-addin/dist/citation-shared.js
    2. scripts/generate-office-addin-icons.mjs  → office-addin/assets/icon-{16,32,64,80}.png
    3. 校验必需文件存在且 manifest.xml 可解析

.EXAMPLE
  pwsh -File scripts/Build-OfficeAddin.ps1
  pwsh -File scripts/Build-OfficeAddin.ps1 -SkipIcons
#>
[CmdletBinding()]
param(
  [switch]$SkipIcons
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  Write-Host '[1/3] 构建共享引用模块 → office-addin/dist/citation-shared.js'
  node scripts/build-citation.mjs --addin-only
  if ($LASTEXITCODE -ne 0) { throw 'build-citation.mjs 执行失败' }

  if (-not $SkipIcons) {
    Write-Host '[2/3] 生成清单图标 → office-addin/assets/icon-*.png'
    node scripts/generate-office-addin-icons.mjs
    if ($LASTEXITCODE -ne 0) { throw 'generate-office-addin-icons.mjs 执行失败' }
  } else {
    Write-Host '[2/3] 已跳过图标生成'
  }

  Write-Host '[3/3] 校验加载项资源'
  $required = @(
    'manifest.xml',
    'taskpane.html',
    'taskpane.css',
    'taskpane.js',
    'commands.html',
    'dist/citation-shared.js',
    'assets/icon-16.png',
    'assets/icon-32.png',
    'assets/icon-80.png'
  )
  $missing = @()
  foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path 'office-addin' $relative))) { $missing += $relative }
  }
  if ($missing.Count -gt 0) { throw "缺少加载项文件：$($missing -join ', ')" }

  try {
    [xml](Get-Content -LiteralPath 'office-addin/manifest.xml' -Raw) | Out-Null
  } catch {
    throw "manifest.xml 解析失败：$($_.Exception.Message)"
  }

  Write-Host '加载项构建完成。下一步：pwsh -File scripts/office-addin-server.mjs 或 npm run office-addin:serve'
} finally {
  Pop-Location
}
