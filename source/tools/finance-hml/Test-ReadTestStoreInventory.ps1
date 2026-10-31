$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Read-TestStoreInventory.ps1')
$script:FixtureMode = 'complete'
$script:SourceReads = 0
$script:PageReads = 0
$script:Model = 'F1ediJCWm8kmUKy3vTK1'
function Assert-Inventory($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-InventoryPage([string]$Project, [string]$CollectionPath, [string[]]$Fields, [string]$PageToken) {
  $script:PageReads++
  if ($script:FixtureMode -eq 'repeated') { return [pscustomobject]@{documents=@(); nextPageToken='repeated'} }
  if ($CollectionPath -eq 'stores' -and $Project -eq 'store-connect-app') {
    $script:SourceReads++
    Assert-Inventory (($Fields -join ',') -eq 'isTestStore,testOnly,environment') 'Projection expanded to private fields'
    if (-not $PageToken) {
      return [pscustomobject]@{documents=@([pscustomobject]@{name=('projects/store-connect-app/databases/(default)/documents/stores/' + $script:Model);
        createTime='synthetic-time'; updateTime='synthetic-time'; fields=@{document=@{stringValue='private-cpf-fixture'};name=@{stringValue='private-person'}}}); nextPageToken='second'}
    }
    return [pscustomobject]@{documents=@([pscustomobject]@{name='projects/store-connect-app/databases/(default)/documents/stores/synthetic-store';
      createTime='synthetic-time';updateTime='synthetic-time';fields=@{isTestStore=@{booleanValue=$true};phone=@{stringValue='private-phone-fixture'}}})}
  }
  if ($CollectionPath -eq 'stores') { return [pscustomobject]@{documents=@([pscustomobject]@{name=('projects/store-connect-hml/databases/(default)/documents/stores/' + $script:Model)})} }
  if ($CollectionPath -like 'hmlMigrationArchives/*/historicalDocuments') {
    return [pscustomobject]@{documents=@(1..318 | ForEach-Object {[pscustomobject]@{name=('synthetic-archive-' + $_)}})}
  }
  throw 'Unexpected collection requested; no network fallback allowed'
}
$output = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../../build/inventory-fixture-' + [Guid]::NewGuid().ToString('N') + '.json')))
Write-TestStoreInventory @() $output
$raw = [IO.File]::ReadAllText($output)
$value = $raw | ConvertFrom-Json
Assert-Inventory ($value.sourceStores -eq 2 -and $script:SourceReads -eq 2) 'Pagination/count lost'
Assert-Inventory ($value.confirmedExclusiveTestStores -eq 0) 'Marker became authorization'
Assert-Inventory ($value.modelCheckpoint.archivedHistoricalCount -eq 318 -and $value.stores[0].modelExcluded) 'Model exclusion/checkpoint failed'
Assert-Inventory ($raw -notmatch 'private-cpf|private-person|private-phone|Bearer|synthetic-store') 'Private field or raw identity leaked'
$refused = $false
try { Write-TestStoreInventory @($script:Model) ($output + '.model.json') } catch { $refused = $true }
Assert-Inventory $refused 'Model was not excluded from review list'
$script:FixtureMode = 'repeated'
$refused = $false
try { Write-TestStoreInventory @() ($output + '.partial.json') } catch { $refused = $true }
Assert-Inventory ($refused -and -not (Test-Path -LiteralPath ($output + '.partial.json'))) 'Partial inventory emitted'
Write-Output 'PASS 6/6 — pagination; classification pending; Model exclusion/archive; privacy; no Model review; no partial output. Synthetic fixtures only; no remote calls.'
