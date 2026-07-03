# ============================================================
# C3MissionKitAssignments SharePoint List Provisioning
# Sprint 28 - Phase 1
#
# PROVISIONING HELPER — NOT A GENERAL MIGRATION ENGINE.
# Hardened per the S26 post-mortem (see: C3Missions Provisioning
# Post-Mortem.md): stops on existing lists by default, verifies INTERNAL
# names (never display names alone), refuses field_N residue, validates
# choice sets and defaults, prints an internal-name report, and never
# renames or deletes malformed fields automatically.
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$SiteUrl,

    # Continue against a pre-existing list ONLY after reviewing the
    # internal-name report this script prints.
    [switch]$AllowExisting
)

$ErrorActionPreference = "Stop"

Connect-PnPOnline -Url $SiteUrl -Interactive

$listTitle = "C3MissionKitAssignments"

$kitStatusChoices = @("NotOrdered","Ordered","Shipped","Delivered","Confirmed","Returned","Replaced","Missing")
$itemCategoryChoices = @("Jersey","Apparel","Equipment")

$expected = [ordered]@{
    "MissionID"       = @{ Type = "Text";    Required = $true;  DisplayName = "Mission ID" }
    "PersonID"        = @{ Type = "Text";    Required = $true;  DisplayName = "Person ID" }
    "ItemCategory"    = @{ Type = "Choice";  Required = $true;  DisplayName = "Item Category"; Choices = $itemCategoryChoices }
    "AssignmentKey"   = @{ Type = "Text";    Required = $true;  DisplayName = "Assignment Key" }
    "ItemDescription" = @{ Type = "Text";    Required = $false; DisplayName = "Item Description" }
    "KitStatus"       = @{ Type = "Choice";  Required = $true;  DisplayName = "Status"; Choices = $kitStatusChoices; Default = "NotOrdered" }
    "JerseyNumber"    = @{ Type = "Text";    Required = $false; DisplayName = "Jersey Number" }
    "OwnerEmail"      = @{ Type = "Text";    Required = $false; DisplayName = "Owner Email" }
    "IsActive"        = @{ Type = "Boolean"; Required = $false; DisplayName = "Is Active" }
}

function Get-InternalNameReport {
    param([string]$List)
    Get-PnPField -List $List | Where-Object { -not $_.Hidden } |
        Select-Object InternalName, Title, TypeAsString, Required
}

function Test-ForGridImportResidue {
    param($Fields)
    $residue = $Fields | Where-Object { $_.InternalName -match '^field_\d+$' }
    if ($residue) {
        Write-Host "FATAL: grid/Excel-import residue (field_N internal names):" -ForegroundColor Red
        $residue | Format-Table InternalName, Title, TypeAsString | Out-String | Write-Host
        throw "Grid-import residue in $listTitle. Provisioning aborted; nothing was modified."
    }
}

