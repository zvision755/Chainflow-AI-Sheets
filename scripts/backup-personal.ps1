param([Parameter(Mandatory=$true)][string]$Destination,[string]$ComposeFile='')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
if(!$ComposeFile){$ComposeFile=Join-Path $projectRoot 'compose.yaml'}
$ComposeFile=[IO.Path]::GetFullPath($ComposeFile)
Push-Location $projectRoot
try {
  $target=[IO.Path]::GetFullPath($Destination)
  if(Test-Path -LiteralPath $target){throw 'Choose a new backup directory; existing files will not be overwritten.'}
  $snapshot='/tmp/chainflow-backup-'+[Guid]::NewGuid().ToString('N')
  docker compose -f $ComposeFile exec -T app node /app/dist-docker/personal-backup.mjs backup $snapshot
  if($LASTEXITCODE -ne 0){throw 'Snapshot or verification failed.'}
  $container=(docker compose -f $ComposeFile ps -q app).Trim()
  New-Item -ItemType Directory -Path $target | Out-Null
  $ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  icacls $target /inheritance:r /grant:r "*$($ownerSid):(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not restrict backup permissions.'}
  node "$PSScriptRoot\docker-archive.mjs" fetch $container $snapshot $target
  if($LASTEXITCODE -ne 0){throw 'Could not copy snapshot.'}
  Write-Output "Verified backup saved to $target. Keep database, auth.json, manifest.json and master-key together."
}finally{Pop-Location}
