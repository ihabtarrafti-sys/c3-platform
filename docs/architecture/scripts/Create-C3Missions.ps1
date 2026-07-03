# ============================================================
# C3Missions SharePoint List Provisioning
# Sprint 26 - Phase 1
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$SiteUrl
)

# Connect
Connect-PnPOnline -Url $SiteUrl -Interactive

Write-Host "Creating C3Missions list..."

# ------------------------------------------------------------
# Create List
# ------------------------------------------------------------
$listTitle = "C3Missions"

$list = Get-PnPList -Identity $listTitle -ErrorAction SilentlyContinue

if ($null -eq $list)
{
    $list = New-PnPList `
        -Title $listTitle `
        -Template GenericList `
        -EnableVersioning $true `
        -Description "C3 mission/event commitments. Managed by C3 Platform."

    Write-Host "List created."
}
else
{
    Write-Host "List already exists."
}

# ------------------------------------------------------------
# List Settings
# ------------------------------------------------------------
Set-PnPList `
    -Identity $listTitle `
    -EnableAttachments:$false `
    -EnableVersioning:$true `
    -MajorVersions 10

# ------------------------------------------------------------
# Rename Title Column
# ------------------------------------------------------------
Set-PnPField `
    -List $listTitle `
    -Identity "Title" `
    -Values @{
        Title = "Mission ID"
        Required = $true
    }

# ------------------------------------------------------------
# Helper Function
# ------------------------------------------------------------
function Add-FieldIfMissing {
    param(
        [string]$DisplayName,
        [string]$InternalName,
        [string]$Type,
        [bool]$Required = $false,
        [string[]]$Choices = @(),
        [string]$DefaultValue = $null
    )

    $existing = Get-PnPField -List $listTitle |
        Where-Object { $_.InternalName -eq $InternalName }

    if ($existing)
    {
        Write-Host "$InternalName already exists."
        return
    }

    switch ($Type)
    {
        "Text" {
            Add-PnPField `
                -List $listTitle `
                -DisplayName $DisplayName `
                -InternalName $InternalName `
                -Type Text `
                -AddToDefaultView
        }

        "Note" {
            Add-PnPField `
                -List $listTitle `
                -DisplayName $DisplayName `
                -InternalName $InternalName `
                -Type Note
        }

        "DateTime" {
            Add-PnPField `
                -List $listTitle `
                -DisplayName $DisplayName `
                -InternalName $InternalName `
                -Type DateTime
        }

        "Boolean" {
            Add-PnPField `
                -List $listTitle `
                -DisplayName $DisplayName `
                -InternalName $InternalName `
                -Type Boolean
        }

        "Choice" {
            Add-PnPField `
                -List $listTitle `
                -DisplayName $DisplayName `
                -InternalName $InternalName `
                -Type Choice `
                -Choices $Choices
        }
    }

    if ($Required -or $DefaultValue)
    {
        Set-PnPField `
            -List $listTitle `
            -Identity $InternalName `
            -Values @{
                Required = $Required
                DefaultValue = $DefaultValue
            }
    }

    Write-Host "$InternalName created."
}

# ------------------------------------------------------------
# Columns
# ------------------------------------------------------------

Add-FieldIfMissing `
    -DisplayName "Mission Name" `
    -InternalName "Name" `
    -Type "Text" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "Game" `
    -InternalName "Game" `
    -Type "Text" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "Organizer" `
    -InternalName "Organizer" `
    -Type "Text" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "Entity" `
    -InternalName "Entity" `
    -Type "Choice" `
    -Required $true `
    -Choices @(
        "UAE",
        "KSA",
        "Multi"
    )

Add-FieldIfMissing `
    -DisplayName "Status" `
    -InternalName "MissionStatus" `
    -Type "Choice" `
    -Required $true `
    -DefaultValue "Planning" `
    -Choices @(
        "Planning",
        "FinancePending",
        "Confirmed",
        "Active",
        "PostMission",
        "Settled",
        "Canceled"
    )

Add-FieldIfMissing `
    -DisplayName "Jurisdiction" `
    -InternalName "Jurisdiction" `
    -Type "Text" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "Start Date" `
    -InternalName "StartDate" `
    -Type "DateTime" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "End Date" `
    -InternalName "EndDate" `
    -Type "DateTime" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "Settlement Date" `
    -InternalName "SettlementDate" `
    -Type "DateTime" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "Operating Currency" `
    -InternalName "OperatingCurrency" `
    -Type "Choice" `
    -Choices @(
        "USD",
        "AED",
        "SAR",
        "EUR"
    )

Add-FieldIfMissing `
    -DisplayName "Created By (Staff)" `
    -InternalName "CreatedBy" `
    -Type "Text" `
    -Required $true

Add-FieldIfMissing `
    -DisplayName "Confirmed At" `
    -InternalName "ConfirmedAt" `
    -Type "DateTime"

Add-FieldIfMissing `
    -DisplayName "Confirmed By" `
    -InternalName "ConfirmedBy" `
    -Type "Text"

Add-FieldIfMissing `
    -DisplayName "Notes" `
    -InternalName "Notes" `
    -Type "Note"

Add-FieldIfMissing `
    -DisplayName "Is Active" `
    -InternalName "IsActive" `
    -Type "Boolean" `
    -DefaultValue "1"

# ------------------------------------------------------------
# Create Indexes
# ------------------------------------------------------------
Add-PnPFieldIndex `
    -List $listTitle `
    -Field "MissionStatus"

Add-PnPFieldIndex `
    -List $listTitle `
    -Field "Entity"

# ------------------------------------------------------------
# Verification
# ------------------------------------------------------------
Write-Host ""
Write-Host "Provisioning Complete."
Write-Host ""
Write-Host "Verify Internal Names:"
Write-Host "$SiteUrl/_api/web/lists/getbytitle('C3Missions')/fields?`$select=InternalName,Title&`$filter=Hidden eq false"