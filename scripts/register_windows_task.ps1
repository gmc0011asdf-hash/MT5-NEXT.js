#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    يسجّل Windows Scheduled Task لتشغيل MT5 Gold System عند تسجيل الدخول.

.DESCRIPTION
    ينشئ مهمة باسم "MT5 Gold System Auto Start" تعمل عند تسجيل دخول المستخدم الحالي.
    المهمة تشغّل start_mt5_gold_system.ps1 فقط — لا تنفيذ تداول.

.NOTES
    يتطلب صلاحيات Administrator لتسجيل المهمة.
    شغّل: Right-click → "Run as Administrator"
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TASK_NAME    = "MT5 Gold System Auto Start"
$SCRIPT_PATH  = "E:\PROJACT-AHMED\MT5-gold-clone\scripts\start_mt5_gold_system.ps1"
$PS_EXE       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$CURRENT_USER = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host "   MT5 Gold System — Windows Task Scheduler v1" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host ""

# ── التحقق من وجود السكربت ──────────────────────────────────────────────────
if (-not (Test-Path $SCRIPT_PATH)) {
    Write-Host "  ✗ السكربت غير موجود: $SCRIPT_PATH" -ForegroundColor Red
    Write-Host "  تأكد أن المشروع في المسار الصحيح." -ForegroundColor Yellow
    Read-Host "اضغط Enter للخروج"
    exit 1
}

# ── حذف المهمة القديمة إن وجدت ───────────────────────────────────────────────
$existingTask = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "  ⚠ مهمة موجودة بالفعل — ستُحذف وتُعاد إضافتها..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
    Write-Host "  ✓ المهمة القديمة حُذفت" -ForegroundColor Green
}

# ── تعريف المهمة ──────────────────────────────────────────────────────────────
$action = New-ScheduledTaskAction `
    -Execute $PS_EXE `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$SCRIPT_PATH`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $CURRENT_USER

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

$principal = New-ScheduledTaskPrincipal `
    -UserId $CURRENT_USER `
    -LogonType Interactive `
    -RunLevel Limited

# ── تسجيل المهمة ─────────────────────────────────────────────────────────────
try {
    Register-ScheduledTask `
        -TaskName $TASK_NAME `
        -Action   $action `
        -Trigger  $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "يشغّل MT5 + Python Bridge + Next.js + يفتح /gold عند تسجيل الدخول. لا تنفيذ تداول." `
        -Force | Out-Null

    Write-Host ""
    Write-Host "  ✓ المهمة سُجّلت بنجاح:" -ForegroundColor Green
    Write-Host "    الاسم   : $TASK_NAME" -ForegroundColor Gray
    Write-Host "    المستخدم: $CURRENT_USER" -ForegroundColor Gray
    Write-Host "    التشغيل : عند تسجيل الدخول" -ForegroundColor Gray
    Write-Host "    الملف   : $SCRIPT_PATH" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  للتحقق من المهمة:" -ForegroundColor Yellow
    Write-Host "    Get-ScheduledTask -TaskName '$TASK_NAME' | Format-List" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  للتشغيل الفوري (بدون إعادة تسجيل دخول):" -ForegroundColor Yellow
    Write-Host "    Start-ScheduledTask -TaskName '$TASK_NAME'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  لحذف المهمة:" -ForegroundColor Yellow
    Write-Host "    Unregister-ScheduledTask -TaskName '$TASK_NAME' -Confirm:`$false" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "  ✗ فشل تسجيل المهمة: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  تأكد أنك تشغّل السكربت كـ Administrator." -ForegroundColor Yellow
    exit 1
}

Read-Host "اضغط Enter للإغلاق"
