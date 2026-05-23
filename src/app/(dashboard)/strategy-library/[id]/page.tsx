"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { institutionalCardClass } from "@/lib/ui-institutional";
import {
  ArrowRight,
  ChevronDown,
  ClipboardCheck,
  History,
  TrendingUp,
} from "lucide-react";

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
  DRAFT:                  "bg-zinc-500/20 text-zinc-300 border-zinc-500/20",
  DOCUMENTED:             "bg-blue-500/20 text-blue-300 border-blue-500/20",
  BACKTESTING:            "bg-yellow-500/20 text-yellow-300 border-yellow-500/20",
  SHADOW_MODE:            "bg-purple-500/20 text-purple-300 border-purple-500/20",
  CONTROLLED_EXPERIMENT:  "bg-orange-500/20 text-orange-300 border-orange-500/20",
  CONDITIONALLY_APPROVED: "bg-teal-500/20 text-teal-300 border-teal-500/20",
  APPROVED:               "bg-emerald-500/20 text-emerald-300 border-emerald-500/20",
  PAUSED:                 "bg-zinc-400/20 text-zinc-400 border-zinc-400/20",
  REJECTED:               "bg-rose-500/20 text-rose-300 border-rose-500/20",
};

const ALL_STATUSES = [
  "DRAFT", "DOCUMENTED", "BACKTESTING", "SHADOW_MODE",
  "CONTROLLED_EXPERIMENT", "CONDITIONALLY_APPROVED", "APPROVED", "PAUSED", "REJECTED",
];

// ─── تغيير الحالة ─────────────────────────────────────────────────────────────

