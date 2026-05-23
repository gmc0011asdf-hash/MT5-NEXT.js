"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { BarChart2, BookMarked, ChevronLeft, Plus, X } from "lucide-react";

function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={`block text-muted-foreground ${className ?? "text-xs"}`}>{children}</label>;
}

// ─── ثوابت ────────────────────────────────────────────────────────────────────

const STATUS_AR: Record<string, string> = {
  DRAFT:                  "مسودة",
  DOCUMENTED:             "موثقة",
  BACKTESTING:            "اختبار تاريخي",
  SHADOW_MODE:            "وضع المراقبة",
  CONTROLLED_EXPERIMENT:  "تجربة محكومة",
  CONDITIONALLY_APPROVED: "موافقة مشروطة",
  APPROVED:               "معتمدة",
  PAUSED:                 "موقوفة",
  REJECTED:               "مرفوضة",
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT:                  "bg-zinc-500/20 text-zinc-300",
  DOCUMENTED:             "bg-blue-500/20 text-blue-300",
  BACKTESTING:            "bg-yellow-500/20 text-yellow-300",
  SHADOW_MODE:            "bg-purple-500/20 text-purple-300",
  CONTROLLED_EXPERIMENT:  "bg-orange-500/20 text-orange-300",
  CONDITIONALLY_APPROVED: "bg-teal-500/20 text-teal-300",
  APPROVED:               "bg-emerald-500/20 text-emerald-300",
  PAUSED:                 "bg-zinc-400/20 text-zinc-400",
  REJECTED:               "bg-rose-500/20 text-rose-300",
};

const TIMEFRAME_OPTIONS = ["M15", "H1", "H4", "D1"];
const SESSION_OPTIONS   = ["London", "NewYork", "Asian"];
const CONDITION_OPTIONS = [
  { value: "ANY",      label: "أي حالة" },
  { value: "TRENDING", label: "اتجاهي" },
  { value: "RANGING",  label: "عرضي" },
  { value: "VOLATILE", label: "متقلب" },
];

// ─── نموذج الإنشاء ─────────────────────────────────────────────────────────

