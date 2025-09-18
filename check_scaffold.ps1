<#
.SYNOPSIS
  Sanity check for OTT scaffold files and git repo status.

.USAGE
  Open PowerShell, cd to your project root and run:
    .\check_scaffold.ps1

  The script will report which files/folders exist and print the next recommended commands.
#>

function Test-PathHuman {
  param($p)
  if (Test-Path $p) { Write-Host "OK  -" -ForegroundColor Green $p } else { Write-Host "MISSING -" -ForegroundColor Yellow $p }
}

Write-Host "=== OTT Scaffold & Git sanity check ===" -ForegroundColor Cyan
$root = Get-Location

# 1) Git repo check
if (Test-Path ".git") {
  Write-Host "[GIT] .git directory FOUND — you are in a git repository." -ForegroundColor Green
  $inGit = $true
} else {
  Write-Host "[GIT] .git directory NOT found — you are NOT in a git repository." -ForegroundColor Yellow
  $inGit = $false
}

Write-Host "`nChecking key scaffold paths under $root ..." -ForegroundColor Cyan

# 2) Files & folders to check
$checks = @(
  "functions",
  "functions/api/create-payment.js",
  "functions/payment/webhook.js",
  "functions/payment/success.js",
  "functions/api/get-free-url.js",
  "functions/api/verify-proof.js",
  "public\data\clips.json",
  "lib\player.js",
  "migrations\001_init.sql",
  "ott_scaffold_full.zip",
  ".gitattributes"
)

$found = @{}
foreach ($p in $checks) {
  $exists = Test-Path $p
  $found[$p] = $exists
  if ($exists) {
    Write-Host "  [OK]    $p" -ForegroundColor Green
  } else {
    Write-Host "  [MISSING] $p" -ForegroundColor Yellow
  }
}

# 3) Summary & suggestions
Write-Host "`n=== Summary & Next Steps ===" -ForegroundColor Cyan

if (-not $inGit) {
  Write-Host "`nYou are not in a Git repo. If you want to push to GitHub, do one of the following:" -ForegroundColor Yellow
  Write-Host "A) If you forked the template, clone your fork and run this script inside the clone."
  Write-Host "   Example (replace <your-username>):"
  Write-Host "     git clone https://github.com/<your-username>/netflix-clone-nextjs.git"
  Write-Host "     cd netflix-clone-nextjs"
  Write-Host "     Copy or move the scaffold files into this folder and run `.\check_scaffold.ps1` again."
  Write-Host ""
  Write-Host "B) Or initialize a new repo here (if starting fresh):"
  Write-Host "     git init"
  Write-Host "     git add ."
  Write-Host "     git commit -m 'Initial commit: add OTT scaffold'"
  Write-Host "     git remote add origin https://github.com/<your-username>/<repo>.git"
  Write-Host "     git
