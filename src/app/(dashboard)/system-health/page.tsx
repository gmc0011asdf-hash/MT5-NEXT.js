"use client";

import { useState, useEffect } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ConvexSafeWrapper } from "@/components/gold-pro/ConvexSafeWrapper";
import {
  AlertCircle, CheckCircle2, Circle, XCircle,
  RefreshCw, Newspaper, ChevronDown, ChevronUp, Save,
} from "lucide-react";

// ─── Service status types ─────────────────────────────────────────────────────

type ServiceStatus = "healthy" | "placeholder" | "disabled" | "unknown";

interface ServiceCard {
  name: string;
  nameAr: string;
  status: ServiceStatus;
  note: string;
}

const SERVICES: ServiceCard[] = [
  { name: "MT5 Execution Bridge",  nameAr: "جسر MT5 للتنفيذ المحكوم",  status: "healthy",      note: "متصل — تنفيذ MT5 محكوم بالقواعد." },
  { name: "OKX Connector",         nameAr: "موصّل OKX",              status: "placeholder",  note: "غير مفعّل — عنصر نائب للمرحلة القادمة." },
  { name: "Convex Database",       nameAr: "قاعدة بيانات Convex",    status: "healthy",      note: "متصل — يعمل بشكل طبيعي." },
  { name: "Clerk Auth",            nameAr: "مصادقة Clerk",           status: "healthy",      note: "مفعّل — نظام المصادقة يعمل." },
  { name: "Finnhub News",          nameAr: "أخبار Finnhub",          status: "healthy",      note: "B6.1 — جلب أخبار general / crypto / forex." },
  { name: "Telegram Notifications",nameAr: "إشعارات Telegram",       status: "placeholder",  note: "غير مفعّل — سيتم الربط لاحقاً." },
  { name: "Scheduler",             nameAr: "المجدوِل",               status: "placeholder",  note: "غير مفعّل — سيتم الربط لاحقاً." },
  { name: "Trading Execution",     nameAr: "تنفيذ التداول",          status: "disabled",     note: "مُعطَّل عمداً — النظام في وضع العرض فقط." },
];

// ─── Impact / Decision color helpers ─────────────────────────────────────────

const IMPACT_LABELS: Record<string, string> = {
  NONE: "لا يؤثر", LOW: "ضعيف", MEDIUM: "متوسط", HIGH: "عالي", BLOCK: "حظر مؤقت",
};
const DECISION_STYLE: Record<string, string> = {
  PASS:         "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  WATCH:        "border-sky-500/40 bg-sky-500/10 text-sky-300",
  WARN:         "border-amber-500/40 bg-amber-500/10 text-amber-300",
  BLOCK_REVIEW: "border-red-500/40 bg-red-500/10 text-red-300",
};

