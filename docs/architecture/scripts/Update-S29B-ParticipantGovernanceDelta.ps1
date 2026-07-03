# ============================================================
# Sprint 29B — Participant Governance Schema + ACL Delta
#
# 1. C3Approvals.OperationType: add AddMissionParticipant +
#    RemoveMissionParticipant (preserving all existing values)
# 2. C3MissionParticipants ACL: Platform Owners edit-only posture
# 3. C3Approvals ACL: custom 'C3 Approval Submitter' level +
#    WriteSecurity=2 (edit own items only)
#
# PROVISIONING HELPER — NOT A GENERAL MIGRATION ENGINE.
# Hardened per the S26 post-mortem + S29A ACL procedure: verifies internal
# names, refuses field_N residue, reads existing choices before modifying,
# audits ACL posture, resolves principals by ID, preserves owner/admin
# access, and prints a final verification report.
# See: C3 Governance List Permissions — Sprint 29B.md
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$SiteUrl,

    # Apply the ACL changes (schema-only by default so the choice delta can
    # be run independently of the security change).
    [switch]$ApplyAcls
)

$ErrorActionPreference = "Stop"
Connect-PnPOnline -Url $SiteUrl -Interactive

$me = Get-PnPProperty -ClientObject (Get-PnPWeb) -Property CurrentUser
if (-not $me.IsSiteAdmin) { Write-Host "WARNING: acting user is not a site collection admin." -ForegroundColor Yellow }

# ------------------------------------------------------------
# 1. OperationType choice delta (preserve existing, add two)
# ------------------------------------------------------------
$opField = Get-PnPField -List "C3Approvals" -Identity "OperationType" -ErrorAction SilentlyContinue
if (-not $opField) { throw "C3Approvals.OperationType not found by internal name. Aborted." }
if ($opField.InternalName -ne "OperationType") { throw "OperationType internal-name mismatch: $($opField.InternalName). Aborted." }

$xml = [xml]$opField.SchemaXml
$existing = @($xml.Field.CHOICES.CHOICE)
Write-Host "Existing OperationType choices: $($existing -join ', ')"
$toAdd = @("AddMissionParticipant","RemoveMissionParticipant") | Where-Object { $existing -notcontains $_ }
if ($toAdd.Count -eq 0) {
    Write-Host "Both values already present — no choice change." -ForegroundColor Green
} else {
    $final = $existing + $toAdd
    Set-PnPField -List "C3Approvals" -Identity "OperationType" -Values @{ Choices = $final }
    Write-Host "Added: $($toAdd -join ', ')" -ForegroundColor Green
}
$verify = [xml](Get-PnPField -List "C3Approvals" -Identity "OperationType").SchemaXml
$finalChoices = @($verify.Field.CHOICES.CHOICE)
foreach ($v in $existing) { if ($finalChoices -notcontains $v) { throw "Existing choice '$v' was lost! Restore immediately." } }
foreach ($v in @("AddMissionParticipant","RemoveMissionParticipant")) { if ($finalChoices -notcontains $v) { throw "Required choice '$v' missing after delta." } }
Write-Host "OperationType verified: $($finalChoices -join ', ')" -ForegroundColor Green

# ------------------------------------------------------------
# 2/3. ACL posture (audit always; apply only with -ApplyAcls)
# ------------------------------------------------------------
function Show-Acl { param([string]$List)
    $l = Get-PnPList -Identity $List -Includes HasUniqueRoleAssignments, WriteSecurity
    Write-Host "$List : unique=$($l.HasUniqueRoleAssignments) writeSecurity=$($l.WriteSecurity)"
    Get-PnPProperty -ClientObject $l -Property RoleAssignments | ForEach-Object {
        $m = Get-PnPProperty -ClientObject $_ -Property Member
        $b = Get-PnPProperty -ClientObject $_ -Property RoleDefinitionBindings
        Write-Host ("  {0}({1}) => {2}" -f $m.Title, $m.Id, (($b | ForEach-Object Name) -join '/'))
    }
}
Write-Host ""; Write-Host "==== Current ACL posture ====" -ForegroundColor Cyan
Show-Acl "C3MissionParticipants"; Show-Acl "C3Approvals"

