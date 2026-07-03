# ============================================================
# C3MissionParticipants SharePoint List Provisioning
# Sprint 27 - Phase 2
#
# PROVISIONING HELPER — NOT A GENERAL MIGRATION ENGINE.
# Incorporates the Sprint 26 lessons (see: C3Missions Provisioning
# Post-Mortem.md). This script:
#   - STOPS by default if the list already exists (use -AllowExisting to
#     continue against an existing list, and only after reviewing the
#     internal-name report it prints)
#   - verifies INTERNAL names via REST-equivalent field inspection, never
#     display names alone
#   - refuses to proceed past field_N internal names (grid/Excel-import
#     residue) — it will NOT rename or delete malformed fields; that is an
#     explicit operator decision
#   - validates ParticipantRole choice values and the IsActive default
#   - prints a final internal-name report and fails loudly on any mismatch
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$SiteUrl,

    # Continue against a pre-existing C3MissionParticipants list.
    # Only safe when the internal-name report shows no conflicts.
    [switch]$AllowExisting
)

$ErrorActionPreference = "Stop"

Connect-PnPOnline -Url $SiteUrl -Interactive

$listTitle = "C3MissionParticipants"

# Expected schema: internal name -> @{ Type; Required; DisplayName }
$expected = [ordered]@{
    "MissionID"       = @{ Type = "Text";    Required = $true;  DisplayName = "Mission ID" }
    "PersonID"        = @{ Type = "Text";    Required = $true;  DisplayName = "Person ID" }
    "ExternalCode"    = @{ Type = "Text";    Required = $true;  DisplayName = "External Code" }
    "ParticipantRole" = @{ Type = "Choice";  Required = $true;  DisplayName = "Role" }
    "PerDiemRate"     = @{ Type = "Number";  Required = $false; DisplayName = "Per Diem Rate" }
    "IsActive"        = @{ Type = "Boolean"; Required = $false; DisplayName = "Is Active" }
}
$expectedRoleChoices = @("Player","Coach","Manager","Analyst","Staff")

function Get-InternalNameReport {
    param([string]$List)
    Get-PnPField -List $List | Where-Object { -not $_.Hidden } |
        Select-Object InternalName, Title, TypeAsString, Required
}

function Test-ForGridImportResidue {
    param($Fields)
    $residue = $Fields | Where-Object { $_.InternalName -match '^field_\d+$' }
    if ($residue) {
        Write-Host ""
        Write-Host "FATAL: grid/Excel-import residue detected (field_N internal names):" -ForegroundColor Red
        $residue | Format-Table InternalName, Title, TypeAsString | Out-String | Write-Host
        Write-Host "Internal names cannot be renamed. Do NOT continue against this list." -ForegroundColor Red
        Write-Host "Options: (a) delete the list and re-run this script on a clean site," -ForegroundColor Red
        Write-Host "         (b) perform an explicit, operator-approved in-place remediation" -ForegroundColor Red
        Write-Host "             (see C3Missions Provisioning Post-Mortem.md section 3)." -ForegroundColor Red
        throw "Grid-import residue in $listTitle. Provisioning aborted; nothing was modified."
    }
}

# ------------------------------------------------------------
# 1. Existing-list detection — STOP by default
# ------------------------------------------------------------
$list = Get-PnPList -Identity $listTitle -ErrorAction SilentlyContinue

if ($null -ne $list) {
    Write-Host "List '$listTitle' ALREADY EXISTS." -ForegroundColor Yellow
    Write-Host "Current internal-name report:" -ForegroundColor Yellow
    $report = Get-InternalNameReport -List $listTitle
    $report | Format-Table | Out-String | Write-Host

    Test-ForGridImportResidue -Fields $report

    if (-not $AllowExisting) {
        throw ("List '$listTitle' already exists. Review the internal-name report above. " +
               "Re-run with -AllowExisting ONLY if the report shows no conflicts with the " +
               "expected schema. Nothing was modified.")
    }
    Write-Host "-AllowExisting set: continuing against the existing list (missing columns only)." -ForegroundColor Yellow
}
else {
    $list = New-PnPList `
        -Title $listTitle `
        -Template GenericList `
        -EnableVersioning $true `
        -Description "C3 mission participant assignments. Managed by C3 Platform."
    Write-Host "List created."

    Set-PnPList -Identity $listTitle -EnableAttachments:$false -EnableVersioning:$true -MajorVersions 10
}

# ------------------------------------------------------------
# 2. Title column — display-only convenience key
# ------------------------------------------------------------
Set-PnPField -List $listTitle -Identity "Title" -Values @{
    Title    = "Assignment Key"
    Required = $false
}