function DecisionBadge({ d }: { d: string }) {
  const labels: Record<string, string> = {
    PASS: "مقبول ✓", WATCH: "مراقبة 👁", WARN: "تحذير ⚠", BLOCK_REVIEW: "حظر مراجعة ⛔",
  };
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${DECISION_STYLE[d] ?? "border-border text-muted-foreground"}`}>
      {labels[d] ?? d}
    </span>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  const cls =
    impact === "HIGH" || impact === "BLOCK" ? "border-red-500/30 bg-red-500/10 text-red-300" :
    impact === "MEDIUM" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" :
    "border-border text-muted-foreground";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {IMPACT_LABELS[impact] ?? impact}
    </span>
  );
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  if (status === "healthy") return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5" />يعمل
    </span>
  );
  if (status === "placeholder") return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
      <Circle className="h-3.5 w-3.5" />Placeholder
    </span>
  );
  if (status === "disabled") return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
      <XCircle className="h-3.5 w-3.5" />مُعطَّل
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <Circle className="h-3.5 w-3.5" />غير معروف
    </span>
  );
}

// ─── Available symbols for manual selection ───────────────────────────────────

const SYMBOL_OPTIONS = [
  "EURUSD","GBPUSD","XAUUSD","USDJPY","USDCHF",
  "BTCUSDT","ETHUSDT","USD","OIL","CRYPTO","GLOBAL_RISK",
];

// ─── News Review Modal ────────────────────────────────────────────────────────

type NewsItem = {
  _id:             Id<"newsEvents">;
  headline:        string;
  summary?:        string;
  category:        string;
  impact:          string;
  affectedSymbols: string[];
  source?:         string;
  publishedAt:     number;
  review:          ReviewData | null;
};

type ReviewData = {
  _id:                          Id<"newsReviews">;
  translatedHeadline?:          string;
  translatedSummary?:           string;
  userImpactOverride?:          string;
  userAffectedSymbolsOverride?: string[];
  relationshipType?:            string;
  userDirectionBias?:           string;
  userConfidence?:              number;
  userNote?:                    string;
  finalImpact:                  string;
  finalAffectedSymbols:         string[];
  finalDecision:                string;
  reviewedAt:                   number;
};

function NewsReviewPanel({ item, onClose }: { item: NewsItem; onClose: () => void }) {
  const upsertReview = useMutation(api.newsReviews.upsertNewsReview);
  const r = item.review;

  const [translatedHeadline, setTranslatedHeadline] = useState(r?.translatedHeadline ?? "");
  const [translatedSummary,  setTranslatedSummary]  = useState(r?.translatedSummary  ?? "");
  const [impactOverride,     setImpactOverride]     = useState(r?.userImpactOverride  ?? "");
  const [relationship,       setRelationship]       = useState(r?.relationshipType    ?? "");
  const [directionBias,      setDirectionBias]      = useState(r?.userDirectionBias   ?? "");
  const [confidence,         setConfidence]         = useState<number>(r?.userConfidence ?? 50);
  const [userNote,           setUserNote]           = useState(r?.userNote           ?? "");
  const [selectedSymbols,    setSelectedSymbols]    = useState<string[]>(r?.userAffectedSymbolsOverride ?? []);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  function toggleSymbol(sym: string) {
    setSelectedSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym],
    );
  }

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveErr(null);
    try {
      await upsertReview({
        newsEventId:                  item._id,
        translatedHeadline:           translatedHeadline || undefined,
        translatedSummary:            translatedSummary  || undefined,
        userImpactOverride:           impactOverride     || undefined,
        userAffectedSymbolsOverride:  selectedSymbols.length > 0 ? selectedSymbols : undefined,
        relationshipType:             relationship       || undefined,
        userDirectionBias:            directionBias      || undefined,
        userConfidence:               confidence,
        userNote:                     userNote           || undefined,
      });
      setSaved(true);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  }

  const IMPACT_RANK: Record<string, number> = { NONE:0, LOW:1, MEDIUM:2, HIGH:3, BLOCK:4 };
  function previewFinalImpact() {
    if (!impactOverride) return item.impact;
    return (IMPACT_RANK[impactOverride] ?? 0) >= (IMPACT_RANK[item.impact] ?? 0)
      ? impactOverride : item.impact;
  }
  function previewFinalDecision() {
    const fi = previewFinalImpact();
    if (fi === "BLOCK") return "BLOCK_REVIEW";
    if (fi === "HIGH")  return "WARN";
    if (fi === "MEDIUM") return "WATCH";
    return "PASS";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl mt-8 mb-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <p className="text-sm font-bold text-foreground">مراجعة الخبر — B6.1.1</p>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Original */}
          <div className="rounded-md border border-border bg-muted/5 px-4 py-3 space-y-1">
            <p className="text-[10px] text-muted-foreground/60">العنوان الأصلي</p>
            <p className="text-sm text-foreground leading-relaxed">{item.headline}</p>
            {item.summary && (
              <>
                <p className="text-[10px] text-muted-foreground/60 mt-1.5">الملخص الأصلي</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.summary}</p>
              </>
            )}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <ImpactBadge impact={item.impact} />
              <span className={`text-[9px] font-medium ${item.category==="crypto"?"text-violet-400":item.category==="forex"?"text-emerald-400":"text-sky-400"}`}>{item.category}</span>
              {item.affectedSymbols.map((s) => <span key={s} className="text-[9px] font-mono text-amber-400/70">{s}</span>)}
            </div>
          </div>

          {/* Translation */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground/80">الترجمة العربية (يدوية)</p>
            </div>
            <p className="text-[9px] text-amber-400/70 italic">
              الترجمة الآلية معطّلة مؤقتاً — يمكن الاعتماد على ملاحظة المراجع حالياً.
            </p>
            <input
              type="text"
              placeholder="اكتب ترجمة العنوان هنا أو استخدم الترجمة التلقائية…"
              value={translatedHeadline}
              onChange={(e) => setTranslatedHeadline(e.target.value)}
              className="w-full rounded border border-amber-500/30 bg-zinc-900/80 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
            />
            <textarea
              placeholder="اكتب ترجمة الملخص هنا أو استخدم الترجمة التلقائية…"
              value={translatedSummary}
              onChange={(e) => setTranslatedSummary(e.target.value)}
              rows={3}
              className="w-full rounded border border-amber-500/30 bg-zinc-900/80 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/60 resize-none"
            />
          </div>

          {/* User assessment */}
          <div className="rounded-md border border-border bg-muted/5 p-3 space-y-3">
            <p className="text-xs font-semibold text-foreground/80">تقييم المستخدم</p>

            {/* Impact override — chips */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted-foreground">الأثر المقدَّر (آلي: {item.impact})</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { val: "",      label: "آلي",         cls: "border-border text-muted-foreground" },
                  { val: "NONE",  label: "لا يؤثر",     cls: "border-zinc-500/40 text-zinc-400" },
                  { val: "LOW",   label: "ضعيف",         cls: "border-emerald-500/40 text-emerald-400" },
                  { val: "MEDIUM",label: "متوسط",        cls: "border-amber-500/40 text-amber-400" },
                  { val: "HIGH",  label: "عالي",         cls: "border-orange-500/40 text-orange-400" },
                  { val: "BLOCK", label: "حظر مؤقت",    cls: "border-red-500/40 text-red-400" },
                ].map(({ val, label, cls }) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setImpactOverride(val)}
                    className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${cls} ${
                      impactOverride === val
                        ? "ring-2 ring-offset-1 ring-offset-card ring-current opacity-100 bg-current/10"
                        : "opacity-60 hover:opacity-90"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Relationship — chips */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted-foreground">نوع العلاقة بالسوق</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { val: "",            label: "غير محدد",       cls: "border-border text-muted-foreground" },
                  { val: "DIRECT",      label: "مباشر",          cls: "border-sky-500/50 text-sky-400" },
                  { val: "INDIRECT",    label: "غير مباشر",      cls: "border-violet-500/50 text-violet-400" },
                  { val: "MACRO",       label: "ماكرو",           cls: "border-amber-500/50 text-amber-400" },
                  { val: "GLOBAL_RISK", label: "خطر عالمي",     cls: "border-red-500/50 text-red-400" },
                  { val: "NONE",        label: "لا علاقة",       cls: "border-zinc-500/40 text-zinc-400" },
                ].map(({ val, label, cls }) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setRelationship(val)}
                    className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${cls} ${
                      relationship === val
                        ? "ring-2 ring-offset-1 ring-offset-card ring-current opacity-100 bg-current/10"
                        : "opacity-60 hover:opacity-90"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Direction bias — chips */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted-foreground">انحياز الاتجاه</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { val: "",        label: "غير محدد",   cls: "border-border text-muted-foreground" },
                  { val: "BULLISH", label: "صاعد ↑",     cls: "border-emerald-500/50 text-emerald-400" },
                  { val: "BEARISH", label: "هابط ↓",     cls: "border-red-500/50 text-red-400" },
                  { val: "NEUTRAL", label: "محايد ↔",    cls: "border-sky-500/40 text-sky-400" },
                  { val: "UNKNOWN", label: "غير معروف",  cls: "border-zinc-500/40 text-zinc-400" },
                ].map(({ val, label, cls }) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setDirectionBias(val)}
                    className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${cls} ${
                      directionBias === val
                        ? "ring-2 ring-offset-1 ring-offset-card ring-current opacity-100 bg-current/10"
                        : "opacity-60 hover:opacity-90"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Confidence */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">الثقة: {confidence}%</label>
              <input
                type="range"
                min={0} max={100} step={5}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            {/* Symbol selection */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted-foreground">الرموز المتأثرة (اختياري)</label>
              <div className="flex flex-wrap gap-1.5">
                {SYMBOL_OPTIONS.map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => toggleSymbol(sym)}
                    className={`rounded border px-2 py-0.5 text-[10px] font-mono transition-colors ${
                      selectedSymbols.includes(sym)
                        ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
                        : "border-border bg-muted/5 text-muted-foreground hover:border-amber-500/30"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            {/* User note */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">ملاحظة المراجع</label>
              <textarea
                placeholder="ملاحظات إضافية عن هذا الخبر…"
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                rows={2}
                className="w-full rounded border border-border bg-muted/10 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none"
              />
            </div>
          </div>

          {/* Preview final values */}
          <div className="rounded-md border border-border bg-muted/5 px-4 py-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground/60">معاينة النتيجة النهائية</p>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] text-muted-foreground">الأثر:</span>
              <ImpactBadge impact={previewFinalImpact()} />
              <span className="text-[10px] text-muted-foreground ms-2">القرار:</span>
              <DecisionBadge d={previewFinalDecision()} />
            </div>
            {selectedSymbols.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="text-[9px] text-muted-foreground/60">رموز محددة يدوياً:</span>
                {selectedSymbols.map((s) => <span key={s} className="text-[9px] font-mono text-amber-400/70">{s}</span>)}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className={`inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                saving
                  ? "border-border text-muted-foreground cursor-not-allowed"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
              }`}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "جارٍ الحفظ…" : "حفظ الترجمة والتقييم"}
            </button>
            {saved    && <span className="text-xs text-emerald-400">✓ تم الحفظ</span>}
            {saveErr  && <span className="text-xs text-red-400">{saveErr}</span>}
          </div>

          <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-2">
            B6.1.1 — التقييم للمراجعة البشرية فقط — لا يؤثر على قرارات التداول الآن.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── News Panel ───────────────────────────────────────────────────────────────

function NewsPanel() {
  const { isAuthenticated } = useConvexAuth();
  const fetchNews  = useAction(api.newsIngestion.fetchFinnhubNews);
  const counts     = useQuery(api.newsIngestion.getNewsCounts,     isAuthenticated ? {} : "skip");
  const newsWithReviews = useQuery(api.newsReviews.listNewsWithReviews, isAuthenticated ? { limit: 10 } : "skip");

  const [fetching,     setFetching]     = useState(false);
  const [fetchResult,  setFetchResult]  = useState<{ ok:boolean; inserted:number; skipped:number; errors:string[] } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<NewsItem | null>(null);

  async function handleFetch() {
    if (fetching) return;
    setFetching(true); setFetchResult(null);
    try {
      const result = await fetchNews({});
      setFetchResult(result);
    } catch (e) {
      setFetchResult({ ok: false, inserted: 0, skipped: 0, errors: [e instanceof Error ? e.message : "خطأ"] });
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-amber-400" />
          <div>
            <p className="font-semibold text-foreground">أخبار Finnhub — B6.1</p>
            <p className="text-xs text-muted-foreground">general / crypto / forex + مراجعة B6.1.1</p>
          </div>
        </div>
        <button
          type="button" onClick={() => void handleFetch()} disabled={fetching || !isAuthenticated}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            fetching || !isAuthenticated
              ? "border-border text-muted-foreground cursor-not-allowed"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 cursor-pointer"
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
          {fetching ? "جارٍ الجلب…" : "جلب الأخبار"}
        </button>
      </div>

      {/* Counts */}
      {counts !== undefined && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "عام",    count: counts.general, color: "text-sky-300" },
            { label: "Crypto", count: counts.crypto,  color: "text-violet-300" },
            { label: "Forex",  count: counts.forex,   color: "text-emerald-300" },
            { label: "المجموع", count: counts.total,  color: "text-amber-300" },
          ].map(({ label, count, color }) => (
            <div key={label} className="rounded-lg border border-border bg-muted/5 px-3 py-2 text-center">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{count}</p>
            </div>
          ))}
        </div>
      )}
      {counts?.latestAt && (
        <p className="text-[10px] text-muted-foreground/60 font-mono">
          آخر خبر: {new Date(counts.latestAt).toLocaleString("ar-IQ")}
        </p>
      )}

      {/* Fetch result */}
      {fetchResult && (
        <div className={`rounded-md border px-3 py-2 text-xs space-y-0.5 ${
          fetchResult.ok ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" : "border-red-500/30 bg-red-500/8 text-red-300"
        }`}>
          <p className="font-semibold">{fetchResult.ok ? "✓ تم الجلب بنجاح" : "✗ خطأ أثناء الجلب"}</p>
          <p>مُضاف: {fetchResult.inserted} | موجود: {fetchResult.skipped}</p>
          {fetchResult.errors.map((e, i) => <p key={i} className="text-[10px] opacity-80">⚠ {e}</p>)}
        </div>
      )}

      {/* News list with review button */}
      {newsWithReviews && newsWithReviews.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">آخر الأخبار (مع حالة المراجعة):</p>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {newsWithReviews.map((item) => {
              const rev = item.review;
              return (
                <div key={item._id} className="rounded border border-border bg-muted/5 px-3 py-2 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] text-foreground/90 leading-tight flex-1">{item.headline}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {rev ? <DecisionBadge d={rev.finalDecision} /> : <ImpactBadge impact={item.impact} />}
                      <button
                        type="button"
                        onClick={() => setReviewTarget(item as unknown as NewsItem)}
                        className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300 hover:bg-sky-500/20 transition-colors"
                      >
                        مراجعة
                      </button>
                    </div>
                  </div>
                  {/* Translation status */}
                  {rev?.translatedHeadline ? (
                    <p className="text-[10px] text-amber-300/90 leading-tight">
                      <span className="text-muted-foreground/50">ترجمة: </span>
                      {rev.translatedHeadline}
                    </p>
                  ) : (
                    <p className="text-[9px] text-muted-foreground/40 italic">لا توجد ترجمة بعد</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[9px] text-muted-foreground/60 font-mono">
                      {item.source ?? "finnhub"} • {new Date(item.publishedAt).toLocaleDateString("ar-IQ")}
                    </span>
                    <span className={`text-[9px] font-medium ${
                      item.category==="crypto" ? "text-violet-400" : item.category==="forex" ? "text-emerald-400" : "text-sky-400"
                    }`}>{item.category}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : newsWithReviews !== undefined && newsWithReviews.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 text-center py-4">
          لا توجد أخبار مخزنة — اضغط "جلب الأخبار" للبدء
        </p>
      ) : null}

      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-2">
        B6.1.1 — مراجعة بشرية وترجمة — لا تؤثر على قرارات التداول الآن.
      </p>

      {/* Review modal */}
      {reviewTarget && (
        <NewsReviewPanel
          item={reviewTarget}
          onClose={() => setReviewTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Local Runtime Diagnostics ───────────────────────────────────────────────

type RuntimeInfo = {
  mt5ServiceUrl:    string;
  executionEnabled: boolean;
  pythonHealth:     "ok" | "unreachable" | "error";
  mt5Connected:     boolean;
  timestamp:        number;
};

type ConnectionStatus = {
  connected:    boolean;
  balance:      number | null;
  equity:       number | null;
  free_margin:  number | null;
  account_login:number | null;
  server:       string | null;
  currency:     string | null;
  error?:       string;
};

function RuntimeDiagnosticsPanel() {
  const [info,   setInfo]   = useState<RuntimeInfo | null>(null);
  const [conn,   setConn]   = useState<ConnectionStatus | null>(null);
  const [execPolicy, setExecPolicy] = useState<string>("STRICT");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Read execution policy from localStorage (client only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("mt5-demo-exec-settings-v1");
      if (raw) {
        const s = JSON.parse(raw) as Record<string, unknown>;
        setExecPolicy(typeof s.executionPolicy === "string" ? s.executionPolicy : "STRICT");
      }
    } catch { /* ignore */ }
  }, []);

  async function runChecks() {
    setLoading(true);
    setError(null);
    try {
      const [infoRes, connRes] = await Promise.all([
        fetch("/api/runtime/info",                         { cache: "no-store" }),
        fetch("/api/mt5-readonly/connection-status",       { cache: "no-store" }),
      ]);
      setInfo((await infoRes.json())  as RuntimeInfo);
      setConn((await connRes.json())  as ConnectionStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل الاتصال");
    } finally {
      setLoading(false);
    }
  }

  const healthColor = (h: RuntimeInfo["pythonHealth"] | undefined) =>
    h === "ok" ? "text-emerald-300" : h === "error" ? "text-amber-300" : "text-red-300";

  const boolBadge = (v: boolean | undefined, trueLabel = "نعم ✓", falseLabel = "لا ✗") => (
    <span className={`font-semibold ${v ? "text-emerald-300" : "text-red-300"}`}>
      {v ? trueLabel : falseLabel}
    </span>
  );

  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">تشخيص التشغيل المحلي — Local Runtime Diagnostics</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            فحص اتصال Python Bridge + Next.js + إعدادات التنفيذ — قراءة فقط
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runChecks()}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            loading
              ? "border-border text-muted-foreground cursor-not-allowed"
              : "border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 cursor-pointer"
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "جارٍ الفحص…" : "فحص الاتصال"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          خطأ: {error}
        </div>
      )}

      {/* Results grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

        {/* Python Bridge */}
        <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Python MT5 Bridge</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">MT5_SERVICE_URL</span>
              <span className="font-mono text-foreground/80 text-[10px]">{info?.mt5ServiceUrl ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Python Bridge Health</span>
              <span className={`font-semibold ${healthColor(info?.pythonHealth)}`}>
                {info?.pythonHealth ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">MT5 متصل (Python)</span>
              {info ? boolBadge(info.mt5Connected, "متصل ✓", "غير متصل ✗") : <span className="text-muted-foreground">—</span>}
            </div>
          </div>
        </div>

        {/* Next.js → Python */}
        <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Next.js → Python Proxy</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">MT5 متصل (Next)</span>
              {conn ? boolBadge(conn.connected, "متصل ✓", "غير متصل ✗") : <span className="text-muted-foreground">—</span>}
            </div>
            {conn?.connected && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">حساب</span>
                  <span className="font-mono text-foreground/80">{conn.account_login ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الرصيد</span>
                  <span className="font-mono text-foreground/80">
                    {conn.balance != null ? `${conn.balance.toFixed(2)} ${conn.currency ?? ""}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">حقوق الملكية</span>
                  <span className="font-mono text-foreground/80">
                    {conn.equity != null ? `${conn.equity.toFixed(2)} ${conn.currency ?? ""}` : "—"}
                  </span>
                </div>
              </>
            )}
            {conn?.error && (
              <p className="text-red-300/80 text-[10px] leading-relaxed">{conn.error}</p>
            )}
          </div>
        </div>

        {/* Execution settings */}
        <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">إعدادات التنفيذ</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">MT5_DEMO_EXECUTION_ENABLED</span>
              {info ? boolBadge(info.executionEnabled, "true ✓", "false ✗") : <span className="text-muted-foreground">—</span>}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">سياسة التنفيذ (localStorage)</span>
              <span className={`font-semibold text-[11px] ${execPolicy === "EXPERIMENTAL" ? "text-violet-300" : "text-emerald-300/80"}`}>
                {execPolicy}
              </span>
            </div>
          </div>
        </div>

        {/* Diagnostics hint */}
        <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">فحص يدوي</p>
          <div className="text-[10px] text-muted-foreground/70 space-y-1.5 font-mono">
            <p>curl.exe http://127.0.0.1:8010/health</p>
            <p>curl.exe http://localhost:3000/api/mt5-readonly/connection-status</p>
          </div>
          {info?.timestamp && (
            <p className="text-[9px] text-muted-foreground/40">
              آخر فحص: {new Date(info.timestamp).toLocaleTimeString("ar-SA", { hour12: false })}
            </p>
          )}
        </div>
      </div>

      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-2">
        عرض فقط — لا يغيّر أي إعداد — لا توجد secrets في هذا القسم.
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function SystemHealthPageContent() {
  return (
    <div dir="rtl" className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-amber-500">مركز صحة النظام</h1>
        <p className="text-muted-foreground">مراقبة حالة الخدمات الأساسية</p>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">MT5 Governed · التنفيذ حسب الحوكمة</p>
          <p className="opacity-80">
            بعض الخدمات حقيقية وبعضها Placeholder حسب المرحلة. التنفيذ يتم فقط بعد موافقة القواعد واللجان.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SERVICES.map((svc) => (
          <div key={svc.name} className="rounded-xl border border-border bg-card p-5 shadow flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground leading-tight">{svc.nameAr}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{svc.name}</p>
              </div>
              <StatusBadge status={svc.status} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">{svc.note}</p>
          </div>
        ))}
      </div>

      <NewsPanel />

      <RuntimeDiagnosticsPanel />
    </div>
  );
}

export default function SystemHealthPage() {
  return (
    <ConvexSafeWrapper>
      <SystemHealthPageContent />
    </ConvexSafeWrapper>
  );
}
