"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { parseHtmlBacktest, parseCsvBacktest } from "@/lib/strategy/backtest-parser";
import type { BacktestSummary } from "@/lib/strategy/backtest-parser";
import {
  ArrowRight,
  ChevronDown,
  ClipboardCheck,
  Eye,
  History,
  TrendingUp,
  Upload,
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

// ─── Shadow Mode ─────────────────────────────────────────────────────────────

const OUTCOME_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "معلق",    cls: "bg-zinc-500/20 text-zinc-300" },
  WIN:     { label: "ربح",     cls: "bg-emerald-500/20 text-emerald-300" },
  LOSS:    { label: "خسارة",   cls: "bg-rose-500/20 text-rose-300" },
  NEUTRAL: { label: "محايد",   cls: "bg-blue-500/20 text-blue-300" },
  EXPIRED: { label: "منتهية",  cls: "bg-zinc-400/20 text-zinc-400" },
};

function SignalOutcomeButton({
  signal,
}: {
  signal: { _id: string; outcome: string; slPrice: number; tp1Price: number };
}) {
  const recordOutcome = useMutation(api.strategies.recordSignalOutcome);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome]           = useState("");
  const [outcomePrice, setOutcomePrice] = useState("");
  const [actualRR, setActualRR]         = useState("");
  const [saving, setSaving]             = useState(false);

  if (signal.outcome !== "PENDING") {
    const o = OUTCOME_LABELS[signal.outcome] ?? OUTCOME_LABELS.PENDING;
    return (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${o.cls}`}>
        {o.label}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-zinc-500/20 text-zinc-300 hover:bg-zinc-500/30 transition-colors"
      >
        معلق ↓
      </button>
    );
  }

  async function handleSave() {
    if (!outcome) return;
    setSaving(true);
    try {
      await recordOutcome({
        signalId:     signal._id as Id<"strategySignals">,
        outcome,
        outcomeTime:  Date.now(),
        outcomePrice: outcomePrice ? parseFloat(outcomePrice) : undefined,
        actualRR:     actualRR    ? parseFloat(actualRR)     : undefined,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        className="rounded border border-amber-500/20 bg-muted/20 px-1.5 py-0.5 text-foreground text-[11px]"
      >
        <option value="">النتيجة</option>
        <option value="WIN">ربح</option>
        <option value="LOSS">خسارة</option>
        <option value="NEUTRAL">محايد</option>
        <option value="EXPIRED">منتهية</option>
      </select>
      <Input
        type="number"
        placeholder="سعر الخروج"
        value={outcomePrice}
        onChange={(e) => setOutcomePrice(e.target.value)}
        className="h-6 w-24 border-amber-500/20 bg-muted/20 text-[11px] px-1.5"
        dir="ltr"
      />
      <Input
        type="number"
        step="0.01"
        placeholder="RR"
        value={actualRR}
        onChange={(e) => setActualRR(e.target.value)}
        className="h-6 w-14 border-amber-500/20 bg-muted/20 text-[11px] px-1.5"
        dir="ltr"
      />
      <button
        onClick={() => void handleSave()}
        disabled={!outcome || saving}
        className="rounded bg-amber-600 px-2 py-0.5 text-white text-[11px] disabled:opacity-50"
      >
        {saving ? "..." : "حفظ"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-muted-foreground/60 text-[11px] hover:text-muted-foreground"
      >
        ×
      </button>
    </div>
  );
}

function SignalLogForm({
  strategyId,
  experimentId,
  onSaved,
}: {
  strategyId: Id<"strategies">;
  experimentId: Id<"strategyExperiments">;
  onSaved: () => void;
}) {
  const addSignal = useMutation(api.strategies.addStrategySignal);
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [entry, setEntry]         = useState("");
  const [sl, setSl]               = useState("");
  const [tp1, setTp1]             = useState("");
  const [tp2, setTp2]             = useState("");
  const [timeframe, setTimeframe]       = useState("H1");
  const [notes, setNotes]               = useState("");
  const [rulesMatchedRaw, setRulesMatchedRaw] = useState("");
  const [rulesMissedRaw,  setRulesMissedRaw]  = useState("");
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const entryN = parseFloat(entry);
    const slN    = parseFloat(sl);
    const tp1N   = parseFloat(tp1);
    if (!entryN || !slN || !tp1N) { setError("سعر الدخول والـ SL والـ TP1 مطلوبة"); return; }
    setSaving(true);
    setError("");
    try {
      await addSignal({
        strategyId,
        experimentId,
        signalTime:   Date.now(),
        timeframe,
        direction,
        entryPrice:   entryN,
        slPrice:      slN,
        tp1Price:     tp1N,
        tp2Price:     tp2 ? parseFloat(tp2) : undefined,
        mode:         "SHADOW",
        rulesMatched: rulesMatchedRaw.split(",").map((r) => r.trim()).filter(Boolean),
        rulesMissed:  rulesMissedRaw.split(",").map((r) => r.trim()).filter(Boolean),
        notes:        notes || undefined,
      });
      setEntry(""); setSl(""); setTp1(""); setTp2(""); setNotes("");
      setRulesMatchedRaw(""); setRulesMissedRaw("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-purple-500/15 bg-purple-500/5 p-4">
      <p className="text-purple-200 text-xs font-medium">تسجيل إشارة جديدة</p>
      {error ? <p className="text-rose-300 text-xs">{error}</p> : null}

      <div className="flex items-center gap-2">
        {(["BUY", "SELL"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              direction === d
                ? d === "BUY"
                  ? "bg-emerald-500/30 text-emerald-200 border border-emerald-500/50"
                  : "bg-rose-500/30 text-rose-200 border border-rose-500/50"
                : "bg-muted/20 text-muted-foreground border border-border/30 hover:bg-muted/30"
            }`}
          >
            {d === "BUY" ? "شراء ↑" : "بيع ↓"}
          </button>
        ))}
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="ms-auto rounded-md border border-amber-500/20 bg-muted/20 px-2 py-1.5 text-foreground text-xs"
        >
          {["M15", "H1", "H4", "D1"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { label: "سعر الدخول", value: entry, set: setEntry },
            { label: "Stop Loss",  value: sl,    set: setSl    },
            { label: "TP1",        value: tp1,   set: setTp1   },
            { label: "TP2",        value: tp2,   set: setTp2   },
          ] as const
        ).map(({ label, value, set }) => (
          <div key={label} className="space-y-0.5">
            <FieldLabel className="text-[11px]">{label}</FieldLabel>
            <Input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              className="h-7 border-amber-500/20 bg-muted/20 text-xs"
              dir="ltr"
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <FieldLabel className="text-[11px]">قواعد تحققت (مفصولة بفاصلة)</FieldLabel>
          <Input
            value={rulesMatchedRaw}
            onChange={(e) => setRulesMatchedRaw(e.target.value)}
            placeholder="EMA, Trend, Session..."
            className="border-emerald-500/20 bg-muted/20 text-xs"
            dir="ltr"
          />
        </div>
        <div className="space-y-0.5">
          <FieldLabel className="text-[11px]">قواعد ناقصة (مفصولة بفاصلة)</FieldLabel>
          <Input
            value={rulesMissedRaw}
            onChange={(e) => setRulesMissedRaw(e.target.value)}
            placeholder="Volume, Structure..."
            className="border-rose-500/20 bg-muted/20 text-xs"
            dir="ltr"
          />
        </div>
      </div>

      <div className="space-y-0.5">
        <FieldLabel className="text-[11px]">ملاحظات</FieldLabel>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="border-amber-500/20 bg-muted/20 text-xs"
        />
      </div>

      <Button type="submit" size="sm" disabled={saving}
        className="bg-purple-600 hover:bg-purple-700 text-white">
        {saving ? "جاري الحفظ..." : "تسجيل الإشارة"}
      </Button>
    </form>
  );
}

