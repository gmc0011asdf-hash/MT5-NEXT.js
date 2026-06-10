#Requires -Version 5.1
# ===========================================================
# start_mt5_gold_system.ps1
# نظام الملك الهندسي للتداول العالمي - سكربت التشغيل الموحد
# READ_ONLY_MODE = True | Stage 14 مقفل | لا تنفيذ تداول
# ===========================================================

# ضمان عرض النصوص بشكل صحيح
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding            = [System.Text.Encoding]::UTF8

# ---------------------------------------------------------------------------
# دوال المساعدة
# ---------------------------------------------------------------------------

function Write-Banner {
    param([string]$Text, [string]$Color = "Yellow")
    Write-Host ""
    Write-Host ("=" * 64) -ForegroundColor DarkGray
    Write-Host ("  " + $Text) -ForegroundColor $Color
    Write-Host ("=" * 64) -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Step {
    param([string]$Label, [string]$Text, [string]$Color = "Cyan")
    Write-Host ""
    Write-Host ("  " + $Label + "  " + $Text) -ForegroundColor $Color
}

function Write-Detail {
    param([string]$Text, [string]$Color = "DarkGray")
    Write-Host ("       " + $Text) -ForegroundColor $Color
}

function Write-Link {
    param([string]$Label, [string]$Url, [string]$UrlColor = "Cyan")
    Write-Host ("  " + $Label) -NoNewline -ForegroundColor Gray
    Write-Host ("  " + $Url)   -ForegroundColor $UrlColor
}

# ---------------------------------------------------------------------------
# المسارات والمنافذ
# ---------------------------------------------------------------------------

$PROJECT_ROOT  = "E:\PROJACT-AHMED\MT5-gold-clone"
$BACKEND_DIR   = Join-Path $PROJECT_ROOT "mt5_readonly_service"
$FRONTEND_DIR  = $PROJECT_ROOT
$BACKEND_PORT  = 8010
$FRONTEND_PORT = 3000
$BACKEND_URL   = "http://127.0.0.1:$BACKEND_PORT"
$FRONTEND_URL  = "http://localhost:$FRONTEND_PORT"
$HEALTH_URL    = "$BACKEND_URL/health"

# ---------------------------------------------------------------------------
# الشاشة الترحيبية
# ---------------------------------------------------------------------------

Clear-Host
$host.UI.RawUI.WindowTitle = "King Trading System - Master Console"

Write-Banner "نظام الملك الهندسي للتداول العالمي" "Yellow"
Write-Host "  READ_ONLY_MODE = True  |  Stage 14 مقفل  |  لا تنفيذ تداول" `
    -ForegroundColor DarkYellow

# ---------------------------------------------------------------------------
# خطوة 1: التحقق من المسارات
# ---------------------------------------------------------------------------

Write-Step "[1/5]" "التحقق من مسارات المشروع..." "Cyan"

if (-not (Test-Path $PROJECT_ROOT)) {
    Write-Host ""
    Write-Host "  [خطأ] مسار المشروع غير موجود: $PROJECT_ROOT" -ForegroundColor Red
    Write-Host "  عدّل قيمة PROJECT_ROOT في السكربت." -ForegroundColor DarkRed
    Read-Host "`n  اضغط Enter للخروج"
    exit 1
}

if (-not (Test-Path $BACKEND_DIR)) {
    Write-Host ""
    Write-Host "  [خطأ] مجلد الخلفية غير موجود: $BACKEND_DIR" -ForegroundColor Red
    Read-Host "`n  اضغط Enter للخروج"
    exit 1
}

Write-Detail "جذر المشروع : $PROJECT_ROOT" "Green"
Write-Detail "مجلد الخلفية: $BACKEND_DIR"  "Green"

# ---------------------------------------------------------------------------
# خطوة 2: التحقق من الأدوات
# ---------------------------------------------------------------------------

Write-Step "[2/5]" "التحقق من توافر الأدوات..." "Cyan"

# فحص Python -- يجب أن يحتوي على pandas + MetaTrader5 (محرك التحليل + جسر MT5)
$pythonCandidates = @(
    "C:\Users\Lenovo\AppData\Local\Programs\Python\Python310\python.exe",
    (Join-Path $BACKEND_DIR ".venv\Scripts\python.exe"),
    (Join-Path $PROJECT_ROOT ".venv\Scripts\python.exe"),
    "python",
    "py"
)

