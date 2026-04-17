<#
.SYNOPSIS
    Enable Exchange Web Services (EWS) on the entire Exchange Online tenant.
.DESCRIPTION
    - Enables EWS at the organization level
    - Enables EWS on all CAS Mailbox Plans (future users)
    - Enables EWS on all existing mailboxes
.PARAMETER AdminUPN
    Admin UPN. Prompted interactively if omitted.
.PARAMETER WhatIf
    Simulates changes without applying them.
#>
[CmdletBinding(SupportsShouldProcess)]
param()

# --- Bootstrap: update NuGet + PowerShellGet first ---------------------------
Write-Host "[+] Updating NuGet provider..." -ForegroundColor Yellow
Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null

Write-Host "[+] Updating PowerShellGet..." -ForegroundColor Yellow
Install-Module -Name PowerShellGet -Force -AllowClobber -Scope CurrentUser | Out-Null

# Reload the updated PowerShellGet into the current session
Remove-Module PowerShellGet, PackageManagement -Force -ErrorAction SilentlyContinue
Import-Module PowerShellGet -Force

# --- Install ExchangeOnlineManagement if missing ------------------------------
if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
    Write-Host "[+] Installing ExchangeOnlineManagement module..." -ForegroundColor Yellow
    Install-Module -Name ExchangeOnlineManagement -Force -AllowClobber -Scope CurrentUser
}

Import-Module ExchangeOnlineManagement -ErrorAction Stop

# --- Organization level -------------------------------------------------------
Write-Host ""
Write-Host "[+] Enabling EWS at organization level..." -ForegroundColor Cyan

$orgBefore = Get-OrganizationConfig | Select-Object EwsEnabled, EwsApplicationAccessPolicy
Write-Host "    Before: EwsEnabled=$($orgBefore.EwsEnabled)  Policy=$($orgBefore.EwsApplicationAccessPolicy)"

if ($PSCmdlet.ShouldProcess("OrganizationConfig", "Set EwsEnabled = True")) {
    Set-OrganizationConfig -EwsEnabled $true
}

# --- CAS Mailbox Plans (future users) ----------------------------------------
Write-Host ""
Write-Host "[+] Enabling EWS on all CAS Mailbox Plans..." -ForegroundColor Cyan

$plans = Get-CASMailboxPlan
foreach ($plan in $plans) {
    Write-Host "    Plan: $($plan.Name)  (EwsEnabled=$($plan.EwsEnabled))"
    if ($PSCmdlet.ShouldProcess($plan.Name, "Set-CASMailboxPlan EwsEnabled = True")) {
        Set-CASMailboxPlan -Identity $plan.Identity -EwsEnabled $true
    }
}

# --- Existing mailboxes -------------------------------------------------------
Write-Host ""
Write-Host "[+] Fetching all mailboxes..." -ForegroundColor Cyan

$mailboxes = Get-CASMailbox -ResultSize Unlimited | Where-Object { $_.EwsEnabled -ne $true }
$total     = $mailboxes.Count

if ($total -eq 0) {
    Write-Host "    EWS is already enabled on all mailboxes." -ForegroundColor Green
} else {
    Write-Host "    $total mailbox(es) to update." -ForegroundColor Yellow
    $i = 0
    foreach ($mbx in $mailboxes) {
        $i++
        $pct = [int](($i / $total) * 100)
        Write-Progress -Activity "Enabling EWS" `
                       -Status "$i / $total - $($mbx.DisplayName)" `
                       -PercentComplete $pct

        if ($PSCmdlet.ShouldProcess($mbx.Identity, "Set-CASMailbox EwsEnabled = True")) {
            Set-CASMailbox -Identity $mbx.Identity -EwsEnabled $true
        }
    }
    Write-Progress -Activity "Enabling EWS" -Completed
    Write-Host "    $total mailbox(es) updated." -ForegroundColor Green
}

# --- Verification -------------------------------------------------------------
Write-Host ""
Write-Host "[+] Final verification..." -ForegroundColor Cyan

$orgAfter = Get-OrganizationConfig | Select-Object EwsEnabled, EwsApplicationAccessPolicy
Write-Host "    OrganizationConfig:"
$orgAfter | Format-List

$stillDisabled = (Get-CASMailbox -ResultSize Unlimited | Where-Object { $_.EwsEnabled -ne $true }).Count
if ($stillDisabled -gt 0) {
    Write-Warning "    $stillDisabled mailbox(es) still have EwsEnabled = False. Check manually."
} else {
    Write-Host "    All mailboxes have EwsEnabled = True." -ForegroundColor Green
}

Write-Host ""
Write-Host "[OK] EWS enabled on the entire tenant." -ForegroundColor Green
