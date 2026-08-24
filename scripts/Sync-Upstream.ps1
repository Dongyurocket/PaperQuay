param(
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

$status = git status --porcelain
if ($status) {
  throw 'Working tree is not clean. Commit or stash changes before syncing upstream.'
}

$remotes = @(git remote)
if ($remotes -notcontains 'upstream' -or $remotes -notcontains 'origin') {
  throw 'Both upstream and origin remotes are required. Run Configure-Fork.ps1 first.'
}

Invoke-Git fetch upstream --prune
Invoke-Git fetch origin --prune
Invoke-Git switch $BaseBranch
Invoke-Git pull --ff-only origin $BaseBranch
Invoke-Git merge --ff-only "upstream/$BaseBranch"
Invoke-Git push origin $BaseBranch

Write-Host "Synchronized $BaseBranch with upstream and pushed to origin." -ForegroundColor Green
