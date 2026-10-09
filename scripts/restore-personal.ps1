param([Parameter(Mandatory=$true)][string]$Backup,[Parameter(Mandatory=$true)][switch]$ConfirmStop,[string]$ComposeFile='')
$ErrorActionPreference='Stop'
if(!$ConfirmStop){throw 'Restore briefly stops Chainflow. Pass -ConfirmStop after approving downtime.'}
$projectRoot=Split-Path $PSScriptRoot -Parent
if(!$ComposeFile){$ComposeFile=Join-Path $projectRoot 'compose.yaml'}
$ComposeFile=[IO.Path]::GetFullPath($ComposeFile)
Push-Location $projectRoot
try {
  $source=[IO.Path]::GetFullPath($Backup)
  foreach($name in @('personal.sqlite','auth.json','master-key','manifest.json')){if(!(Test-Path -LiteralPath (Join-Path $source $name))){throw "Missing backup file: $name"}}
  $snapshot='/tmp/chainflow-restore-'+[Guid]::NewGuid().ToString('N')
  $container=(docker compose -f $ComposeFile ps -q app).Trim()
  docker compose -f $ComposeFile exec -T app mkdir $snapshot
  node "$PSScriptRoot\docker-archive.mjs" push $container $snapshot $source
  if($LASTEXITCODE -ne 0){throw 'Could not stage backup.'}
  docker compose -f $ComposeFile exec -T app node /app/dist-docker/personal-backup.mjs verify $snapshot
  if($LASTEXITCODE -ne 0){throw 'Backup verification failed; live data unchanged.'}
  $before=Join-Path $projectRoot ('local-only\backups\before-restore-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
  & "$PSScriptRoot\backup-personal.ps1" -Destination $before -ComposeFile $ComposeFile
  $composeConfig=docker compose -f $ComposeFile config --format json | ConvertFrom-Json
  $keyPath=$composeConfig.secrets.chainflow_master_key.file
  if(!$keyPath){throw 'Could not resolve the configured master key file.'}
  # Docker is stopped before copying a SQLite file; live WAL files are archived too.
  docker compose -f $ComposeFile stop app
  if($LASTEXITCODE -ne 0){throw 'Could not stop Chainflow.'}
  $stateBackup='before-restore-'+[Guid]::NewGuid().ToString('N')
  docker compose -f $ComposeFile run --rm --no-deps -T --entrypoint node app --input-type=module -e 'import {mkdir,rename} from "node:fs/promises"; const root="/data/chainflow",dest=root+"/"+process.argv[1];await mkdir(dest,{mode:0o700});for(const name of ["personal.sqlite","personal.sqlite-wal","personal.sqlite-shm","auth.json"]){try{await rename(root+"/"+name,dest+"/"+name);}catch(e){if(e.code!=="ENOENT")throw e;}}' $stateBackup
  if($LASTEXITCODE -ne 0){throw 'Could not archive current volume data; container remains stopped.'}
  # docker cp preserves the volume in the stopped app container.
  foreach($name in @('personal.sqlite','auth.json')){docker cp (Join-Path $source $name) "$($container):/data/chainflow/$name";if($LASTEXITCODE -ne 0){throw 'Restore copy failed; container remains stopped.'}}
  Copy-Item -LiteralPath (Join-Path $source 'master-key') -Destination $keyPath
  docker compose -f $ComposeFile run --rm --no-deps -T --user root --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --entrypoint sh app -c 'chown node:node /data/chainflow/personal.sqlite /data/chainflow/auth.json; chmod 600 /data/chainflow/personal.sqlite /data/chainflow/auth.json'
  if($LASTEXITCODE -ne 0){throw 'Restore file permission repair failed.'}
  docker compose -f $ComposeFile up -d --no-deps app
  if($LASTEXITCODE -ne 0){throw 'Restored but startup failed; previous backup is retained.'}
  Write-Output "Restored. Previous full backup: $before. Refresh all browsers before editing."
}finally{Pop-Location}
