[CmdletBinding()]
param(
  [string[]]$ReviewStoreIds = @(),
  [string]$OutputPath = (Join-Path $PSScriptRoot '../../build/hml-test-store-inventory.json')
)

# GET only. No export of user/customer/payment payloads, Auth or credentials.
# A test marker is a candidate hint, never proof of exclusive test ownership.
$ErrorActionPreference = 'Stop'
$script:InventoryTokens = @{}
function Get-InventoryHash([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Get-InventoryPage([string]$Project, [string]$CollectionPath, [string[]]$Fields, [string]$PageToken) {
  if ($Project -notin @('store-connect-app','store-connect-hml')) { throw 'Projeto nao autorizado para inventario.' }
  if (-not $script:InventoryTokens.ContainsKey($Project)) {
    $captured = & gcloud.cmd auth print-access-token --project=$Project --quiet 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $captured) { throw 'Sem autenticacao de leitura disponivel.' }
    $script:InventoryTokens[$Project] = ($captured -join '').Trim()
  }
  $query = 'pageSize=100'
  foreach ($field in $Fields) { $query += '&mask.fieldPaths=' + [Uri]::EscapeDataString($field) }
  if ($PageToken) { $query += '&pageToken=' + [Uri]::EscapeDataString($PageToken) }
  $uri = 'https://firestore.googleapis.com/v1/projects/' + $Project + '/databases/(default)/documents/' + $CollectionPath + '?' + $query
  try {
    return Invoke-RestMethod -Method Get -Uri $uri -Headers @{Authorization=('Bearer ' + $script:InventoryTokens[$Project])}
  } catch {
    $httpStatus = 0
    if ($_.Exception.Response) { $httpStatus = [int]$_.Exception.Response.StatusCode }
    throw ('Leitura Firestore recusada ou indisponivel; projeto=' + $Project + '; HTTP=' + $httpStatus + '. Inventario NAO concluido; nenhum payload/credencial exportado.')
  }
}
function Read-InventoryCollection([string]$Project, [string]$CollectionPath, [string[]]$Fields = @('hmlInventoryMetadataOnlyV1')) {
  $rows = New-Object 'System.Collections.Generic.List[object]'
  $tokens = New-Object 'System.Collections.Generic.HashSet[string]'
  $identities = New-Object 'System.Collections.Generic.HashSet[string]'
  $pageToken = ''
  for ($page = 0; $page -lt 50; $page++) {
    $response = Get-InventoryPage $Project $CollectionPath $Fields $pageToken
    if ($null -eq $response) { throw 'Resposta de inventario ausente.' }
    foreach ($doc in @($response.documents)) {
      if ($null -eq $doc) { continue }
      if (-not $doc.name -or -not $identities.Add([string]$doc.name)) { throw 'Documento ausente ou repetido; inventario inconclusivo.' }
      $rows.Add($doc)
    }
    $pageToken = [string]$response.nextPageToken
    if (-not $pageToken) { return $rows.ToArray() }
    if (-not $tokens.Add($pageToken)) { throw 'Token de pagina repetido; inventario inconclusivo.' }
  }
  throw 'Limite local de paginas atingido; nao emitir inventario parcial.'
}
function Write-TestStoreInventory([string[]]$RequestedReviewIds, [string]$Destination) {
  $model = 'F1ediJCWm8kmUKy3vTK1'
  foreach ($id in $RequestedReviewIds) {
    if ($id -notmatch '^[A-Za-z0-9_-]{1,128}$' -or $id -eq $model) { throw 'ID de revisao invalido ou Loja Modelo excluida de nova migracao.' }
  }
  try {
    $source = @(Read-InventoryCollection 'store-connect-app' 'stores' @('isTestStore','testOnly','environment'))
    $target = @(Read-InventoryCollection 'store-connect-hml' 'stores')
    $targetNames = @($target | ForEach-Object { ([string]$_.name).Split('/')[-1] })
    $inventory = @()
    foreach ($doc in $source) {
      $id = ([string]$doc.name).Split('/')[-1]
      $isModel = $id -eq $model
      $hint = $doc.fields.isTestStore.booleanValue -eq $true -or $doc.fields.testOnly.booleanValue -eq $true
      $entry = [ordered]@{
        storeKey = Get-InventoryHash ('store-connect-app/stores/' + $id)
        classification = 'UNCLASSIFIED_REQUIRES_HUMAN_EVIDENCE'
        explicitTestMarker = [bool]$hint
        modelExcluded = $isModel
        sameIdPresentHml = [bool]($targetNames -contains $id)
        metadataHash = Get-InventoryHash (([string]$doc.name) + '|' + ([string]$doc.createTime) + '|' + ([string]$doc.updateTime))
        reviewedCounts = $null
      }
      if (-not $isModel -and $RequestedReviewIds -contains $id) {
        $products = @(Read-InventoryCollection 'store-connect-app' ('stores/' + $id + '/products'))
        $categories = @(Read-InventoryCollection 'store-connect-app' ('stores/' + $id + '/categories'))
        $entry.reviewedCounts = @{products=$products.Count; categories=$categories.Count; scope='metadata_only_not_migration_approval'}
      }
      $inventory += [pscustomobject]$entry
    }
    $archive = @(Read-InventoryCollection 'store-connect-hml' ('hmlMigrationArchives/' + $model + '/historicalDocuments'))
    $result = [ordered]@{schemaVersion=1; mode='READ_ONLY_DRY_RUN'; source='store-connect-app'; target='store-connect-hml';
      inventoryComplete=$true; sourceStores=$source.Count; targetStores=$target.Count;
      confirmedExclusiveTestStores=0; stores=$inventory;
      modelCheckpoint=@{rootPresent=($targetNames -contains $model); archivedHistoricalCount=$archive.Count;
        base15Recounted=$false; authDisabledRechecked=$false; action='DO_NOT_COPY_OR_IMPORT_AGAIN'};
      note='No names, personal fields, financial IDs, tokens, invoice URLs, Auth or operational financial documents read/exported. Same ID or marker is not migration proof.'}
    $path = [IO.Path]::GetFullPath($Destination)
    if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($path)))) { throw 'Diretorio local de saida inexistente.' }
    if (Test-Path -LiteralPath $path) { throw 'Arquivo local ja existe; preservar e usar outro OutputPath.' }
    [IO.File]::WriteAllText($path, ($result | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
    Write-Output ('INVENTARIO_READ_ONLY: lojas fonte=' + $source.Count + '; HML=' + $target.Count + '; exclusividade comprovada=0; nenhuma escrita remota.')
    Write-Output ('Artefato sanitizado: ' + $path)
  } finally { $script:InventoryTokens.Clear() }
}
if ($MyInvocation.InvocationName -ne '.') { Write-TestStoreInventory $ReviewStoreIds $OutputPath }