function ShadowModeSection({ strategyId }: { strategyId: Id<"strategies"> }) {
  const createExp   = useMutation(api.strategies.createStrategyExperiment);
  const updateExp   = useMutation(api.strategies.updateStrategyExperiment);
  const activeExp   = useQuery(api.strategies.getActiveExperiment, { strategyId });
  const signals     = useQuery(
    api.strategies.listExperimentSignals,
    activeExp ? { experimentId: activeExp._id } : "skip",
  );
  const allExps     = useQuery(api.strategies.listStrategyExperiments, { strategyId });

  const [showForm, setShowForm]         = useState(false);
  const [endReason, setEndReason]       = useState("");
  const [showEndForm, setShowEndForm]   = useState(false);
  const [creatingExp, setCreatingExp]   = useState(false);
  const [endingSaving, setEndingSaving] = useState(false);

  async function handleCreateExp() {
    setCreatingExp(true);
    try {
      await createExp({ strategyId, experimentType: "SHADOW" });
    } finally {
      setCreatingExp(false);
    }
  }

  async function handleEndExp() {
    if (!activeExp || !endReason.trim()) return;
    setEndingSaving(true);
    try {
      await updateExp({
        experimentId: activeExp._id,
        endedAt:   Date.now(),
        endReason: endReason.trim(),
      });
      setShowEndForm(false);
      setEndReason("");
    } finally {
      setEndingSaving(false);
    }
  }

  if (activeExp === undefined) {
    return <p className="text-muted-foreground text-sm animate-pulse">جاري التحميل...</p>;
  }

  return (
    <div className="space-y-4">
      {/* ─── إحصاءات التجارب السابقة المغلقة ─── */}
      {allExps && allExps.filter((e) => e.endedAt).length > 0 ? (
        <div className="space-y-2">
          <p className="text-muted-foreground/70 text-xs">التجارب المنتهية:</p>
          {allExps.filter((e) => e.endedAt).map((exp) => (
            <div
              key={exp._id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/30 bg-muted/10 px-3 py-2 text-xs"
            >
              <span className="text-muted-foreground/60">
                {new Date(exp.startedAt).toLocaleDateString("ar-SA")} →{" "}
                {exp.endedAt ? new Date(exp.endedAt).toLocaleDateString("ar-SA") : "—"}
              </span>
              <span>إشارات: <span className="tabular-nums text-amber-100/80">{exp.totalSignals}</span></span>
              <span>Win: <span className="tabular-nums text-emerald-400">{exp.winRate?.toFixed(1) ?? 0}%</span></span>
              <span>Avg RR: <span className="tabular-nums text-amber-100/80">{exp.avgRR?.toFixed(2) ?? "—"}</span></span>
              {exp.violations > 0 ? (
                <span className="text-rose-300">مخالفات: {exp.violations}</span>
              ) : null}
              {exp.endReason ? (
                <span className="text-muted-foreground/60 w-full mt-0.5">سبب الإنهاء: {exp.endReason}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* ─── لا تجربة نشطة ─── */}
      {!activeExp ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">لا توجد تجربة Shadow Mode نشطة.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCreateExp()}
            disabled={creatingExp}
            className="border-purple-500/30 text-purple-200 hover:bg-purple-500/10"
          >
            {creatingExp ? "..." : "بدء تجربة Shadow Mode"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* إحصاءات التجربة النشطة */}
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-purple-200 text-sm font-medium">تجربة نشطة</p>
              <span className="text-[11px] text-muted-foreground/60">
                منذ {new Date(activeExp.startedAt).toLocaleDateString("ar-SA")}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              <span>
                إشارات: <span className="tabular-nums text-amber-100/80 font-medium">{activeExp.totalSignals}</span>
              </span>
              <span>
                ربح: <span className="tabular-nums text-emerald-400 font-medium">{activeExp.winCount}</span>
              </span>
              <span>
                خسارة: <span className="tabular-nums text-rose-400 font-medium">{activeExp.lossCount}</span>
              </span>
              <span>
                Win%: <span className="tabular-nums text-amber-100/80 font-medium">
                  {activeExp.winRate != null ? `${activeExp.winRate.toFixed(1)}%` : "—"}
                </span>
              </span>
              {activeExp.avgRR != null && activeExp.avgRR > 0 ? (
                <span>
                  Avg RR: <span className="tabular-nums text-amber-100/80 font-medium">{activeExp.avgRR.toFixed(2)}</span>
                </span>
              ) : null}
              {signals && signals.length > 0 ? (() => {
                const withRules = signals.filter((s) => s.rulesMatched.length > 0 || s.rulesMissed.length > 0);
                if (withRules.length === 0) return null;
                const fullyCompliant = withRules.filter((s) => s.rulesMissed.length === 0).length;
                const rate = Math.round((fullyCompliant / withRules.length) * 100);
                return (
                  <span>
                    امتثال: <span className={`tabular-nums font-medium ${rate >= 80 ? "text-emerald-400" : rate >= 60 ? "text-amber-300" : "text-rose-400"}`}>{rate}%</span>
                    <span className="text-muted-foreground/50 ms-0.5">({withRules.length})</span>
                  </span>
                );
              })() : null}
              {activeExp.violations > 0 ? (
                <span className="text-rose-300">مخالفات: {activeExp.violations}</span>
              ) : null}
            </div>

            {/* إنهاء التجربة */}
            <div className="mt-4 border-t border-purple-500/15 pt-3">
              {!showEndForm ? (
                <button
                  onClick={() => setShowEndForm(true)}
                  className="text-muted-foreground/60 text-xs hover:text-rose-300 transition-colors"
                >
                  إنهاء التجربة ×
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    value={endReason}
                    onChange={(e) => setEndReason(e.target.value)}
                    placeholder="سبب الإنهاء"
                    className="h-7 border-rose-500/20 bg-muted/20 text-xs flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleEndExp()}
                    disabled={!endReason.trim() || endingSaving}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs h-7"
                  >
                    {endingSaving ? "..." : "إنهاء"}
                  </Button>
                  <button
                    onClick={() => setShowEndForm(false)}
                    className="text-muted-foreground/60 text-xs"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* تسجيل إشارة */}
          {!showForm ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
              className="border-purple-500/30 text-purple-200 hover:bg-purple-500/10"
            >
              + تسجيل إشارة جديدة
            </Button>
          ) : (
            <SignalLogForm
              strategyId={strategyId}
              experimentId={activeExp._id}
              onSaved={() => setShowForm(false)}
            />
          )}

          {/* قائمة الإشارات */}
          {signals === undefined ? (
            <p className="text-muted-foreground text-xs animate-pulse">جاري تحميل الإشارات...</p>
          ) : signals.length === 0 ? (
            <p className="text-muted-foreground text-xs">لا توجد إشارات بعد — سجّل أول إشارة أعلاه.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground/70 text-xs">آخر {signals.length} إشارة:</p>
              {signals.map((sig) => (
                <div
                  key={sig._id}
                  className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={`text-xs font-medium ${
                      sig.direction === "BUY" ? "text-emerald-400" : "text-rose-400"
                    }`}>
                      {sig.direction === "BUY" ? "شراء ↑" : "بيع ↓"}
                    </span>
                    <span className="text-xs text-muted-foreground">{sig.timeframe}</span>
                    <span className="text-xs tabular-nums">
                      دخول <span className="text-amber-100/80">{sig.entryPrice}</span>
                    </span>
                    <span className="text-xs tabular-nums text-rose-300/80">SL {sig.slPrice}</span>
                    <span className="text-xs tabular-nums text-emerald-300/80">TP {sig.tp1Price}</span>
                    <span className="text-muted-foreground/50 text-[11px] ms-auto">
                      {new Date(sig.signalTime).toLocaleString("ar-SA", { hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {sig.notes ? (
                    <p className="mt-1 text-muted-foreground/60 text-[11px]">{sig.notes}</p>
                  ) : null}
                  {(sig.rulesMatched.length > 0 || sig.rulesMissed.length > 0) ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sig.rulesMatched.map((r) => (
                        <span key={r} className="rounded-full bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[10px]">✓ {r}</span>
                      ))}
                      {sig.rulesMissed.map((r) => (
                        <span key={r} className="rounded-full bg-rose-500/15 text-rose-400 px-1.5 py-0.5 text-[10px]">✗ {r}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <SignalOutcomeButton signal={sig} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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

// ─── رفع تقرير الباكتست ──────────────────────────────────────────────────────

const TIMEFRAME_OPTS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];
const PLAN_OPTS      = ["Conservative", "Balanced", "Aggressive"];
const TARGET_OPTS    = ["REALISTIC", "BALANCED", "FAR"];

function BacktestUploadSection({ strategyId }: { strategyId: Id<"strategies"> }) {
  const addFile     = useMutation(api.strategies.addStrategyFile);
  const addBacktest = useMutation(api.strategies.addStrategyBacktest);

  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen]               = useState(false);
  const [fileName, setFileName]       = useState("");
  const [parsed, setParsed]           = useState<BacktestSummary | null>(null);
  const [parseError, setParseError]   = useState("");
  const [timeframe, setTimeframe]     = useState("H1");
  const [periodFrom, setPeriodFrom]   = useState("");
  const [periodTo, setPeriodTo]       = useState("");
  const [selectedPlan, setSelectedPlan]     = useState("Balanced");
  const [selectedTarget, setSelectedTarget] = useState("BALANCED");
  const [notes, setNotes]             = useState("");
  const [totalTrades, setTotalTrades] = useState("0");
  const [winRate, setWinRate]         = useState("0");
  const [netProfit, setNetProfit]     = useState("0");
  const [maxDrawdown, setMaxDrawdown] = useState("0");
  const [profitFactor, setProfitFactor] = useState("1");
  const [avgRR, setAvgRR]             = useState("1");
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState("");

  function fillForm(s: BacktestSummary) {
    setTotalTrades(String(s.totalTrades));
    setWinRate(s.winRate.toFixed(1));
    setNetProfit(s.netProfit.toFixed(2));
    setMaxDrawdown(s.maxDrawdown.toFixed(2));
    setProfitFactor(s.profitFactor.toFixed(2));
    setAvgRR(s.avgRR.toFixed(2));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    setParsed(null);
    try {
      const text = await file.text();
      const lower = file.name.toLowerCase();
      const isHtml = lower.endsWith(".htm") || lower.endsWith(".html");
      const isCsv  = lower.endsWith(".csv");
      if (!isHtml && !isCsv) {
        setParseError("يُقبل فقط HTML أو CSV. للملفات الأخرى أدخل البيانات يدوياً.");
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      const result = isHtml ? parseHtmlBacktest(text) : parseCsvBacktest(text);
      setParsed(result);
      fillForm(result);
    } catch {
      setParseError("تعذّر قراءة الملف. أدخل البيانات يدوياً.");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");
    const trades = parseInt(totalTrades, 10);
    if (!trades || trades < 1) { setSaveError("عدد الصفقات يجب أن يكون > 0"); return; }
    setSaving(true);
    try {
      const from = periodFrom ? new Date(periodFrom).getTime() : Date.now() - 365 * 24 * 3600 * 1000;
      const to   = periodTo   ? new Date(periodTo).getTime()   : Date.now();
      const fileId = await addFile({
        strategyId,
        fileType:      "BACKTEST_HTML",
        fileName:      fileName || "manual-entry",
        timeframe,
        periodFrom:    from,
        periodTo:      to,
        notes:         notes || undefined,
        parsedSummary: parsed ? JSON.stringify(parsed.raw) : undefined,
      });
      await addBacktest({
        strategyId,
        fileId,
        timeframe,
        periodFrom:   from,
        periodTo:     to,
        totalTrades:  trades,
        winRate:      parseFloat(winRate)      || 0,
        netProfit:    parseFloat(netProfit)    || 0,
        maxDrawdown:  parseFloat(maxDrawdown)  || 0,
        profitFactor: parseFloat(profitFactor) || 1,
        avgRR:        parseFloat(avgRR)        || 1,
        selectedPlan,
        selectedTarget,
        notes: notes || undefined,
      });
      setOpen(false);
      setParsed(null);
      setFileName("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "حدث خطأ");
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
        <Upload className="h-3.5 w-3.5 me-1.5" />
        رفع تقرير باكتست
      </Button>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel>ملف التقرير (HTML أو CSV من MT5 Strategy Tester)</FieldLabel>
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm,.csv"
          onChange={handleFileChange}
          className="block w-full rounded-md border border-amber-500/20 bg-muted/20 px-3 py-1.5 text-foreground text-xs file:me-2 file:rounded file:border-0 file:bg-amber-500/20 file:px-2 file:py-1 file:text-amber-200 file:text-xs"
        />
        {fileName ? (
          <p className="text-muted-foreground/70 text-[11px]">الملف: {fileName}</p>
        ) : null}
        {parseError ? (
          <p className="text-amber-300 text-xs">{parseError}</p>
        ) : parsed ? (
          <p className="text-emerald-400 text-xs">تم استخراج البيانات — راجعها قبل الحفظ.</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(
          [
            { label: "عدد الصفقات",   value: totalTrades,   set: setTotalTrades,   step: "1" },
            { label: "Win Rate %",     value: winRate,        set: setWinRate,        step: "0.1" },
            { label: "صافي الربح",     value: netProfit,      set: setNetProfit,      step: "0.01" },
            { label: "Max Drawdown %", value: maxDrawdown,    set: setMaxDrawdown,    step: "0.01" },
            { label: "Profit Factor",  value: profitFactor,   set: setProfitFactor,   step: "0.01" },
            { label: "Avg RR",         value: avgRR,          set: setAvgRR,          step: "0.01" },
          ] as const
        ).map(({ label, value, set, step }) => (
          <div key={label} className="space-y-1">
            <FieldLabel>{label}</FieldLabel>
            <Input
              type="number"
              step={step}
              value={value}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              className="border-amber-500/20 bg-muted/20 text-xs"
              dir="ltr"
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <FieldLabel>الفريم</FieldLabel>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}
            className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-2 py-1.5 text-foreground text-xs">
            {TIMEFRAME_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <FieldLabel>الخطة</FieldLabel>
          <select value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)}
            className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-2 py-1.5 text-foreground text-xs">
            {PLAN_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <FieldLabel>الهدف</FieldLabel>
          <select value={selectedTarget} onChange={(e) => setSelectedTarget(e.target.value)}
            className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-2 py-1.5 text-foreground text-xs">
            {TARGET_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-1 col-span-2 sm:col-span-1">
          <FieldLabel>ملاحظات</FieldLabel>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)}
            className="border-amber-500/20 bg-muted/20 text-xs" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel>بداية الفترة</FieldLabel>
          <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)}
            className="border-amber-500/20 bg-muted/20 text-xs" dir="ltr" />
        </div>
        <div className="space-y-1">
          <FieldLabel>نهاية الفترة</FieldLabel>
          <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)}
            className="border-amber-500/20 bg-muted/20 text-xs" dir="ltr" />
        </div>
      </div>

      {saveError ? <p className="text-rose-300 text-xs">{saveError}</p> : null}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
          إلغاء
        </Button>
        <Button type="submit" size="sm" disabled={saving}
          className="bg-amber-600 hover:bg-amber-700 text-white">
          {saving ? "جاري الحفظ..." : "حفظ نتائج الباكتست"}
        </Button>
      </div>
    </form>
  );
}

// ─── ملخص الباكتست ───────────────────────────────────────────���────────────────

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

      {/* ─── نتائج الباكتست + رفع ─── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="card-title-inst flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-400" />
              نتائج الاختبار التاريخي
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 px-5 py-4">
          <BacktestUploadSection strategyId={strategyId} />
          <BacktestsSection strategyId={strategyId} />
        </CardContent>
      </Card>

      {/* ─── Shadow Mode ─── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-5 py-4">
          <CardTitle className="card-title-inst flex items-center gap-2">
            <Eye className="h-4 w-4 text-purple-400" />
            وضع المراقبة (Shadow Mode)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <ShadowModeSection strategyId={strategyId} />
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