# 1. Existing-list detection — STOP by default
$list = Get-PnPList -Identity $listTitle -ErrorAction SilentlyContinue
if ($null -ne $list) {
    Write-Host "List '$listTitle' ALREADY EXISTS. Internal-name report:" -ForegroundColor Yellow
    $report = Get-InternalNameReport -List $listTitle
    $report | Format-Table | Out-String | Write-Host
    Test-ForGridImportResidue -Fields $report
    if (-not $AllowExisting) {
        throw "List exists. Re-run with -AllowExisting only if the report shows no conflicts. Nothing was modified."
    }
    Write-Host "-AllowExisting set: continuing (missing columns only)." -ForegroundColor Yellow
}
else {
    $list = New-PnPList -Title $listTitle -Template GenericList -EnableVersioning $true `
        -Description "C3 mission kit assignments (issued participant kit). Managed by C3 Platform."
    Set-PnPList -Identity $listTitle -EnableAttachments:$false -EnableVersioning:$true -MajorVersions 10
    Write-Host "List created."
}

# 2. Title = display-only assignment key
Set-PnPField -List $listTitle -Identity "Title" -Values @{ Title = "Assignment Key (Display)"; Required = $false }

# 3. Columns via SchemaXml (exact InternalName/StaticName); existence by INTERNAL name
function Add-FieldStrict {
    param([string]$InternalName, [hashtable]$Spec)
    $existing = Get-PnPField -List $listTitle -ErrorAction SilentlyContinue |
        Where-Object { $_.InternalName -eq $InternalName }
    if ($existing) {
        if ($existing.TypeAsString -ne $Spec.Type) {
            throw "Column '$InternalName' exists with type '$($existing.TypeAsString)', expected '$($Spec.Type)'. Aborted."
        }
        Write-Host "$InternalName already exists (type OK) - skipped."
        return
    }
    switch ($Spec.Type) {
        "Text"    { $xml = "<Field Type='Text' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName' MaxLength='255'/>" }
        "Boolean" { $xml = "<Field Type='Boolean' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName'><Default>1</Default></Field>" }
        "Choice"  {
            $choices = ($Spec.Choices | ForEach-Object { "<CHOICE>$_</CHOICE>" }) -join ""
            $default = if ($Spec.Default) { "<Default>$($Spec.Default)</Default>" } else { "" }
            $xml = "<Field Type='Choice' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName' Format='Dropdown'><CHOICES>$choices</CHOICES>$default</Field>"
        }
    }
    Add-PnPFieldFromXml -List $listTitle -FieldXml $xml | Out-Null
    $check = Get-PnPField -List $listTitle | Where-Object { $_.InternalName -eq $InternalName }
    if (-not $check) { throw "Column '$InternalName' was silently renamed by SharePoint (collision). Aborted." }
    if ($Spec.Required) { Set-PnPField -List $listTitle -Identity $InternalName -Values @{ Required = $true } }
    Write-Host "$InternalName created and verified."
}

foreach ($name in $expected.Keys) { Add-FieldStrict -InternalName $name -Spec $expected[$name] }

# 4. Indexes
foreach ($idx in @("MissionID","PersonID")) {
    try { Add-PnPFieldIndex -List $listTitle -Field $idx } catch { Write-Host "Index $idx: $($_.Exception.Message)" }
}

# 5. Validation — fail loudly on any mismatch
Write-Host ""; Write-Host "==== Internal-name report ====" -ForegroundColor Cyan
$final = Get-InternalNameReport -List $listTitle
$final | Format-Table | Out-String | Write-Host
Test-ForGridImportResidue -Fields $final

$failures = @()
foreach ($name in $expected.Keys) {
    if (-not ($final | Where-Object { $_.InternalName -eq $name })) { $failures += "MISSING internal name: $name" }
}
foreach ($choiceField in @(@{ Name = "KitStatus"; Choices = $kitStatusChoices }, @{ Name = "ItemCategory"; Choices = $itemCategoryChoices })) {
    $f = Get-PnPField -List $listTitle -Identity $choiceField.Name -ErrorAction SilentlyContinue
    if ($f) {
        $actual = @([xml]$f.SchemaXml).Field.CHOICES.CHOICE
        if (Compare-Object -ReferenceObject $choiceField.Choices -DifferenceObject $actual) {
            $failures += "$($choiceField.Name) choices mismatch. Actual: $($actual -join ', ')"
        }
    }
}
$statusField = Get-PnPField -List $listTitle -Identity "KitStatus" -ErrorAction SilentlyContinue
if ($statusField -and ([xml]$statusField.SchemaXml).Field.Default -ne "NotOrdered") { $failures += "KitStatus default is not NotOrdered." }
$activeField = Get-PnPField -List $listTitle -Identity "IsActive" -ErrorAction SilentlyContinue
if ($activeField -and ([xml]$activeField.SchemaXml).Field.Default -ne "1") { $failures += "IsActive default is not Yes/1." }

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    throw "C3MissionKitAssignments provisioning validation failed."
}

Write-Host "Provisioning complete and validated." -ForegroundColor Green
Write-Host "REST verification URL:"
Write-Host "$SiteUrl/_api/web/lists/getbytitle('C3MissionKitAssignments')/fields?`$select=InternalName,Title,TypeAsString,Required&`$filter=Hidden eq false"