$pythonCmd = $null
foreach ($cand in $pythonCandidates) {
    try {
        $check = & $cand -c "import pandas, MetaTrader5" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pythonCmd = $cand
            $ver = & $cand --version 2>&1
            Write-Detail "Python  : $ver  ($cand)" "Green"
            Write-Detail "الحزم   : pandas + MetaTrader5 متوفرتان" "Green"
            break
        }
    } catch { }
}

if (-not $pythonCmd) {
    Write-Host "  [تحذير] لم يُعثر على Python يحتوي pandas + MetaTrader5." -ForegroundColor Yellow
    Write-Host "  ثبّتها عبر: pip install -r mt5_readonly_service\requirements.txt" -ForegroundColor DarkYellow
    # fallback لأي بايثون متوفر حتى لا يتوقف السكربت بالكامل
    foreach ($cand in @("python", "python3", "py")) {
        try {
            $ver = & $cand --version 2>&1
            if ($LASTEXITCODE -eq 0 -and ($ver -match "Python 3")) {
                $pythonCmd = $cand
                Write-Detail "سيُستخدم مؤقتاً: $ver ($cand)" "DarkYellow"
                break
            }
        } catch { }
    }
}

# فحص pnpm
$pnpmOk = $false
try {
    $pnpmVer = & pnpm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $pnpmOk = $true
        Write-Detail "pnpm    : v$pnpmVer" "Green"
    }
} catch { }

if (-not $pnpmOk) {
    Write-Host "  [خطأ] pnpm غير موجود. ثبّته: npm install -g pnpm" -ForegroundColor Red
    Read-Host "`n  اضغط Enter للخروج"
    exit 1
}

# فحص uvicorn
try {
    $uvVer = & uvicorn --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Detail "uvicorn : $uvVer" "Green"
    }
} catch {
    Write-Detail "uvicorn : غير موجود في PATH - سيُشغَّل عبر python -m uvicorn" "Yellow"
}

# ---------------------------------------------------------------------------
# خطوة 3: تشغيل الخلفية (FastAPI / uvicorn)
# ---------------------------------------------------------------------------

Write-Step "[3/5]" "تشغيل الخلفية FastAPI على المنفذ $BACKEND_PORT ..." "Cyan"

# بناء أوامر الخلفية في سطر واحد (بدون here-string)
# يُستخدم مفسّر Python المكتشف في الخطوة [2/5] (يحتوي pandas + MetaTrader5)
$backendLines = @(
    '$host.UI.RawUI.WindowTitle = "King Trading - FastAPI Backend :8010"',
    "Write-Host '============================================================' -ForegroundColor DarkGray",
    "Write-Host '  FastAPI Backend - نظام الملك الهندسي' -ForegroundColor Yellow",
    "Write-Host '  المنفذ  : 8010' -ForegroundColor Cyan",
    "Write-Host '  المفسّر : $pythonCmd' -ForegroundColor DarkCyan",
    "Write-Host '  الوضع   : READ_ONLY_MODE = True' -ForegroundColor Green",
    "Write-Host '  Stage 14: مقفل - لا تنفيذ تداول' -ForegroundColor DarkYellow",
    "Write-Host '  الصحة   : $HEALTH_URL' -ForegroundColor DarkGray",
    "Write-Host '============================================================' -ForegroundColor DarkGray",
    "Write-Host ''",
    "Set-Location '$BACKEND_DIR'",
    "& '$pythonCmd' -m uvicorn main:app --host 127.0.0.1 --port $BACKEND_PORT --reload",
    "Write-Host 'الخلفية توقفت.' -ForegroundColor DarkGray",
    "Read-Host 'اضغط Enter للاغلاق'"
)
$backendCmd = $backendLines -join "; "

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

Write-Detail "نافذة FastAPI فُتحت بنجاح  |  $BACKEND_URL" "Green"

# ---------------------------------------------------------------------------
# خطوة 4: انتظار تهيئة الخلفية (3 ثوانٍ)
# ---------------------------------------------------------------------------

Write-Step "[4/5]" "انتظار تهيئة الخلفية (3 ثوانٍ)..." "Cyan"

