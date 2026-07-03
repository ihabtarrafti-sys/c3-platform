# ============================================================
# Sprint 29A — Logistics Write-Enablement Schema Delta
#
# Applies to lists provisioned in S27/S28:
#   C3MissionKitAssignments   — +StatusNotes, versions 10->50, Title unique
#   C3PersonApparelProfiles   — versions 10->50, Title unique
#   C3MissionParticipants     — Title unique (S29B PREPARATION ONLY —
#                               no participant write behavior changes)
#
# PROVISIONING HELPER — NOT A GENERAL MIGRATION ENGINE.
# Hardened per the S26 post-mortem: verifies lists exist, verifies exact
# internal names, refuses field_N residue, AUDITS DUPLICATE TITLES BEFORE
# enabling uniqueness, reports versioning configuration, and outputs a
# final verification report. Never renames or deletes fields.
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$SiteUrl,

    # Also enable Title uniqueness on C3MissionParticipants (S29B schema prep).
    [switch]$IncludeParticipantsUniqueness
)

$ErrorActionPreference = "Stop"
Connect-PnPOnline -Url $SiteUrl -Interactive

$failures = @()

function Assert-ListHealthy {
    param([string]$List)
    $l = Get-PnPList -Identity $List -ErrorAction SilentlyContinue
    if ($null -eq $l) { throw "List '$List' does not exist. Run its Create-*.ps1 first. Nothing modified." }
    $residue = Get-PnPField -List $List | Where-Object { -not $_.Hidden -and $_.InternalName -match '^field_\d+$' }
    if ($residue) { throw "List '$List' has field_N residue ($($residue.InternalName -join ', ')). Aborted." }
    return $l
}

function Enable-TitleUniqueness {
    param([string]$List)
    # 1. AUDIT duplicates first — enabling uniqueness with duplicates present fails/locks rows.
    $items = Get-PnPListItem -List $List -PageSize 500 -Fields "Title"
    $dupes = $items | Group-Object { $_["Title"] } | Where-Object { $_.Count -gt 1 -and $_.Name }
    if ($dupes) {
        $script:failures += "DUPLICATE Titles in ${List}: $($dupes.Name -join ' | ') — resolve before enabling uniqueness."
        Write-Host "SKIPPED uniqueness on $List — duplicates found." -ForegroundColor Red
        return
    }
    # 2. Unique values require an indexed column.
    Set-PnPField -List $List -Identity "Title" -Values @{ Indexed = $true; EnforceUniqueValues = $true }
    Write-Host "$List Title uniqueness ENABLED (indexed)." -ForegroundColor Green
}

function Set-VersionRetention {
    param([string]$List, [int]$Major)
    $l = Get-PnPList -Identity $List
    Write-Host "$List versioning before: Enabled=$($l.EnableVersioning) MajorLimit=$($l.MajorVersionLimit)"
    Set-PnPList -Identity $List -EnableVersioning:$true -MajorVersions $Major
    Write-Host "$List versioning after: MajorLimit=$Major" -ForegroundColor Green
}

# ------------------------------------------------------------
# C3MissionKitAssignments
# ------------------------------------------------------------
Assert-ListHealthy -List "C3MissionKitAssignments" | Out-Null

# StatusNotes — plain multi-line audit trail (append-through-service)
$existing = Get-PnPField -List "C3MissionKitAssignments" -ErrorAction SilentlyContinue |
    Where-Object { $_.InternalName -eq "StatusNotes" }
if ($existing) {
    if ($existing.TypeAsString -ne "Note") { throw "StatusNotes exists with type '$($existing.TypeAsString)' — expected Note. Aborted." }
    Write-Host "StatusNotes already exists — skipped."
} else {
    Add-PnPFieldFromXml -List "C3MissionKitAssignments" `
        -FieldXml "<Field Type='Note' DisplayName='Status Notes' Name='StatusNotes' StaticName='StatusNotes' NumLines='10' RichText='FALSE'/>" | Out-Null
    $check = Get-PnPField -List "C3MissionKitAssignments" | Where-Object { $_.InternalName -eq "StatusNotes" }
    if (-not $check) { throw "StatusNotes was silently renamed by SharePoint. Aborted." }
    Write-Host "StatusNotes created and verified." -ForegroundColor Green
}

Set-VersionRetention -List "C3MissionKitAssignments" -Major 50
Enable-TitleUniqueness -List "C3MissionKitAssignments"

# ------------------------------------------------------------
# C3PersonApparelProfiles
# ------------------------------------------------------------
Assert-ListHealthy -List "C3PersonApparelProfiles" | Out-Null
Set-VersionRetention -List "C3PersonApparelProfiles" -Major 50
Enable-TitleUniqueness -List "C3PersonApparelProfiles"

# ------------------------------------------------------------
# C3MissionParticipants — S29B schema preparation only
# ------------------------------------------------------------
if ($IncludeParticipantsUniqueness) {
    Assert-ListHealthy -List "C3MissionParticipants" | Out-Null
    Enable-TitleUniqueness -List "C3MissionParticipants"
    Write-Host "NOTE: participant WRITE behavior is unchanged (S29B scope)." -ForegroundColor Yellow
}

# ------------------------------------------------------------
# Final verification report
# ------------------------------------------------------------
Write-Host ""; Write-Host "==== S29A delta verification report ====" -ForegroundColor Cyan
foreach ($list in @("C3MissionKitAssignments","C3PersonApparelProfiles","C3MissionParticipants")) {
    $l = Get-PnPList -Identity $list -ErrorAction SilentlyContinue
    if ($null -eq $l) { continue }
    $title = Get-PnPField -List $list -Identity "Title"
    $sn = Get-PnPField -List $list -ErrorAction SilentlyContinue | Where-Object { $_.InternalName -eq "StatusNotes" }
    Write-Host ("{0}: MajorVersions={1} TitleUnique={2} TitleIndexed={3} StatusNotes={4}" -f `
        $list, $l.MajorVersionLimit, $title.EnforceUniqueValues, $title.Indexed, ($(if ($sn) {"yes"} else {"n/a"})))
}

if ($failures.Count -gt 0) {
    Write-Host ""; $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    throw "S29A delta completed WITH FAILURES — resolve and re-run."
}
Write-Host "S29A delta complete and validated." -ForegroundColor Green

# ------------------------------------------------------------
# PERMISSIONS VERIFICATION CHECKLIST (manual — ACLs are owner actions)
# ------------------------------------------------------------
Write-Host @"

==== SharePoint permissions verification checklist (S29A) ====
UI role checks are affordance only. Verify list-level ACLs:

C3MissionKitAssignments
  [ ] Edit/Contribute: C3 Platform Owners, C3 Operations
  [ ] Read-only:       C3 HR, C3 Legal, C3 Finance, C3 Management (and visitors per site policy)
  [ ] If the list inherits site permissions and site members exceed the Edit set,
      BREAK INHERITANCE and grant per-group.

C3PersonApparelProfiles
  [ ] Edit/Contribute: C3 Platform Owners, C3 Operations, C3 HR
  [ ] Read-only:       other authenticated C3 roles

C3MissionParticipants (S29B preparation)
  [ ] Edit:            C3 Platform Owners ONLY
      (Operations submit approval requests through C3; they must not be able to
       bypass governance by editing participant rows directly.)

Verify current state via REST:
  {site}/_api/web/lists/getbytitle('<list>')/HasUniqueRoleAssignments
  {site}/_api/web/lists/getbytitle('<list>')/roleassignments?`$expand=Member,RoleDefinitionBindings
"@