function StatusChangePanel({
  strategyId,
  currentStatus,
}: {
  strategyId: Id<"strategies">;
  currentStatus: string;
}) {
  const updateStatus = useMutation(api.strategies.updateStrategyStatus);
  const [open, setOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newStatus) { setError("اختر الحالة الجديدة"); return; }
    if (!reason.trim()) { setError("سبب التغيير مطلوب"); return; }
    setSaving(true);
    setError("");
    try {
      await updateStatus({ strategyId, newStatus, reason: reason.trim() });
      setOpen(false);
      setNewStatus("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-amber-500/30 text-amber-200 hover:bg-amber-500/10"
      >
        <ChevronDown className="h-4 w-4 me-1" />
        تغيير الحالة
      </Button>
    );
  }

  return (
    <Card className={institutionalCardClass("p-0")}>
      <CardHeader className="border-b border-amber-500/10 px-4 py-3">
        <CardTitle className="text-sm">تغيير حالة الاستراتيجية</CardTitle>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {error ? (
            <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-rose-300 text-xs">
              {error}
            </p>
          ) : null}
          <div className="space-y-1">
            <FieldLabel className="text-xs">الحالة الجديدة</FieldLabel>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-3 py-2 text-foreground text-sm"
            >
              <option value="">— اختر —</option>
              {ALL_STATUSES.filter((s) => s !== currentStatus).map((s) => (
                <option key={s} value={s}>{STATUS_AR[s] ?? s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <FieldLabel className="text-xs">سبب التغيير *</FieldLabel>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="اذكر السبب بوضوح (مطلوب)"
              className="border-amber-500/20 bg-muted/20 text-sm"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {saving ? "جاري الحفظ..." : "تأكيد التغيير"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── قسم القواعد ─────────────────────────────────────────────────────────────

function RulesSection({ strategyId }: { strategyId: Id<"strategies"> }) {
  const rules = useQuery(api.strategies.getStrategyRules, { strategyId });
  const upsert = useMutation(api.strategies.upsertStrategyRules);
  const [editing, setEditing] = useState(false);

  const [form, setForm] = useState({
    entryConditions:   "",
    exitConditions:    "",
    invalidationRules: "",
    blockConditions:   "",
    riskRules:         "",
    entryType:         "MARKET",
    defaultPlan:       "Balanced",
    defaultTarget:     "BALANCED",
    minRR:             "1.5",
    maxSpread:         "3",
    requiredCommittees: "Trend,Risk,Freshness",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  function openEdit() {
    if (rules) {
      setForm({
        entryConditions:   rules.entryConditions,
        exitConditions:    rules.exitConditions,
        invalidationRules: rules.invalidationRules,
        blockConditions:   rules.blockConditions ?? "",
        riskRules:         rules.riskRules ?? "",
        entryType:         rules.entryType,
        defaultPlan:       rules.defaultPlan,
        defaultTarget:     rules.defaultTarget,
        minRR:             String(rules.minRR),
        maxSpread:         String(rules.maxSpread),
        requiredCommittees: rules.requiredCommittees.join(","),
      });
    }
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await upsert({
        strategyId,
        entryConditions:   form.entryConditions,
        exitConditions:    form.exitConditions,
        invalidationRules: form.invalidationRules,
        blockConditions:   form.blockConditions || undefined,
        riskRules:         form.riskRules || undefined,
        entryType:         form.entryType,
        defaultPlan:       form.defaultPlan,
        defaultTarget:     form.defaultTarget,
        minRR:             parseFloat(form.minRR) || 1.5,
        maxSpread:         parseFloat(form.maxSpread) || 3,
        requiredCommittees: form.requiredCommittees.split(",").map((x) => x.trim()).filter(Boolean),
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSaving(false);
    }
  }

  if (rules === undefined) {
    return <p className="text-muted-foreground text-sm animate-pulse">جاري التحميل...</p>;
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {!rules ? (
          <p className="text-muted-foreground text-sm">لم تُضف قواعد بعد.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            <li><span className="text-muted-foreground">شروط الدخول:</span> <span className="text-foreground">{rules.entryConditions}</span></li>
            <li><span className="text-muted-foreground">شروط الخروج:</span> <span className="text-foreground">{rules.exitConditions}</span></li>
            <li><span className="text-muted-foreground">شروط الإلغاء:</span> <span className="text-foreground">{rules.invalidationRules}</span></li>
            {rules.blockConditions ? (
              <li><span className="text-muted-foreground">شروط المنع:</span> <span className="text-foreground">{rules.blockConditions}</span></li>
            ) : null}
            <li className="pt-1 border-t border-amber-500/10 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>نوع الدخول: <span className="text-amber-100/80">{rules.entryType}</span></span>
              <span>الخطة الافتراضية: <span className="text-amber-100/80">{rules.defaultPlan}</span></span>
              <span>أقل RR: <span className="tabular-nums text-amber-100/80">{rules.minRR}</span></span>
              <span>أقصى سبريد: <span className="tabular-nums text-amber-100/80">{rules.maxSpread}</span></span>
            </li>
            <li className="text-xs text-muted-foreground">
              اللجان المطلوبة: <span className="text-amber-100/80">{rules.requiredCommittees.join(" · ")}</span>
            </li>
          </ul>
        )}
        <Button variant="outline" size="sm" onClick={openEdit} className="border-amber-500/25">
          {rules ? "تعديل القواعد" : "إضافة القواعد"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      {error ? (
        <p className="text-rose-300 text-xs">{error}</p>
      ) : null}
      {(
        [
          { field: "entryConditions",   label: "شروط الدخول *" },
          { field: "exitConditions",    label: "شروط الخروج *" },
          { field: "invalidationRules", label: "شروط الإلغاء *" },
          { field: "blockConditions",   label: "شروط المنع" },
          { field: "riskRules",         label: "قواعد المخاطرة" },
        ] as const
      ).map(({ field, label }) => (
        <div key={field} className="space-y-1">
          <FieldLabel className="text-xs">{label}</FieldLabel>
          <Input
            value={form[field]}
            onChange={(e) => setForm((p) => ({ ...p, [field]: e.target.value }))}
            className="border-amber-500/20 bg-muted/20 text-sm"
            dir="rtl"
          />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel className="text-xs">نوع الدخول</FieldLabel>
          <select
            value={form.entryType}
            onChange={(e) => setForm((p) => ({ ...p, entryType: e.target.value }))}
            className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-2 py-1.5 text-foreground text-xs"
          >
            {["MARKET", "LIMIT", "STOP", "MIXED"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <FieldLabel className="text-xs">الخطة الافتراضية</FieldLabel>
          <select
            value={form.defaultPlan}
            onChange={(e) => setForm((p) => ({ ...p, defaultPlan: e.target.value }))}
            className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-2 py-1.5 text-foreground text-xs"
          >
            {["Conservative", "Balanced", "Aggressive"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <FieldLabel className="text-xs">أقل RR</FieldLabel>
          <Input
            type="number"
            step="0.1"
            min="0.5"
            value={form.minRR}
            onChange={(e) => setForm((p) => ({ ...p, minRR: e.target.value }))}
            className="border-amber-500/20 bg-muted/20 text-xs"
            dir="ltr"
          />
        </div>
        <div className="space-y-1">
          <FieldLabel className="text-xs">أقصى سبريد (نقاط)</FieldLabel>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={form.maxSpread}
            onChange={(e) => setForm((p) => ({ ...p, maxSpread: e.target.value }))}
            className="border-amber-500/20 bg-muted/20 text-xs"
            dir="ltr"
          />
        </div>
      </div>
      <div className="space-y-1">
        <FieldLabel className="text-xs">اللجان المطلوبة (مفصولة بفاصلة)</FieldLabel>
        <Input
          value={form.requiredCommittees}
          onChange={(e) => setForm((p) => ({ ...p, requiredCommittees: e.target.value }))}
          className="border-amber-500/20 bg-muted/20 text-xs"
          dir="ltr"
          placeholder="Trend,Risk,Freshness"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
          إلغاء
        </Button>
        <Button type="submit" size="sm" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
          {saving ? "جاري الحفظ..." : "حفظ القواعد"}
        </Button>
      </div>
    </form>
  );
}

// ─── سجل القرارات ─────────────────────────────────────────────────────────────

function DecisionsSection({ strategyId }: { strategyId: Id<"strategies"> }) {
  const decisions = useQuery(api.strategies.listStrategyDecisions, { strategyId });

  if (decisions === undefined) {
    return <p className="text-muted-foreground text-sm animate-pulse">جاري التحميل...</p>;
  }
  if (decisions.length === 0) {
    return <p className="text-muted-foreground text-sm">لا توجد قرارات مسجلة بعد.</p>;
  }

  return (
    <ul className="space-y-2">
      {decisions.map((d) => (
        <li
          key={d._id}
          className="rounded-lg border border-amber-500/10 bg-muted/10 px-3 py-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_COLOR[d.fromStatus] ?? "bg-zinc-500/20 text-zinc-300"}`}>
              {STATUS_AR[d.fromStatus] ?? d.fromStatus}
            </span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_COLOR[d.toStatus] ?? "bg-zinc-500/20 text-zinc-300"}`}>
              {STATUS_AR[d.toStatus] ?? d.toStatus}
            </span>
            <span className="text-muted-foreground/60 ms-auto tabular-nums">
              {new Date(d.decidedAt).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
          <p className="mt-1.5 text-muted-foreground leading-snug">{d.reason}</p>
        </li>
      ))}
    </ul>
  );
}

// ─── ملخص الباكتست ────────────────────────────────────────────────────────────

function BacktestsSection({ strategyId }: { strategyId: Id<"strategies"> }) {
  const backtests = useQuery(api.strategies.listStrategyBacktests, { strategyId });

  if (backtests === undefined) {
    return <p className="text-muted-foreground text-sm animate-pulse">جاري التحميل...</p>;
  }
  if (backtests.length === 0) {
    return <p className="text-muted-foreground text-sm">لا توجد نتائج باكتست بعد.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-amber-500/10 text-muted-foreground">
            <th className="pb-2 text-start font-medium">الفريم</th>
            <th className="pb-2 text-start font-medium">الصفقات</th>
            <th className="pb-2 text-start font-medium">Win%</th>
            <th className="pb-2 text-start font-medium">PF</th>
            <th className="pb-2 text-start font-medium">Avg RR</th>
            <th className="pb-2 text-start font-medium">DD%</th>
          </tr>
        </thead>
        <tbody>
          {backtests.map((b) => (
            <tr key={b._id} className="border-b border-border/30">
              <td className="py-1.5 font-medium text-amber-100/80">{b.timeframe}</td>
              <td className="py-1.5 tabular-nums">{b.totalTrades}</td>
              <td className="py-1.5 tabular-nums">{b.winRate.toFixed(1)}%</td>
              <td className="py-1.5 tabular-nums">{b.profitFactor.toFixed(2)}</td>
              <td className="py-1.5 tabular-nums">{b.avgRR.toFixed(2)}</td>
              <td className="py-1.5 tabular-nums">{b.maxDrawdown.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── الصفحة الرئيسية ─────────────────────────────────────────────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const strategyId = params.id as Id<"strategies">;
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !authLoading && isAuthenticated;

  const strategy = useQuery(
    api.strategies.getStrategy,
    canUseConvex ? { strategyId } : "skip",
  );

  if (authLoading) {
    return (
      <div dir="rtl" className="mx-auto max-w-4xl">
        <p className="text-muted-foreground text-sm animate-pulse">جاري التحقق من المصادقة...</p>
      </div>
    );
  }
  if (!isAuthenticated) {
    return (
      <div dir="rtl" className="mx-auto max-w-4xl">
        <p className="text-muted-foreground text-sm">يجب تسجيل الدخول.</p>
      </div>
    );
  }
  if (strategy === undefined) {
    return (
      <div dir="rtl" className="mx-auto max-w-4xl">
        <p className="text-muted-foreground text-sm animate-pulse">جاري تحميل الاستراتيجية...</p>
      </div>
    );
  }
  if (!strategy) {
    return (
      <div dir="rtl" className="mx-auto max-w-4xl">
        <p className="text-muted-foreground text-sm">الاستراتيجية غير موجودة أو لا تملك صلاحية الوصول.</p>
        <Link href="/strategy-library" className="mt-2 text-amber-400 text-sm hover:underline">
          ← العودة إلى المكتبة
        </Link>
      </div>
    );
  }

  const statusCls = STATUS_COLOR[strategy.status] ?? "bg-zinc-500/20 text-zinc-300 border-zinc-500/20";

  return (
    <div dir="rtl" className="mx-auto flex max-w-4xl flex-col gap-6">
      {/* ─── تنقل ─── */}
      <Link
        href="/strategy-library"
        className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-amber-300 transition-colors"
      >
        <ArrowRight className="h-4 w-4" />
        العودة إلى مكتبة الاستراتيجيات
      </Link>

      {/* ─── رأس الاستراتيجية ─── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardContent className="px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="page-title">{strategy.name}</h2>
              {strategy.description ? (
                <p className="mt-1 text-muted-foreground text-sm">{strategy.description}</p>
              ) : null}
            </div>
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${statusCls}`}>
              {STATUS_AR[strategy.status] ?? strategy.status}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>
              الفريمات:{" "}
              <span className="text-amber-100/80">{strategy.allowedTimeframes.join(" · ") || "—"}</span>
            </span>
            <span>
              الجلسات:{" "}
              <span className="text-amber-100/80">{strategy.allowedSessions.join(" · ") || "—"}</span>
            </span>
            <span>
              حالة السوق:{" "}
              <span className="text-amber-100/80">{strategy.marketCondition}</span>
            </span>
            {strategy.tags.length > 0 ? (
              <span>
                التصنيفات:{" "}
                <span className="text-amber-100/80">{strategy.tags.join(" · ")}</span>
              </span>
            ) : null}
          </div>

          {strategy.notes ? (
            <p className="mt-3 rounded-lg border border-amber-500/10 bg-muted/10 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
              {strategy.notes}
            </p>
          ) : null}

          <div className="mt-4">
            <StatusChangePanel
              strategyId={strategyId}
              currentStatus={strategy.status}
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── القواعد ─── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-5 py-4">
          <CardTitle className="card-title-inst flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-amber-400" />
            قواعد الاستراتيجية
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <RulesSection strategyId={strategyId} />
        </CardContent>
      </Card>

      {/* ─── نتائج الباكتست ─── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-5 py-4">
          <CardTitle className="card-title-inst flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            نتائج الاختبار التاريخي
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <BacktestsSection strategyId={strategyId} />
        </CardContent>
      </Card>

      {/* ─── سجل القرارات ─── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-5 py-4">
          <CardTitle className="card-title-inst flex items-center gap-2">
            <History className="h-4 w-4 text-amber-400" />
            سجل تغييرات الحالة
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <DecisionsSection strategyId={strategyId} />
        </CardContent>
      </Card>

      {/* ─── تنبيه أمان ─── */}
      <p className="rounded-xl border border-amber-500/10 bg-amber-500/5 px-4 py-2.5 text-amber-100/60 text-xs">
        مكتبة الاستراتيجيات أداة توثيق فقط — لا تنفيذ تداول قبل المرحلة 14.
      </p>
    </div>
  );
}