for ($i = 3; $i -ge 1; $i--) {
    Write-Host ("       " + $i + "...") -ForegroundColor DarkGray
    Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "       فحص استجابة الخلفية..." -NoNewline -ForegroundColor DarkGray

try {
    $resp = Invoke-WebRequest -Uri $HEALTH_URL -TimeoutSec 5 `
        -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
        Write-Host " جاهزة" -ForegroundColor Green
    } else {
        Write-Host " ($($resp.StatusCode))" -ForegroundColor Yellow
    }
} catch {
    Write-Host " لم تستجب بعد (تبدأ في نافذتها قريباً)" -ForegroundColor DarkYellow
}

# ---------------------------------------------------------------------------
# خطوة 5: تشغيل الواجهة الأمامية (Next.js / pnpm dev)
# ---------------------------------------------------------------------------

Write-Step "[5/5]" "تشغيل الواجهة الأمامية Next.js على المنفذ $FRONTEND_PORT ..." "Cyan"

$frontendLines = @(
    '$host.UI.RawUI.WindowTitle = "King Trading - Next.js Frontend :3000"',
    "Write-Host '============================================================' -ForegroundColor DarkGray",
    "Write-Host '  Next.js 16 Frontend - نظام الملك الهندسي' -ForegroundColor Yellow",
    "Write-Host '  المنفذ  : $FRONTEND_PORT' -ForegroundColor Cyan",
    "Write-Host '  المحرك  : Turbopack' -ForegroundColor Green",
    "Write-Host '  الرابط  : $FRONTEND_URL' -ForegroundColor DarkCyan",
    "Write-Host '============================================================' -ForegroundColor DarkGray",
    "Write-Host ''",
    "Set-Location '$FRONTEND_DIR'",
    "pnpm dev",
    "Write-Host 'الواجهة توقفت.' -ForegroundColor DarkGray",
    "Read-Host 'اضغط Enter للاغلاق'"
)
$frontendCmd = $frontendLines -join "; "

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Detail "نافذة Next.js فُتحت بنجاح  |  $FRONTEND_URL" "Green"

# ---------------------------------------------------------------------------
# ملخص الروابط والحالة
# ---------------------------------------------------------------------------

Write-Banner "النظام يعمل الآن" "Green"

Write-Host "  الصفحات الرئيسية:" -ForegroundColor White
Write-Host ""
Write-Link "  لوحة القيادة      :" "$FRONTEND_URL/dashboard"
Write-Link "  طرفية الذهب MT5  :" "$FRONTEND_URL/lab/mt5"
Write-Link "  Gold Pro Lab      :" "$FRONTEND_URL/lab/gold-pro"
Write-Link "  مختبر الجدار الثلاثي:" "$FRONTEND_URL/lab/triple-firewall"
Write-Link "  طرفية الكريبتو   :" "$FRONTEND_URL/lab/okx"
Write-Link "  سجل القرارات     :" "$FRONTEND_URL/decision-journal"
Write-Link "  رادار الأخبار    :" "$FRONTEND_URL/reports"
Write-Link "  الإعدادات        :" "$FRONTEND_URL/settings"

Write-Host ""
Write-Host "  واجهات الخلفية (API):" -ForegroundColor White
Write-Host ""
Write-Link "  فحص الصحة        :" "$HEALTH_URL"                                     "DarkGray"
Write-Link "  آخر الإشارات     :" "$BACKEND_URL/api/signals?limit=10"               "DarkGray"
Write-Link "  سجل القرارات     :" "$BACKEND_URL/api/journal?limit=10"               "DarkGray"
Write-Link "  إعدادات المحرك   :" "$BACKEND_URL/api/config"                         "DarkGray"
Write-Link "  الجدار الثلاثي   :" "$BACKEND_URL/api/triple-firewall/signals?limit=10" "DarkGray"
Write-Link "  ساعة الجلسات     :" "$BACKEND_URL/api/triple-firewall/session"          "DarkGray"
Write-Link "  WebSocket         :" "ws://127.0.0.1:$BACKEND_PORT/ws/live-market"     "DarkGray"

Write-Host ""
Write-Host ("  " + "-" * 60) -ForegroundColor DarkGray
Write-Host ""
Write-Host "  [تذكير] افتح MetaTrader 5 للحصول على بيانات XAUUSD حقيقية." `
    -ForegroundColor Yellow
Write-Host "  [أمان]  READ_ONLY_MODE = True - Stage 14 مقفل - لا تنفيذ آلي." `
    -ForegroundColor DarkYellow
Write-Host ""
Write-Host ("=" * 64) -ForegroundColor DarkGray
Write-Host "  لإيقاف النظام: أغلق نوافذ FastAPI و Next.js منفصلةً." `
    -ForegroundColor DarkGray
Write-Host "  هذه النافذة يمكن إغلاقها الآن." -ForegroundColor DarkGray
Write-Host ("=" * 64) -ForegroundColor DarkGray
Write-Host ""