function CreateStrategyForm({ onClose }: { onClose: () => void }) {
  const createStrategy = useMutation(api.strategies.createStrategy);
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [marketCondition, setMarketCondition] = useState("ANY");
  const [timeframes, setTimeframes]   = useState<string[]>(["H1"]);
  const [sessions, setSessions]       = useState<string[]>(["London"]);
  const [tags, setTagsRaw]            = useState("");
  const [notes, setNotes]             = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");

  function toggleTimeframe(tf: string) {
    setTimeframes((prev) =>
      prev.includes(tf) ? prev.filter((x) => x !== tf) : [...prev, tf],
    );
  }

  function toggleSession(s: string) {
    setSessions((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("اسم الاستراتيجية مطلوب"); return; }
    if (timeframes.length === 0) { setError("اختر فريم واحد على الأقل"); return; }
    setSaving(true);
    setError("");
    try {
      await createStrategy({
        name:              name.trim(),
        description:       description.trim() || undefined,
        allowedTimeframes: timeframes,
        allowedSessions:   sessions,
        marketCondition,
        tags:              tagsRaw.split(",").map((t) => t.trim()).filter(Boolean),
        notes:             notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSaving(false);
    }
  }

  const tagsRaw = tags;

  return (
    <Card className={institutionalCardClass("p-0")}>
      <CardHeader className="border-b border-amber-500/10 px-4 py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="card-title-inst">إنشاء استراتيجية جديدة</CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-rose-300 text-sm">
              {error}
            </p>
          ) : null}

          <div className="space-y-1">
            <FieldLabel className="text-sm">اسم الاستراتيجية *</FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: EMA Pullback H1"
              className="border-amber-500/20 bg-muted/20"
              dir="ltr"
            />
          </div>

          <div className="space-y-1">
            <FieldLabel className="text-sm">وصف مختصر</FieldLabel>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="شرح موجز عن الاستراتيجية"
              className="border-amber-500/20 bg-muted/20"
            />
          </div>

          <div className="space-y-1">
            <FieldLabel className="text-sm">حالة السوق المستهدفة</FieldLabel>
            <select
              value={marketCondition}
              onChange={(e) => setMarketCondition(e.target.value)}
              className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-3 py-2 text-foreground text-sm"
            >
              {CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <FieldLabel className="text-sm">الفريمات المسموح بها *</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAME_OPTIONS.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => toggleTimeframe(tf)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    timeframes.includes(tf)
                      ? "bg-amber-500/30 text-amber-200 border border-amber-500/50"
                      : "bg-muted/20 text-muted-foreground border border-border/40 hover:bg-muted/30"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel className="text-sm">الجلسات المسموح بها</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {SESSION_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSession(s)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    sessions.includes(s)
                      ? "bg-blue-500/30 text-blue-200 border border-blue-500/40"
                      : "bg-muted/20 text-muted-foreground border border-border/40 hover:bg-muted/30"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <FieldLabel className="text-sm">تصنيفات (مفصولة بفاصلة)</FieldLabel>
            <Input
              value={tags}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="مثال: EMA, Pullback, Trend"
              className="border-amber-500/20 bg-muted/20"
              dir="ltr"
            />
          </div>

          <div className="space-y-1">
            <FieldLabel className="text-sm">ملاحظات</FieldLabel>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي ملاحظات إضافية"
              className="border-amber-500/20 bg-muted/20"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {saving ? "جاري الحفظ..." : "إنشاء استراتيجية"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── بطاقة الاستراتيجية ───────────────────────────────────────────────────────

type Strategy = {
  _id: string;
  name: string;
  description?: string;
  status: string;
  allowedTimeframes: string[];
  allowedSessions: string[];
  marketCondition: string;
  tags: string[];
  updatedAt: number;
};

function StrategyCard({ s }: { s: Strategy }) {
  const statusCls = STATUS_COLOR[s.status] ?? "bg-zinc-500/20 text-zinc-300";
  const statusLabel = STATUS_AR[s.status] ?? s.status;

  return (
    <Link href={`/strategy-library/${s._id}`} className="block">
      <Card className={institutionalCardClass("p-0 hover:border-amber-500/30 transition-colors cursor-pointer")}>
        <CardContent className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground truncate">{s.name}</p>
              {s.description ? (
                <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed line-clamp-2">
                  {s.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusCls}`}>
                {statusLabel}
              </span>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span>
              الفريمات:{" "}
              <span className="text-amber-100/80">{s.allowedTimeframes.join(" · ") || "—"}</span>
            </span>
            <span>
              حالة السوق:{" "}
              <span className="text-amber-100/80">
                {CONDITION_OPTIONS.find((o) => o.value === s.marketCondition)?.label ?? s.marketCondition}
              </span>
            </span>
            {s.tags.length > 0 ? (
              <span className="text-muted-foreground/70">{s.tags.slice(0, 3).join(" · ")}</span>
            ) : null}
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground/60">
            آخر تعديل:{" "}
            {new Date(s.updatedAt).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── الصفحة الرئيسية ─────────────────────────────────────────────────────────

export default function StrategyLibraryPage() {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !authLoading && isAuthenticated;
  const [showCreate, setShowCreate] = useState(false);

  const { results, status, loadMore } = usePaginatedQuery(
    api.strategies.listStrategies,
    canUseConvex ? {} : "skip",
    { initialNumItems: 20 },
  );

  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* ─── رأس الصفحة ─── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="page-title flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-amber-400" />
            مكتبة الاستراتيجيات
          </h2>
          <p className="label-secondary mt-1">
            توثيق الاستراتيجيات وتتبع حالتها — من المسودة إلى الاعتماد.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/strategy-library/compare"
            className="flex items-center gap-1.5 rounded-md border border-amber-500/25 px-3 py-1.5 text-amber-200 text-sm hover:bg-amber-500/10 transition-colors"
          >
            <BarChart2 className="h-4 w-4" />
            مقارنة
          </Link>
          {canUseConvex && !showCreate ? (
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Plus className="h-4 w-4 me-1" />
              استراتيجية جديدة
            </Button>
          ) : null}
        </div>
      </div>

      {/* ─── تنبيه أمان ─── */}
      <p className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-2.5 text-amber-100/80 text-xs leading-relaxed">
        مكتبة الاستراتيجيات أداة توثيق وتحليل فقط — لا تنفيذ تداول قبل المرحلة 14.
      </p>

      {/* ─── نموذج الإنشاء ─── */}
      {showCreate ? (
        <CreateStrategyForm onClose={() => setShowCreate(false)} />
      ) : null}

      {/* ─── الحالة ─── */}
      {authLoading ? (
        <p className="text-muted-foreground text-sm">جاري التحقق من المصادقة...</p>
      ) : !isAuthenticated ? (
        <p className="text-muted-foreground text-sm">يجب تسجيل الدخول لعرض مكتبة الاستراتيجيات.</p>
      ) : status === "LoadingFirstPage" ? (
        <p className="text-muted-foreground text-sm animate-pulse">جاري تحميل الاستراتيجيات...</p>
      ) : results.length === 0 ? (
        <Card className={institutionalCardClass("p-6")}>
          <p className="text-center text-muted-foreground text-sm">
            لا توجد استراتيجيات بعد — أنشئ استراتيجيتك الأولى باستخدام الزر أعلاه.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((s) => (
              <StrategyCard key={s._id} s={s as Strategy} />
            ))}
          </div>
          {status === "CanLoadMore" ? (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => loadMore(20)} className="border-amber-500/25">
                تحميل المزيد
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
