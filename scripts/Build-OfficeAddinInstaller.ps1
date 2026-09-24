<#
.SYNOPSIS
  编译 PaperQuay Word 加载项的 exe 安装器（office-addin/installer/PaperQuayOfficeAddinInstaller.cs）。

.DESCRIPTION
  用 Windows 自带的 .NET Framework 4.x csc.exe 编译，无需安装 .NET SDK 或 Visual Studio：
    1. 定位 csc.exe（-CscPath → Framework64 → Framework → PATH）；
    2. 把 office-addin/manifest.xml 与 assets/icon-80.png 以嵌入资源打进 exe
       （资源名 PQAddin.manifest.xml / PQAddin.icon.png，与源码常量一致）；
    3. 输出 release/PaperQuay-OfficeAddin-Setup-<版本>.exe（版本号取自 package.json，可用 -Version 覆盖）。

  源码刻意只使用 C# 5 语法（Framework 自带编译器的上限），引用 System / System.Core /
  System.Drawing / System.Windows.Forms 四个程序集；public/icon.ico 作为 exe 文件图标。

.EXAMPLE
  pwsh -File scripts/Build-OfficeAddinInstaller.ps1
  pwsh -File scripts/Build-OfficeAddinInstaller.ps1 -Version 0.2.1 -Output release\installer.exe
#>
[CmdletBinding()]
param(
  [string]$Version,
  [string]$Output,
  [string]$CscPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$source = Join-Path $root 'office-addin\installer\PaperQuayOfficeAddinInstaller.cs'
$manifest = Join-Path $root 'office-addin\manifest.xml'
$iconPng = Join-Path $root 'office-addin\assets\icon-80.png'
$iconIco = Join-Path $root 'public\icon.ico'

foreach ($pair in @(@($source, '安装器源码'), @($manifest, 'office-addin\manifest.xml（先运行 npm run office-addin:build）'), @($iconPng, 'office-addin\assets\icon-80.png（先运行 npm run office-addin:build）'))) {
  if (-not (Test-Path -LiteralPath $pair[0])) { throw "缺少 $($pair[1])：$($pair[0])" }
}

if (-not $Version) {
  $pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $Version = [string]$pkg.version
}
if (-not $Output) {
  $Output = Join-Path $root "release\PaperQuay-OfficeAddin-Setup-$Version.exe"
}

if (-not $CscPath) {
  $candidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { $CscPath = $candidate; break }
  }
  if (-not $CscPath) {
    $onPath = Get-Command csc.exe -ErrorAction SilentlyContinue
    if ($onPath) { $CscPath = $onPath.Source }
  }
}
if (-not $CscPath -or -not (Test-Path -LiteralPath $CscPath)) {
  throw '找不到 csc.exe：请确认存在 .NET Framework 4.x（Windows 自带），或用 -CscPath 指定编译器路径。'
}

$outputDir = Split-Path -Parent $Output
if ($outputDir) { New-Item -ItemType Directory -Force -Path $outputDir | Out-Null }

Write-Host "[1/2] 编译安装器（csc：$CscPath）"
$arguments = @(
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  '/utf8output',
  "/out:$Output",
  "/resource:$manifest,PQAddin.manifest.xml",
  "/resource:$iconPng,PQAddin.icon.png",
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll'
)
if (Test-Path -LiteralPath $iconIco) { $arguments += "/win32icon:$iconIco" }
$arguments += $source

& $CscPath @arguments
if ($LASTEXITCODE -ne 0) { throw "csc 编译失败（退出码 $LASTEXITCODE）" }

Write-Host '[2/2] 校验嵌入资源'
Add-Type -AssemblyName System.Reflection | Out-Null
$assembly = [System.Reflection.Assembly]::ReflectionOnlyLoadFrom((Resolve-Path -LiteralPath $Output).Path)
$resourceNames = $assembly.GetManifestResourceNames()
foreach ($expected in @('PQAddin.manifest.xml', 'PQAddin.icon.png')) {
  if ($resourceNames -notcontains $expected) { throw "exe 内缺少嵌入资源 $expected（实际：$($resourceNames -join ', ')）" }
}

$size = '{0:N1} KB' -f ((Get-Item -LiteralPath $Output).Length / 1KB)
Write-Host "安装器已生成：$Output（$size，版本 $Version）"
Write-Host '用法：双击运行图形界面；或加 --silent 静默安装、--diagnose 只诊断、--uninstall 卸载、--help 查看全部参数。'
