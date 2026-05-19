# MT5 Gold System — Runtime Launcher v1

نظام تشغيل محلي يفتح MetaTrader 5 + Python Bridge + Next.js + صفحة /gold بضغطة واحدة.

---

## المتطلبات

| المتطلب | التحقق |
|---|---|
| MetaTrader 5 | مثبّت في `C:\Program Files\MetaTrader 5\terminal64.exe` |
| Python + uvicorn | `pip install uvicorn fastapi` |
| Node.js + pnpm | `npm install -g pnpm` |
| PowerShell 5.1+ | مثبّت افتراضياً في Windows 10/11 |

---

## التشغيل اليدوي

### الطريقة 1: PowerShell مباشرة

```powershell
# افتح PowerShell كمستخدم عادي (لا حاجة لـ Administrator)
cd E:\PROJACT-AHMED\MT5-gold-clone
powershell -ExecutionPolicy Bypass -File scripts\start_mt5_gold_system.ps1
```

### الطريقة 2: Double-click

انقر بالزر الأيمن على `scripts\start_mt5_gold_system.ps1` ← **Run with PowerShell**

### الطريقة 3: تشغيل منفصل (يدوي كامل)

```powershell
# 1. فتح MetaTrader 5
Start-Process "C:\Program Files\MetaTrader 5\terminal64.exe"

# 2. تشغيل Python Bridge (نافذة منفصلة)
cd E:\PROJACT-AHMED\MT5-gold-clone\mt5_readonly_service
$env:MT5_DEMO_EXECUTION_ENABLED = "1"
uvicorn main:app --host 127.0.0.1 --port 8010 --reload

# 3. تشغيل Next.js (نافذة منفصلة)
cd E:\PROJACT-AHMED\MT5-gold-clone
pnpm dev

# 4. فتح المتصفح
Start-Process "http://localhost:3000/gold"
```

---

## تسجيل المهمة التلقائية (عند الدخول)

```powershell
# افتح PowerShell كـ Administrator
# Right-click PowerShell → "Run as Administrator"

cd E:\PROJACT-AHMED\MT5-gold-clone
powershell -ExecutionPolicy Bypass -File scripts\register_windows_task.ps1
```

المهمة ستعمل عند كل تسجيل دخول Windows تلقائياً.

---

## تشغيل المهمة فوراً (بدون إعادة دخول)

```powershell
Start-ScheduledTask -TaskName "MT5 Gold System Auto Start"
```

---

## إيقاف المهمة مؤقتاً

```powershell
Disable-ScheduledTask -TaskName "MT5 Gold System Auto Start"
```

## إعادة تفعيل المهمة

```powershell
Enable-ScheduledTask -TaskName "MT5 Gold System Auto Start"
```

## حذف المهمة نهائياً

```powershell
Unregister-ScheduledTask -TaskName "MT5 Gold System Auto Start" -Confirm:$false
```

---

## التحقق من الاتصال

بعد تشغيل النظام، تحقق من كل مكوّن:

### Python Bridge (MT5 Service)
```powershell
curl.exe http://127.0.0.1:8010/health
# Expected: {"status":"ok","read_only_mode":true,"mt5_connected":...}
```

### Next.js + MT5 Connection
```powershell
curl.exe http://localhost:3000/api/mt5-readonly/connection-status
# Expected: {"connected":true/false,"read_only":true,...}
```

### فتح /gold مباشرة
```powershell
Start-Process "http://localhost:3000/gold"
```

---

## حل المشاكل الشائعة

### Python لا تبدأ على port 8010
```powershell
# تحقق من المنفذ
netstat -an | findstr :8010

# إنهاء العملية التي تشغل المنفذ
$pid = (Get-NetTCPConnection -LocalPort 8010).OwningProcess
Stop-Process -Id $pid -Force
```

### Next.js يستخدم port 3001 بدل 3000
```powershell
# تحقق
netstat -an | findstr :3000
# إذا 3000 مستخدم، سيتحول Next.js تلقائياً لـ 3001
Start-Process "http://localhost:3001/gold"
```

### MetaTrader 5 في مسار مختلف
عدّل المتغير `$MT5_EXE` في `start_mt5_gold_system.ps1`:
```powershell
$MT5_EXE = "C:\Users\YourName\AppData\Roaming\MetaQuotes\Terminal\<ID>\terminal64.exe"
```

### تفعيل التنفيذ عبر MT5
```
# أضف في .env.local
MT5_DEMO_EXECUTION_ENABLED=true

# أضف في بيئة Python عند التشغيل
$env:MT5_DEMO_EXECUTION_ENABLED = "1"
```

**ملاحظة:** تفعيل `MT5_DEMO_EXECUTION_ENABLED` لا يغيّر شروط الحوكمة. الحراس والـ Kill Switch والـ Hard Blocks تبقى فعّالة.

---

## الملفات

| الملف | الوصف |
|---|---|
| `scripts/start_mt5_gold_system.ps1` | سكربت التشغيل الرئيسي |
| `scripts/register_windows_task.ps1` | تسجيل المهمة في Task Scheduler |
| `scripts/README-runtime-launcher.md` | هذا الملف |

---

## ملاحظات الأمان

- السكربت لا يحتوي على بيانات اعتماد أو أسرار.
- `MT5_DEMO_EXECUTION_ENABLED=1` يمكّن endpoint التنفيذ في Python فقط — لا يلغي الحراس.
- Kill Switch يبقى فعّالاً دائماً بغض النظر عن أي إعداد.
- لا تنفيذ تداول تلقائي في أي مرحلة.
