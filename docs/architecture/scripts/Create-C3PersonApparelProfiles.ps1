# ============================================================
# C3PersonApparelProfiles SharePoint List Provisioning
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

$listTitle = "C3PersonApparelProfiles"

$expected = [ordered]@{
    "PersonID"     = @{ Type = "Text";    Required = $true;  DisplayName = "Person ID" }
    "JerseySize"   = @{ Type = "Choice";  Required = $false; DisplayName = "Jersey Size"; Choices = @("XS","S","M","L","XL","XXL","3XL") }
    "NameOnJersey" = @{ Type = "Text";    Required = $false; DisplayName = "Name on Jersey" }
    "Notes"        = @{ Type = "Note";    Required = $false; DisplayName = "Notes" }
    "IsActive"     = @{ Type = "Boolean"; Required = $false; DisplayName = "Is Active" }
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
        -Description "C3 person apparel profiles (stable sizing attributes). Managed by C3 Platform."
    Set-PnPList -Identity $listTitle -EnableAttachments:$false -EnableVersioning:$true -MajorVersions 10
    Write-Host "List created."
}

# 2. Title = display-only profile key
Set-PnPField -List $listTitle -Identity "Title" -Values @{ Title = "Profile Key"; Required = $false }

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
        "Note"    { $xml = "<Field Type='Note' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName' NumLines='6' RichText='FALSE'/>" }
        "Boolean" { $xml = "<Field Type='Boolean' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName'><Default>1</Default></Field>" }
        "Choice"  {
            $choices = ($Spec.Choices | ForEach-Object { "<CHOICE>$_</CHOICE>" }) -join ""
            $xml = "<Field Type='Choice' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName' Format='Dropdown'><CHOICES>$choices</CHOICES></Field>"
        }
    }
    Add-PnPFieldFromXml -List $listTitle -FieldXml $xml | Out-Null
    $check = Get-PnPField -List $listTitle | Where-Object { $_.InternalName -eq $InternalName }
    if (-not $check) { throw "Column '$InternalName' was silently renamed by SharePoint (collision). Aborted." }
    if ($Spec.Required) { Set-PnPField -List $listTitle -Identity $InternalName -Values @{ Required = $true } }
    Write-Host "$InternalName created and verified."
}

foreach ($name in $expected.Keys) { Add-FieldStrict -InternalName $name -Spec $expected[$name] }

# 4. Index
try { Add-PnPFieldIndex -List $listTitle -Field "PersonID" } catch { Write-Host "Index PersonID: $($_.Exception.Message)" }

# 5. Validation — fail loudly on any mismatch
Write-Host ""; Write-Host "==== Internal-name report ====" -ForegroundColor Cyan
$final = Get-InternalNameReport -List $listTitle
$final | Format-Table | Out-String | Write-Host
Test-ForGridImportResidue -Fields $final

$failures = @()
foreach ($name in $expected.Keys) {
    if (-not ($final | Where-Object { $_.InternalName -eq $name })) { $failures += "MISSING internal name: $name" }
}
$sizeField = Get-PnPField -List $listTitle -Identity "JerseySize" -ErrorAction SilentlyContinue
if ($sizeField) {
    $actual = @([xml]$sizeField.SchemaXml).Field.CHOICES.CHOICE
    if (Compare-Object -ReferenceObject $expected["JerseySize"].Choices -DifferenceObject $actual) {
        $failures += "JerseySize choices mismatch. Actual: $($actual -join ', ')"
    }
}
$activeField = Get-PnPField -List $listTitle -Identity "IsActive" -ErrorAction SilentlyContinue
if ($activeField -and ([xml]$activeField.SchemaXml).Field.Default -ne "1") { $failures += "IsActive default is not Yes/1." }

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    throw "C3PersonApparelProfiles provisioning validation failed."
}

Write-Host "Provisioning complete and validated." -ForegroundColor Green
Write-Host "REST verification URL:"
Write-Host "$SiteUrl/_api/web/lists/getbytitle('C3PersonApparelProfiles')/fields?`$select=InternalName,Title,TypeAsString,Required&`$filter=Hidden eq false"
