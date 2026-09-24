<#
.SYNOPSIS
  把 PaperQuay Word 加载项侧载到本机 Word（Windows）。

.DESCRIPTION
  使用 Office 开发者侧载机制：在 HKCU\Software\Microsoft\Office\16.0\WEF\Developer
  下写入一条指向清单文件的注册表值。Word 启动时会读取该键并把加载项加入「我的加载项」。

  优先使用 office-addin\manifest.local.xml（由 scripts/office-addin-server.mjs 按实际
  scheme/端口生成）；不存在时退回 office-addin\manifest.xml。

.EXAMPLE
  pwsh -File scripts/Install-OfficeAddin.ps1
  pwsh -File scripts/Install-OfficeAddin.ps1 -Uninstall
  pwsh -File scripts/Install-OfficeAddin.ps1 -Manifest C:\path\to\manifest.xml
#>
[CmdletBinding()]
param(
  [string]$Manifest,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$registryPath = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'
$valueName = 'PaperQuayOfficeAddin'

if ($Uninstall) {
  if (Test-Path $registryPath) {
    $existing = Get-ItemProperty -Path $registryPath -Name $valueName -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
      Remove-ItemProperty -Path $registryPath -Name $valueName
      Write-Host "已移除侧载项：$valueName"
    } else {
      Write-Host "未找到侧载项：$valueName"
    }
  } else {
    Write-Host '未找到 Office 开发者注册表键，无需卸载。'
  }
  Write-Host '重启 Word 后加载项将从列表中消失。'
  return
}

if (-not $Manifest) {
  $localManifest = Join-Path $root 'office-addin\manifest.local.xml'
  $Manifest = if (Test-Path -LiteralPath $localManifest) { $localManifest } else { Join-Path $root 'office-addin\manifest.xml' }
}

if (-not (Test-Path -LiteralPath $Manifest)) {
  throw "找不到清单文件：$Manifest（先运行 npm run office-addin:build）"
}

$resolved = (Resolve-Path -LiteralPath $Manifest).Path
try {
  [xml](Get-Content -LiteralPath $resolved -Raw) | Out-Null
} catch {
  throw "清单不是合法 XML：$($_.Exception.Message)"
}

New-Item -Path $registryPath -Force | Out-Null
New-ItemProperty -Path $registryPath -Name $valueName -Value $resolved -PropertyType String -Force | Out-Null

Write-Host "已侧载 PaperQuay Word 加载项："
Write-Host "  清单：$resolved"
Write-Host ''
Write-Host '接下来：'
Write-Host '  1) 保持源站运行：npm run office-addin:serve（默认 https://localhost:3000）'
Write-Host '  2) 完全退出并重启 Word'
Write-Host '  3) 「开始」选项卡 → PaperQuay 组 → 「插入引用」打开任务窗格'
Write-Host '  4) 在 PaperQuay「文库设置 → Word 加载项」复制连接信息，粘贴进任务窗格'
Write-Host ''
Write-Host '卸载：pwsh -File scripts/Install-OfficeAddin.ps1 -Uninstall'
