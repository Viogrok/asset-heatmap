$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

# Sites retains the original source history. GitHub receives committed source
# snapshots with a GitHub noreply author, without publishing a private email.
function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $result = & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Git command failed; GitHub backup was not completed.' }
    return $result
}
$remoteUrl = Invoke-Git remote get-url github
if ($remoteUrl -ne 'https://github.com/Viogrok/asset-heatmap.git') { throw 'Unexpected GitHub backup remote.' }
$repository = & gh repo view Viogrok/asset-heatmap --json isPrivate | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $repository.isPrivate) { throw 'The source backup must remain private.' }
$account = & gh api user | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $account.login -ne 'Viogrok') { throw 'Unexpected GitHub account.' }

Invoke-Git fetch --no-tags github main | Out-Null
$parent = Invoke-Git rev-parse FETCH_HEAD
$known = Invoke-Git rev-parse refs/asset-map/github-backup
if ($parent -ne $known) { throw 'GitHub changed since the last backup. Review the remote changes before syncing.' }
$source = Invoke-Git rev-parse HEAD
$tree = Invoke-Git rev-parse 'HEAD^{tree}'
$remoteTree = Invoke-Git rev-parse "$parent`^{tree}"
if ($tree -eq $remoteTree) { Write-Output 'GitHub already contains this committed source tree.'; exit 0 }

$email = "$($account.id)+$($account.login)@users.noreply.github.com"
$message = "Source snapshot for private GitHub backup (Sites source $source)"
$snapshot = $message | & git -c "user.name=$($account.login)" -c "user.email=$email" commit-tree $tree -p $parent
if ($LASTEXITCODE -ne 0) { throw 'Unable to create source snapshot.' }
Invoke-Git push github "${snapshot}:refs/heads/main" | Out-Null
Invoke-Git update-ref refs/asset-map/github-backup $snapshot | Out-Null
Write-Output "Private GitHub backup complete: https://github.com/Viogrok/asset-heatmap/commit/$snapshot"
