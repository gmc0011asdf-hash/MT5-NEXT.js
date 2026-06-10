"use client";

import { useState, useMemo } from "react";
import {
  FileText,
  TrendingUp,
  Minus,
  AlertTriangle,
  Calendar,
  Globe,
  Clock,
  RefreshCw,
  Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImpactLevel = "high" | "medium" | "low";
type EventStatus = "upcoming" | "released";

interface EconomicEvent {
  id:       number;
  time:     string;
  country:  string;
  flag:     string;
  event:    string;
  impact:   ImpactLevel;
  previous: string;
  forecast: string;
  actual:   string | null;
  status:   EventStatus;
  affects:  string[];
}

// ---------------------------------------------------------------------------
// Static demo data (هيكل بياني تجريبي — يُستبدل بـ API حقيقي لاحقاً)
// ---------------------------------------------------------------------------

const DEMO_EVENTS: EconomicEvent[] = [
  {
    id:       1,
    time:     "15:30",
    country:  "الولايات المتحدة",
    flag:     "US",
    event:    "مؤشر أسعار المستهلك (CPI) - الشهري",
    impact:   "high",
    previous: "0.4%",
    forecast: "0.3%",
    actual:   null,
    status:   "upcoming",
    affects:  ["XAUUSD", "DXY", "EURUSD"],
  },
  {
    id:       2,
    time:     "15:30",
    country:  "الولايات المتحدة",
    flag:     "US",
    event:    "طلبات إعانة البطالة الأسبوعية",
    impact:   "medium",
    previous: "218K",
    forecast: "220K",
    actual:   null,
    status:   "upcoming",
    affects:  ["XAUUSD", "DXY"],
  },
  {
    id:       3,
    time:     "17:00",
    country:  "الولايات المتحدة",
    flag:     "US",
    event:    "مبيعات التجزئة الشهرية",
    impact:   "high",
    previous: "0.6%",
    forecast: "0.4%",
    actual:   null,
    status:   "upcoming",
    affects:  ["XAUUSD", "DXY", "SPX"],
  },
  {
    id:       4,
    time:     "12:00",
    country:  "منطقة اليورو",
    flag:     "EU",
    event:    "قرار الفائدة - البنك المركزي الأوروبي",
    impact:   "high",
    previous: "4.50%",
    forecast: "4.25%",
    actual:   "4.25%",
    status:   "released",
    affects:  ["EURUSD", "XAUUSD"],
  },
  {
    id:       5,
    time:     "09:30",
    country:  "المملكة المتحدة",
    flag:     "GB",
    event:    "مؤشر أسعار المستهلك البريطاني (YoY)",
    impact:   "high",
    previous: "3.2%",
    forecast: "3.0%",
    actual:   "2.9%",
    status:   "released",
    affects:  ["GBPUSD", "XAUUSD"],
  },
  {
    id:       6,
    time:     "14:00",
    country:  "الولايات المتحدة",
    flag:     "US",
    event:    "تصريحات رئيس الفيدرالي الأمريكي",
    impact:   "high",
    previous: "—",
    forecast: "—",
    actual:   null,
    status:   "upcoming",
    affects:  ["XAUUSD", "DXY", "BTC-USDT"],
  },
  {
    id:       7,
    time:     "16:00",
    country:  "الولايات المتحدة",
    flag:     "US",
    event:    "مؤشر ثقة المستهلك الأمريكي",
    impact:   "medium",
    previous: "102.3",
    forecast: "101.8",
    actual:   null,
    status:   "upcoming",
    affects:  ["DXY", "SPX"],
  },
  {
    id:       8,
    time:     "10:00",
    country:  "ألمانيا",
    flag:     "DE",
    event:    "مؤشر ثقة مؤسسة IFO الأعمال",
    impact:   "medium",
    previous: "89.4",
    forecast: "89.9",
    actual:   "90.1",
    status:   "released",
    affects:  ["EURUSD"],
  },
  {
    id:       9,
    time:     "21:30",
    country:  "الولايات المتحدة",
    flag:     "US",
    event:    "محضر اجتماع الفيدرالي (FOMC Minutes)",
    impact:   "high",
    previous: "—",
    forecast: "—",
    actual:   null,
    status:   "upcoming",
    affects:  ["XAUUSD", "DXY", "BTC-USDT", "EURUSD"],
  },
  {
    id:       10,
    time:     "13:30",
    country:  "كندا",
    flag:     "CA",
    event:    "بيانات التوظيف الكندية",
    impact:   "medium",
    previous: "41.4K",
    forecast: "25.0K",
    actual:   null,
    status:   "upcoming",
    affects:  ["USDCAD"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IMPACT_META: Record<ImpactLevel, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  high:   {
    label: "تأثير عالٍ",
    color: "text-rose-400",
    bg:    "bg-rose-500/15 border-rose-500/30",
    icon:  <TrendingUp className="h-3.5 w-3.5" />,
  },
  medium: {
    label: "تأثير متوسط",
    color: "text-amber-400",
    bg:    "bg-amber-500/15 border-amber-500/30",
    icon:  <Minus className="h-3.5 w-3.5" />,
  },
  low:    {
    label: "تأثير منخفض",
    color: "text-slate-400",
    bg:    "bg-slate-500/10 border-slate-500/20",
    icon:  <Minus className="h-3.5 w-3.5" />,
  },
};

function ImpactBadge({ level }: { level: ImpactLevel }) {
  const m = IMPACT_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${m.color} ${m.bg}`}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

function FlagChip({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-mono font-bold bg-muted/50 border border-border/60 text-muted-foreground">
      {code}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event Row
// ---------------------------------------------------------------------------

function EventRow({ event: ev }: { event: EconomicEvent }) {
  const isReleased = ev.status === "released";
  const meta       = IMPACT_META[ev.impact];

  return (
    <div
      className={`rounded-xl border px-4 py-3.5 transition-colors ${
        ev.impact === "high"
          ? "border-rose-500/15 bg-rose-500/5 hover:bg-rose-500/8"
          : ev.impact === "medium"
          ? "border-amber-500/10 bg-card/60 hover:bg-amber-500/5"
          : "border-border bg-card/40 hover:bg-muted/20"
      }`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* Time + country */}
        <div className="flex items-center gap-2 min-w-[80px]">
          <Clock className={`h-3.5 w-3.5 shrink-0 ${meta.color}`} />
          <span className="tabular-nums text-sm font-mono text-foreground">{ev.time}</span>
          <FlagChip code={ev.flag} />
        </div>

        {/* Event name */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug">{ev.event}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{ev.country}</p>
        </div>

        {/* Impact badge */}
        <div className="shrink-0">
          <ImpactBadge level={ev.impact} />
        </div>

        {/* Data cells */}
        <div className="flex items-center gap-4 text-xs tabular-nums">
          <div className="text-center">
            <p className="text-muted-foreground/70 text-[10px] uppercase tracking-wide mb-0.5">السابق</p>
            <p className="text-muted-foreground">{ev.previous}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground/70 text-[10px] uppercase tracking-wide mb-0.5">المتوقع</p>
            <p className="text-amber-200/80">{ev.forecast}</p>
          </div>
          <div className="text-center min-w-[50px]">
            <p className="text-muted-foreground/70 text-[10px] uppercase tracking-wide mb-0.5">الفعلي</p>
            {ev.actual != null ? (
              <p className="font-semibold text-emerald-400">{ev.actual}</p>
            ) : (
              <p className="text-muted-foreground/40">—</p>
            )}
          </div>
        </div>
      </div>

      {/* Affected symbols */}
      {ev.affects.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/30">
          <Globe className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          {ev.affects.map((sym) => (
            <span
              key={sym}
              className="rounded px-1.5 py-0.5 text-[11px] font-mono bg-muted/40 border border-border/50 text-muted-foreground"
            >
              {sym}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Bar
// ---------------------------------------------------------------------------

function EventStats({ events }: { events: EconomicEvent[] }) {
  const high     = events.filter((e) => e.impact === "high").length;
  const medium   = events.filter((e) => e.impact === "medium").length;
  const released = events.filter((e) => e.status === "released").length;

  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: "تأثير عالٍ",    value: high,     color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/20"    },
        { label: "تأثير متوسط",  value: medium,   color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20"  },
        { label: "صدرت بالفعل",  value: released, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
      ].map(({ label, value, color, bg }) => (
        <div key={label} className={`rounded-xl border p-3 flex flex-col items-center gap-1 ${bg}`}>
          <p className={`tabular-nums text-2xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-muted-foreground text-center">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const [filterImpact, setFilterImpact] = useState<"" | "high" | "medium" | "low">("");
  const [filterStatus, setFilterStatus] = useState<"" | "upcoming" | "released">("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return DEMO_EVENTS.filter((ev) => {
      if (filterImpact && ev.impact !== filterImpact) return false;
      if (filterStatus && ev.status !== filterStatus) return false;
      if (search && !ev.event.includes(search) && !ev.country.includes(search) && !ev.affects.some((s) => s.includes(search.toUpperCase()))) return false;
      return true;
    });
  }, [filterImpact, filterStatus, search]);

  const highCount = filtered.filter((e) => e.impact === "high").length;

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
              <FileText className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">
                  رادار الأخبار الاقتصادية
                </h1>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                  تجريبي
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                أجندة الأحداث الاقتصادية وتأثيرها على الذهب والعملات
              </p>
            </div>
          </div>
        </div>

        {/* Demo notice */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <Info className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <p className="text-xs text-amber-200/90 leading-relaxed font-medium">
              البيانات المعروضة هيكلية تجريبية
            </p>
            <p className="text-xs text-amber-200/60 leading-relaxed mt-0.5">
              هذه الأحداث نماذج ثابتة للعرض التصميمي — سيتم ربطها بـ API أجندة اقتصادية حقيقية في مرحلة لاحقة.
              لا تُبنى قرارات تداولية على هذه البيانات.
            </p>
          </div>
        </div>

        {/* Stats */}
        <EventStats events={filtered} />

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            value={filterImpact}
            onChange={(e) => setFilterImpact(e.target.value as "" | "high" | "medium" | "low")}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber-500/50"
          >
            <option value="">كل مستويات التأثير</option>
            <option value="high">تأثير عالٍ فقط</option>
            <option value="medium">تأثير متوسط</option>
            <option value="low">تأثير منخفض</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "" | "upcoming" | "released")}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber-500/50"
          >
            <option value="">جميع الأحداث</option>
            <option value="upcoming">قادمة فقط</option>
            <option value="released">صدرت فقط</option>
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالحدث أو الرمز..."
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/50 flex-1 min-w-[180px]"
          />
        </div>

        {/* High impact warning */}
        {highCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            <p className="text-xs text-rose-300">
              {highCount} حدث عالي التأثير — قد يسبب تذبذباً حاداً في XAUUSD والدولار
            </p>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="font-medium">دليل التأثير:</span>
          {(["high", "medium", "low"] as ImpactLevel[]).map((level) => {
            const m = IMPACT_META[level];
            return (
              <span key={level} className={`flex items-center gap-1 ${m.color}`}>
                {m.icon}
                {m.label}
              </span>
            );
          })}
        </div>

        {/* Events list */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/30 px-4 py-12 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              لا توجد أحداث تطابق الفلتر المحدد
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((ev) => (
              <EventRow key={ev.id} event={ev} />
            ))}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/60 pb-4">
          نظام محكوم بالقواعد — تحليل معلوماتي فقط — ليس توصية مالية
        </p>
      </div>
    </div>
  );
}