if (-not $ApplyAcls) {
    Write-Host ""; Write-Host "Schema delta complete. Re-run with -ApplyAcls to apply the security posture" -ForegroundColor Yellow
    Write-Host "documented in 'C3 Governance List Permissions — Sprint 29B.md'."
    return
}

# --- Custom permission level (idempotent) ---
$levelName = "C3 Approval Submitter"
$existingLevel = Get-PnPRoleDefinition | Where-Object { $_.Name -eq $levelName }
if (-not $existingLevel) {
    Add-PnPRoleDefinition -RoleName $levelName `
        -Description "C3 governed-operation submitters: view/open/add approvals + edit constrained to own items by list WriteSecurity=2. No delete, no manage." `
        -Include ViewListItems, ViewVersions, ViewPages, ViewFormPages, Open, BrowseUserInfo, AddListItems, EditListItems
    Write-Host "Created permission level '$levelName'." -ForegroundColor Green
} else { Write-Host "'$levelName' already exists." }

# --- Resolve principals by ID (exact-title match; stop on unresolved) ---
$groups = Get-PnPGroup
function Resolve-Group { param([string]$Title)
    $g = $groups | Where-Object { $_.Title -eq $Title }
    if (-not $g) { throw "Group '$Title' not resolved. Aborted before any ACL change." }
    return $g
}
$gOwnersSite = Resolve-Group "C3 - Contract Command Center Owners"
$gVisitors   = Resolve-Group "C3 - Contract Command Center Visitors"
$gMembers    = Resolve-Group "C3 - Contract Command Center Members"
$gOps        = Resolve-Group "C3 Operations"
$gHr         = Resolve-Group "C3 HR"
$gFinance    = Resolve-Group "C3 Finance"
$gMgmt       = Resolve-Group "C3 Management"
$gLegal      = Resolve-Group "C3 Legal"
$gPlatform   = Resolve-Group "C3 Platform Owners"

function Apply-Posture { param([string]$List, [hashtable[]]$Grants, [int]$WriteSecurity = 1)
    Set-PnPList -Identity $List -BreakRoleInheritance -CopyRoleAssignments:$false
    foreach ($grant in $Grants) {
        Set-PnPListPermission -Identity $List -Group $grant.Group.Title -AddRole $grant.Role
    }
    if ($WriteSecurity -ne 1) {
        $l = Get-PnPList -Identity $List
        $l.WriteSecurity = $WriteSecurity; $l.Update(); Invoke-PnPQuery
    }
    Write-Host "$List posture applied." -ForegroundColor Green
}

Apply-Posture -List "C3MissionParticipants" -Grants @(
    @{ Group = $gOwnersSite; Role = "Full Control" }, @{ Group = $gPlatform; Role = "Full Control" },
    @{ Group = $gOps; Role = "Read" }, @{ Group = $gHr; Role = "Read" }, @{ Group = $gLegal; Role = "Read" },
    @{ Group = $gFinance; Role = "Read" }, @{ Group = $gMgmt; Role = "Read" },
    @{ Group = $gVisitors; Role = "Read" }, @{ Group = $gMembers; Role = "Read" }
)

Apply-Posture -List "C3Approvals" -WriteSecurity 2 -Grants @(
    @{ Group = $gOwnersSite; Role = "Full Control" }, @{ Group = $gPlatform; Role = "Full Control" },
    @{ Group = $gOps; Role = $levelName },
    @{ Group = $gHr; Role = "Read" }, @{ Group = $gLegal; Role = "Read" },
    @{ Group = $gFinance; Role = "Read" }, @{ Group = $gMgmt; Role = "Read" },
    @{ Group = $gVisitors; Role = "Read" }, @{ Group = $gMembers; Role = "Read" }
)

Write-Host ""; Write-Host "==== Final verification ====" -ForegroundColor Cyan
Show-Acl "C3MissionParticipants"; Show-Acl "C3Approvals"
Write-Host @"

Post-change practical checks (Part 16 of the S29B checkpoint):
  [ ] Operations account: submit a participant-add request (create succeeds, Title backfills)
  [ ] Operations account: attempt direct edit of a C3MissionParticipants row -> denied
  [ ] Operations account: attempt edit of ANOTHER user's C3Approvals row -> denied
  [ ] Owner account: approve/reject/execute/recover -> all succeed
  [ ] Regression: existing governed submission (AddCredential) still works end-to-end
"@