# ------------------------------------------------------------
# 3. Create columns via SchemaXml (exact InternalName + StaticName control)
#    Existence is checked by INTERNAL name — display names are never trusted.
# ------------------------------------------------------------
function Add-FieldStrict {
    param([string]$InternalName, [hashtable]$Spec)

    $existing = Get-PnPField -List $listTitle -ErrorAction SilentlyContinue |
        Where-Object { $_.InternalName -eq $InternalName }

    if ($existing) {
        if ($existing.TypeAsString -ne $Spec.Type -and
            -not ($existing.TypeAsString -eq "Choice" -and $Spec.Type -eq "Choice")) {
            throw ("Column '$InternalName' exists with type '$($existing.TypeAsString)' but " +
                   "'$($Spec.Type)' was expected. Provisioning aborted; resolve manually.")
        }
        Write-Host "$InternalName already exists (type OK) - skipped."
        return
    }

    switch ($Spec.Type) {
        "Text" {
            $xml = "<Field Type='Text' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName' MaxLength='255'/>"
        }
        "Number" {
            $xml = "<Field Type='Number' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName'/>"
        }
        "Boolean" {
            $xml = "<Field Type='Boolean' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName'><Default>1</Default></Field>"
        }
        "Choice" {
            $choices = ($expectedRoleChoices | ForEach-Object { "<CHOICE>$_</CHOICE>" }) -join ""
            $xml = "<Field Type='Choice' DisplayName='$($Spec.DisplayName)' Name='$InternalName' StaticName='$InternalName' Format='Dropdown'><CHOICES>$choices</CHOICES></Field>"
        }
    }

    Add-PnPFieldFromXml -List $listTitle -FieldXml $xml | Out-Null

    # Verify the internal name actually took (SP silently renames on collision)
    $check = Get-PnPField -List $listTitle | Where-Object { $_.InternalName -eq $InternalName }
    if (-not $check) {
        throw ("Column '$InternalName' was created but does NOT exist under that internal " +
               "name - SharePoint renamed it (collision). Provisioning aborted; inspect and " +
               "resolve manually.")
    }

    if ($Spec.Required) {
        Set-PnPField -List $listTitle -Identity $InternalName -Values @{ Required = $true }
    }
    Write-Host "$InternalName created and verified."
}

foreach ($name in $expected.Keys) {
    Add-FieldStrict -InternalName $name -Spec $expected[$name]
}

# ------------------------------------------------------------
# 4. Indexes
# ------------------------------------------------------------
foreach ($idx in @("MissionID","PersonID")) {
    try { Add-PnPFieldIndex -List $listTitle -Field $idx } catch { Write-Host "Index $idx: $($_.Exception.Message)" }
}

# ------------------------------------------------------------
# 5. Post-provisioning validation — fail loudly on any mismatch
# ------------------------------------------------------------
Write-Host ""
Write-Host "==== Internal-name report ====" -ForegroundColor Cyan
$final = Get-InternalNameReport -List $listTitle
$final | Format-Table | Out-String | Write-Host

Test-ForGridImportResidue -Fields $final

$failures = @()
foreach ($name in $expected.Keys) {
    $f = $final | Where-Object { $_.InternalName -eq $name }
    if (-not $f) { $failures += "MISSING internal name: $name" }
}

# ParticipantRole choice validation
$roleField = Get-PnPField -List $listTitle -Identity "ParticipantRole" -ErrorAction SilentlyContinue
if ($roleField) {
    $actualChoices = @([xml]$roleField.SchemaXml).Field.CHOICES.CHOICE
    $diff = Compare-Object -ReferenceObject $expectedRoleChoices -DifferenceObject $actualChoices
    if ($diff) { $failures += "ParticipantRole choices mismatch. Expected: $($expectedRoleChoices -join ', '). Actual: $($actualChoices -join ', ')" }
}

# IsActive default validation
$isActiveField = Get-PnPField -List $listTitle -Identity "IsActive" -ErrorAction SilentlyContinue
if ($isActiveField -and ([xml]$isActiveField.SchemaXml).Field.Default -ne "1") {
    $failures += "IsActive default is not Yes/1."
}

if ($failures.Count -gt 0) {
    Write-Host "VALIDATION FAILED:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    throw "C3MissionParticipants provisioning validation failed. Resolve before adding rows."
}

Write-Host "Provisioning complete and validated." -ForegroundColor Green
Write-Host ""
Write-Host "REST verification URL (run in a browser as a final check):"
Write-Host "$SiteUrl/_api/web/lists/getbytitle('C3MissionParticipants')/fields?`$select=InternalName,Title,TypeAsString,Required&`$filter=Hidden eq false"
