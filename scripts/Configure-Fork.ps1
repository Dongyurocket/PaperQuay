param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9-]+$')]
  [string]$ForkOwner,
  [string]$Repository = 'PaperQuay',
  [string]$BaseBranch = 'main'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$upstreamUrl = "https://github.com/WangQrkkk/$Repository.git"
$originUrl = "https://github.com/$ForkOwner/$Repository.git"

Invoke-Git rev-parse --show-toplevel | Out-Null

$remotes = @(git remote)
if ($remotes -contains 'origin') {
  $originCurrent = git remote get-url origin
  if ($originCurrent -match 'github\.com[/:]WangQrkkk/PaperQuay(?:\.git)?$') {
    if ($remotes -contains 'upstream') {
      Invoke-Git remote remove upstream
    }
    Invoke-Git remote rename origin upstream
  }
}

$remotes = @(git remote)
if ($remotes -contains 'upstream') {
  Invoke-Git remote set-url upstream $upstreamUrl
} else {
  Invoke-Git remote add upstream $upstreamUrl
}

$remotes = @(git remote)
if ($remotes -contains 'origin') {
  Invoke-Git remote set-url origin $originUrl
} else {
  Invoke-Git remote add origin $originUrl
}

Invoke-Git fetch origin $BaseBranch
$localBranchExists = git branch --list $BaseBranch
if ($localBranchExists) {
  Invoke-Git branch --set-upstream-to "origin/$BaseBranch" $BaseBranch
}

node (Join-Path $PSScriptRoot 'configure-fork.mjs') $ForkOwner $Repository

Write-Host ''
Write-Host 'Fork configuration completed.' -ForegroundColor Green
Write-Host "upstream: $upstreamUrl"
Write-Host "origin:   $originUrl"
Write-Host ''
Write-Host 'Next steps:'
Write-Host "  git fetch upstream"
Write-Host "  git switch $BaseBranch"
Write-Host "  .\scripts\Sync-Upstream.ps1"
Write-Host '  git status --short'
