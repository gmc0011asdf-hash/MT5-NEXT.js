"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  Activity,
  Bell,
  Shield,
  Save,
  RotateCcw,
  Info,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
} from "lucide-react";

const FASTAPI_BASE = "http://127.0.0.1:8010";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Mt5Status {
  connected:     boolean;
  account_login: number | null;
  name:          string | null;
  server:        string | null;
  balance:       number | null;
  equity:        number | null;
  currency:      string | null;
  error?:        string | null;
}

interface HealthStatus {
  status:             string;
  read_only_mode:     boolean;
  build_version:      string;
  uptime_seconds:     number;
  mt5_connected:      boolean;
  symbols_configured: string[];
  detail:             string | null;
}

interface ConfigMap {
  ema_length:         string;
  rsi_length:         string;
  atr_length:         string;
  bb_length:          string;
  bb_std:             string;
  atr_sl_mult:        string;
  atr_tp_mult:        string;
  min_rr:             string;
  telegram_bot_token: string;
  telegram_chat_id:   string;
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// Engine defaults
// ---------------------------------------------------------------------------

const ENGINE_DEFAULTS: Omit<ConfigMap, "telegram_bot_token" | "telegram_chat_id"> = {
  ema_length:  "200",
  rsi_length:  "14",
  atr_length:  "14",
  bb_length:   "20",
  bb_std:      "2.0",
  atr_sl_mult: "1.5",
  atr_tp_mult: "3.0",
  min_rr:      "2.0",
};

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function fetchMt5Status(): Promise<Mt5Status> {
  const res = await fetch("/api/mt5-readonly/connection-status", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Mt5Status>;
}

async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${FASTAPI_BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HealthStatus>;
}

async function fetchConfig(): Promise<{ ok: boolean; config: ConfigMap }> {
  const res = await fetch(`${FASTAPI_BASE}/api/config`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function saveConfigBatch(entries: { key: string; value: string }[]) {
  const res = await fetch(`${FASTAPI_BASE}/api/config/batch`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function deleteConfigKey(key: string) {
  const res = await fetch(`${FASTAPI_BASE}/api/config/${key}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// localStorage helpers (demo settings — not sent to server)
// ---------------------------------------------------------------------------

const LS_DEMO_LOT   = "demo_lot_size";
const LS_DEMO_ALERT = "demo_audio_alerts";

function loadDemoSettings() {
  return {
    lot:   parseFloat(localStorage.getItem(LS_DEMO_LOT)   ?? "0.01"),
    alert: localStorage.getItem(LS_DEMO_ALERT) !== "false",
  };
}

function saveDemoSettings(lot: number, alert: boolean) {
  localStorage.setItem(LS_DEMO_LOT,   String(lot));
  localStorage.setItem(LS_DEMO_ALERT, String(alert));
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
  sub,
  color = "text-amber-400",
}: {
  icon:   React.ElementType;
  title:  string;
  sub?:   string;
  color?: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25 shrink-0">
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground/80 leading-relaxed">
      <Info className="h-3 w-3 shrink-0 mt-0.5" />
      {children}
    </p>
  );
}

function SaveToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-emerald-400 animate-in fade-in">
      <CheckCircle2 className="h-3.5 w-3.5" />
      تم الحفظ
    </span>
  );
}

// ---------------------------------------------------------------------------
// MT5 Connection Card
// ---------------------------------------------------------------------------

function Mt5ConnectionCard() {
  const { data: status, isLoading, isError, refetch, isFetching } =
    useQuery<Mt5Status>({
      queryKey:        ["settings-mt5-status"],
      queryFn:         fetchMt5Status,
      refetchInterval: 30_000,
      retry:           false,
    });

  const connected = status?.connected === true;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <SectionHeader
        icon={Wifi}
        title="حالة اتصال MT5"
        sub="قراءة فقط — لا تنفيذ تداول"
      />

      {isLoading && (
        <div className="h-20 rounded-lg bg-muted/30 animate-pulse" />
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
          <WifiOff className="h-4 w-4 text-rose-400 shrink-0" />
          <span className="text-sm text-rose-300">تعذر الوصول — تأكد من تشغيل خدمة FastAPI</span>
        </div>
      )}

      {status && (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 ${
              connected
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-rose-500/20 bg-rose-500/5"
            }`}
          >
            {connected ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <span className={`text-sm font-medium ${connected ? "text-emerald-300" : "text-rose-300"}`}>
              {connected ? "متصل بـ MetaTrader 5" : "غير متصل"}
            </span>
          </div>

          {connected && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "رقم الحساب",   value: status.account_login ?? "—" },
                { label: "اسم الحساب",   value: status.name ?? "—"          },
                { label: "الخادم",       value: status.server ?? "—"        },
                { label: "الرصيد",       value: status.balance != null ? `${status.balance} ${status.currency ?? ""}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border/50 bg-background/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-mono text-sm text-foreground">{String(value)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => refetch()}
        disabled={isFetching}
        className="mt-4 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-amber-500/30 transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        تحديث الحالة
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Scan Card
// ---------------------------------------------------------------------------

const MT5_SCAN_SYMBOLS  = ["XAUUSD"];
const OKX_SCAN_SYMBOLS  = ["BTC-USDT", "ETH-USDT"];

function AgentScanCard() {
  const { data, isLoading, isError } = useQuery<HealthStatus>({
    queryKey:        ["settings-health"],
    queryFn:         fetchHealth,
    refetchInterval: 60_000,
    retry:           false,
  });

  const uptimeMins = data?.uptime_seconds != null ? Math.floor(data.uptime_seconds / 60) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <SectionHeader
        icon={Activity}
        title="محرك المسح الآلي"
        sub="إعدادات الوكلاء التحليليين — للعرض فقط"
      />

      {isLoading && <div className="h-24 rounded-lg bg-muted/30 animate-pulse" />}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-sm text-amber-300">
            خدمة FastAPI غير متاحة — ابدأ التشغيل من الطرفية
          </span>
        </div>
      )}

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-sm">
            {[
              { label: "حالة الخدمة",  value: data.status === "ok" ? "تعمل" : data.status,      color: data.status === "ok" ? "text-emerald-400" : "text-amber-400" },
              { label: "وضع القراءة",  value: data.read_only_mode ? "محمي - قراءة فقط" : "غير محمي", color: data.read_only_mode ? "text-emerald-400" : "text-rose-400"    },
              { label: "وقت التشغيل", value: uptimeMins != null ? `${uptimeMins} دقيقة` : "—",    color: "text-foreground"                                              },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-border/50 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-sm font-medium ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Symbols always shown — static config */}
      <div className="mt-3 space-y-2">
        <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-xs font-medium text-muted-foreground">رموز MT5 (الذهب)</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MT5_SCAN_SYMBOLS.map((sym) => (
              <span key={sym} className="rounded px-2 py-0.5 text-xs font-mono bg-amber-500/10 border border-amber-500/20 text-amber-300">
                {sym}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Globe className="h-3.5 w-3.5 text-cyan-400" />
            <p className="text-xs font-medium text-muted-foreground">رموز OKX (كريبتو)</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {OKX_SCAN_SYMBOLS.map((sym) => (
              <span key={sym} className="rounded px-2 py-0.5 text-xs font-mono bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                {sym}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground/70">
        الإطار الزمني الافتراضي: <span className="font-mono">H1</span> — قابل للتغيير عبر متغير البيئة{" "}
        <span className="font-mono">AGENT_SCAN_BAR</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Telegram Configuration Card
// ---------------------------------------------------------------------------

function TelegramCard({
  config,
  onSaved,
}: {
  config:  ConfigMap | undefined;
  onSaved: () => void;
}) {
  const [token,    setToken]    = useState("");
  const [chatId,   setChatId]   = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testDetail, setTestDetail] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      // Token is masked from server — don't prefill it (security)
      setChatId(config.telegram_chat_id ?? "");
    }
  }, [config]);

  async function handleSave() {
    const entries = [];
    if (token.trim())    entries.push({ key: "telegram_bot_token", value: token.trim() });
    if (chatId.trim())   entries.push({ key: "telegram_chat_id",   value: chatId.trim() });
    if (entries.length === 0) return;

    try {
      await saveConfigBatch(entries);
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* ignore */
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setTestDetail(null);
    try {
      const res = await fetch(`${FASTAPI_BASE}/api/telegram/test`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setTestResult("ok");
      } else {
        setTestResult("fail");
        setTestDetail(typeof json?.detail === "string" ? json.detail : null);
      }
    } catch (e) {
      setTestResult("fail");
      setTestDetail(
        e instanceof TypeError
          ? "تعذّر الوصول إلى خدمة MT5 المحلية (127.0.0.1:8010) — تأكد من تشغيلها"
          : null
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <SectionHeader
        icon={Bell}
        title="إعدادات اتصال تليجرام"
        sub="يُرسل تنبيهاً تلقائياً عند كل إشارة مقبولة من مجلس الوكلاء"
      />

      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <Shield className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/80 leading-relaxed">
            التوكن يُحفظ في قاعدة البيانات المحلية — لا يُرسل خارج الجهاز. الإشارات
            للأغراض المعلوماتية فقط — Stage 14 مقفل.
          </p>
        </div>

        {/* Bot Token */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Bot Token
          </label>
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="أدخل توكن البوت الجديد..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/50 pr-10"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShowToken((p) => !p)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <FieldHint>
            احصل على التوكن من @BotFather في تليجرام. اتركه فارغاً إذا لم تريد تغيير التوكن المحفوظ.
          </FieldHint>
        </div>

        {/* Chat ID */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Chat ID
          </label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="مثال: -100123456789"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/50"
            dir="ltr"
          />
          <FieldHint>
            معرّف القناة أو المجموعة التي سيُرسل إليها النظام التنبيهات.
          </FieldHint>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
          >
            <Save className="h-4 w-4" />
            حفظ الإعدادات
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {testing ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
            اختبار الإشعار
          </button>

          <SaveToast visible={saved} />

          {testResult === "ok" && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              تم الإرسال
            </span>
          )}
          {testResult === "fail" && (
            <span className="flex items-center gap-1 text-xs text-rose-400">
              <XCircle className="h-3.5 w-3.5" />
              فشل في التحقق من الإعدادات
            </span>
          )}
        </div>

        {testResult === "fail" && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-200/90 leading-relaxed" dir="rtl">
            <p className="font-medium text-rose-300">سبب الفشل:</p>
            <p className="mt-1 font-mono break-words" dir="ltr">
              {testDetail ?? "تعذّر التحقق من إعدادات تليجرام — تحقق من Token وChat ID والاتصال بالإنترنت"}
            </p>
            <ul className="mt-2 list-disc pr-4 space-y-0.5 text-rose-200/70">
              <li>تأكد من نسخ التوكن كاملاً من @BotFather (يبدأ برقم ثم نقطتين).</li>
              <li>تأكد من أنك أرسلت /start للبوت أو أضفته إلى القناة/المجموعة.</li>
              <li>تأكد من اتصال الجهاز الذي يشغّل الخدمة المحلية بالإنترنت.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine Settings Card
// ---------------------------------------------------------------------------

interface EngineField {
  key:   string;
  label: string;
  hint:  string;
  step:  number;
  min:   number;
  max:   number;
  isInt: boolean;
}

const ENGINE_FIELDS: EngineField[] = [
  {
    key:   "ema_length",
    label: "فترة EMA للاتجاه",
    hint:  "المتوسط الأسي الذي يحدد الاتجاه الرئيسي. زيادته تجعل المحرك أكثر تحفظاً ويتجاهل الحركات قصيرة الأمد. الافتراضي 200 مناسب للأطر الزمنية اليومية وH4.",
    step:  1,
    min:   20,
    max:   500,
    isInt: true,
  },
  {
    key:   "rsi_length",
    label: "فترة RSI للزخم",
    hint:  "فترة مؤشر قوة الاتجاه النسبية. القيم الأصغر (مثل 7) أكثر حساسية وتعطي إشارات أكثر. القيم الأكبر (مثل 21) أقل إشارات لكن أكثر دقة. الافتراضي 14 هو المعيار العالمي.",
    step:  1,
    min:   5,
    max:   50,
    isInt: true,
  },
  {
    key:   "atr_sl_mult",
    label: "مضاعف ATR لوقف الخسارة",
    hint:  "بُعد وقف الخسارة = ATR × هذا المضاعف. تقليله يضيّق الوقف مما يزيد المخاطرة. تكبيره يوسّع الوقف ويقلل الإشارات الزائفة. الافتراضي 1.5 يوفر توازناً جيداً.",
    step:  0.1,
    min:   0.5,
    max:   5.0,
    isInt: false,
  },
  {
    key:   "atr_tp_mult",
    label: "مضاعف ATR للهدف",
    hint:  "بُعد الهدف = ATR × هذا المضاعف. القسمة على مضاعف SL تعطي نسبة المخاطرة/المكافأة. الافتراضي 3.0 مع SL 1.5 يعطي نسبة 1:2. ابقِ هذا القيمة دائماً أكبر من مضاعف SL.",
    step:  0.1,
    min:   1.0,
    max:   10.0,
    isInt: false,
  },
  {
    key:   "min_rr",
    label: "الحد الأدنى لنسبة المخاطرة/المكافأة",
    hint:  "المحرك يرفض الإشارات إذا كانت نسبة RR أقل من هذه القيمة. الافتراضي 2.0 يعني أن الهدف يجب أن يكون ضعف المخاطرة على الأقل. قيم أعلى تعني إشارات أقل لكن أجودة.",
    step:  0.1,
    min:   1.0,
    max:   5.0,
    isInt: false,
  },
];

function EngineSettingsCard({
  config,
  onSaved,
}: {
  config:  ConfigMap | undefined;
  onSaved: () => void;
}) {
  const [values, setValues]   = useState<Record<string, string>>({});
  const [saved,  setSaved]    = useState(false);
  const [resetting, setReset] = useState(false);

  useEffect(() => {
    if (config) {
      const init: Record<string, string> = {};
      ENGINE_FIELDS.forEach(({ key }) => {
        init[key] = config[key] ?? ENGINE_DEFAULTS[key];
      });
      setValues(init);
    }
  }, [config]);

  async function handleSave() {
    const entries = ENGINE_FIELDS.map(({ key }) => ({
      key,
      value: values[key] ?? ENGINE_DEFAULTS[key],
    }));
    try {
      await saveConfigBatch(entries);
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* ignore */
    }
  }

  async function handleReset() {
    setReset(true);
    try {
      for (const { key } of ENGINE_FIELDS) {
        await deleteConfigKey(key);
      }
      // Revert local state to defaults
      const defaults: Record<string, string> = {};
      ENGINE_FIELDS.forEach(({ key }) => { defaults[key] = ENGINE_DEFAULTS[key]; });
      setValues(defaults);
      onSaved();
    } catch {
      /* ignore */
    } finally {
      setReset(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <SectionHeader
        icon={FlaskConical}
        title="إعدادات محرك التحليل"
        sub="معاملات المؤشرات الفنية — تؤثر فوراً على دقة الوكلاء"
      />

      <div className="space-y-5">
        {ENGINE_FIELDS.map(({ key, label, hint, step, min, max, isInt }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {label}
              <span className="mr-2 tabular-nums text-xs text-muted-foreground font-mono font-normal">
                (الافتراضي: {ENGINE_DEFAULTS[key]})
              </span>
            </label>
            <input
              type="number"
              value={values[key] ?? ENGINE_DEFAULTS[key]}
              onChange={(e) =>
                setValues((p) => ({ ...p, [key]: e.target.value }))
              }
              step={step}
              min={min}
              max={max}
              className="w-36 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground tabular-nums focus:outline-none focus:border-amber-500/50"
              dir="ltr"
            />
            <FieldHint>{hint}</FieldHint>
          </div>
        ))}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/50">
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
          >
            <Save className="h-4 w-4" />
            حفظ الإعدادات
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-rose-500/30 transition-colors disabled:opacity-50"
          >
            {resetting ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            استعادة الإعدادات الافتراضية
          </button>

          <SaveToast visible={saved} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo Analysis Settings Card (localStorage only)
// ---------------------------------------------------------------------------

function DemoSettingsCard() {
  const [mounted, setMounted] = useState(false);
  const [lot,     setLot]     = useState(0.01);
  const [alert,   setAlert]   = useState(true);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    const s = loadDemoSettings();
    setLot(s.lot);
    setAlert(s.alert);
    setMounted(true);
  }, []);

  function handleSave() {
    saveDemoSettings(lot, alert);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!mounted) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <SectionHeader
        icon={Shield}
        title="إعدادات التحليل التجريبي"
        sub="محفوظة في المتصفح — للعرض التحليلي فقط"
      />

      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <Shield className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-200/80">
            Stage 14 مقفل — لا تنفيذ آلي — لأغراض العرض المعلوماتي فقط
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            حجم اللوت الافتراضي (للعرض)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={lot}
              onChange={(e) => setLot(parseFloat(e.target.value) || 0.01)}
              step={0.01}
              min={0.01}
              max={100}
              className="w-32 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground tabular-nums focus:outline-none focus:border-amber-500/50"
              dir="ltr"
            />
            <span className="text-xs text-muted-foreground">لوت (معلوماتي فقط)</span>
          </div>
          <FieldHint>
            يُستخدم في عرض السيناريوهات التحليلية فقط — لا يُرسل لأي منصة تداول.
          </FieldHint>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">تنبيهات صوتية</p>
            <p className="text-xs text-muted-foreground">صوت عند ظهور إشارة جديدة في الواجهة</p>
          </div>
          <button
            type="button"
            onClick={() => setAlert((p) => !p)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              alert ? "bg-amber-500" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                alert ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
        >
          {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? "تم الحفظ" : "حفظ الإعدادات"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OKX Settings Card
// ---------------------------------------------------------------------------

function OkxSettingsCard({
  config,
  onSaved,
}: {
  config:  ConfigMap | undefined;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [apiName, setApiName] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testDetail, setTestDetail] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setApiKey(config.okx_api_key ?? "");
      setSecretKey(config.okx_secret_key ?? "");
      setApiName(config.okx_api_name ?? "");
    }
  }, [config]);

  async function handleSave() {
    const entries = [];
    if (apiKey.trim()) entries.push({ key: "okx_api_key", value: apiKey.trim() });
    if (secretKey.trim()) entries.push({ key: "okx_secret_key", value: secretKey.trim() });
    if (apiName.trim()) entries.push({ key: "okx_api_name", value: apiName.trim() });
    
    // Even if empty, we might want to clear them, but saveConfigBatch doesn't delete.
    if (entries.length === 0) return;

    try {
      await saveConfigBatch(entries);
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* ignore */
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setTestDetail(null);
    try {
      const res = await fetch(`${FASTAPI_BASE}/api/telegram/test-connections`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setTestResult("ok");
      } else {
        setTestResult("fail");
        setTestDetail(typeof json?.detail === "string" ? json.detail : null);
      }
    } catch (e) {
      setTestResult("fail");
      setTestDetail("تعذّر الاتصال بالخادم المحلي.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <SectionHeader
        icon={Globe}
        title="إعدادات اتصال OKX"
        sub="بيانات الـ API الخاصة بمنصة OKX لتأكيد الاتصال والمتابعة"
        color="text-cyan-400"
      />

      <div className="space-y-4">
        {/* API Key */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            API Key (apikey)
          </label>
          <div className="relative">
            <input
              type={showKeys ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="eb2b200f-..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/50 pr-10"
              dir="ltr"
            />
          </div>
        </div>

        {/* API Name */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            اسم مفتاح API (اختياري)
          </label>
          <div className="relative">
            <input
              type="text"
              value={apiName}
              onChange={(e) => setApiName(e.target.value)}
              placeholder="okx-readonly-test"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/50"
              dir="ltr"
            />
          </div>
        </div>

        {/* Secret Key */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Secret Key (secretkey)
          </label>
          <div className="relative">
            <input
              type={showKeys ? "text" : "password"}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="F561D1CC..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/50 pr-10"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShowKeys((p) => !p)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-4 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-500/20 transition-colors"
          >
            <Save className="h-4 w-4" />
            حفظ الإعدادات
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {testing ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
            اختبار الاتصال بـ MT5 و OKX
          </button>

          <SaveToast visible={saved} />

          {testResult === "ok" && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              تم إرسال رسالة نجاح الاتصال إلى تليجرام
            </span>
          )}
          {testResult === "fail" && (
            <span className="flex items-center gap-1 text-xs text-rose-400">
              <XCircle className="h-3.5 w-3.5" />
              فشل الاختبار: {testDetail}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const qc = useQueryClient();

  const { data: configData } = useQuery({
    queryKey:        ["system-config"],
    queryFn:         fetchConfig,
    refetchInterval: false,
    retry:           false,
    staleTime:       Infinity,
  });

  const config = configData?.config;

  function invalidateConfig() {
    void qc.invalidateQueries({ queryKey: ["system-config"] });
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">

        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
            <Settings className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">الإعدادات المحلية</h1>
            <p className="text-xs text-muted-foreground">
              نظام محكوم بالقواعد — بيانات محلية فقط
            </p>
          </div>
        </div>

        {/* Local-mode notice */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <Server className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-200/80 leading-relaxed">
            جميع الإعدادات محفوظة في قاعدة البيانات المحلية{" "}
            <span className="font-mono">local_quant.db</span> — لا اتصال بخوادم
            خارجية — التغييرات تُطبَّق فوراً على دورة المسح القادمة.
          </p>
        </div>

        <Mt5ConnectionCard />
        <AgentScanCard />
        <TelegramCard    config={config} onSaved={invalidateConfig} />
        <OkxSettingsCard config={config} onSaved={invalidateConfig} />
        <EngineSettingsCard config={config} onSaved={invalidateConfig} />
        <DemoSettingsCard />

        <p className="text-center text-xs text-muted-foreground/60 pb-4">
          نظام الملك الهندسي للتداول العالمي — محكوم بالقواعد — Stage 14 مقفل
        </p>
      </div>
    </div>
  );
}
