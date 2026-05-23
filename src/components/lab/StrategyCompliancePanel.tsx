"use client";

/**
 * StrategyCompliancePanel — لجنة الاستراتيجية
 * Section 7.3 of the development plan.
 * Read-only: checks current signal conditions against a selected strategy's rules.
 * No execution — informational display only.
 */

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { AlertCircle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";

// ─── Session detection ────────────────────────────────────────────────────────

function getCurrentSessions(): string[] {
  const h = new Date().getUTCHours();
  const s: string[] = [];
  if (h >= 0  && h < 9)  s.push("Asian");
  if (h >= 7  && h < 16) s.push("London");
  if (h >= 12 && h < 21) s.push("NewYork");
  return s.length > 0 ? s : [];
}

// ─── Constants ─────────────────��─────────────────────────────────────────────

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

const APPROVED_STATUSES = new Set(["APPROVED", "CONDITIONALLY_APPROVED"]);

// ─── Sub-components ─────────���──────────────────────────────���──────────────────

type CheckResult = "pass" | "fail" | "warn" | "info";

function CheckRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: CheckResult;
  detail: string;
}) {
  const icon = {
    pass: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />,
    fail: <XCircle     className="h-3.5 w-3.5 text-rose-400   shrink-0" />,
    warn: <AlertCircle className="h-3.5 w-3.5 text-amber-400  shrink-0" />,
    info: <ShieldCheck className="h-3.5 w-3.5 text-blue-400   shrink-0" />,
  }[status];

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/20 last:border-0">
      <span className="mt-0.5">{icon}</span>
      <span className="text-xs text-muted-foreground shrink-0 w-32">{label}</span>
      <span className="text-xs text-foreground/80 leading-relaxed">{detail}</span>
    </div>
  );
}

function RuleBlock({ title, text, color = "foreground" }: { title: string; text: string; color?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{title}</p>
      <p className={`text-xs leading-relaxed whitespace-pre-line text-${color}/80`}>{text}</p>
    </div>
  );
}

// ─── Main component ───────────────────────��────────────────────────────��──────

export function StrategyCompliancePanel() {
  const { isAuthenticated } = useConvexAuth();
  const [strategyId, setStrategyId] = useState<string>("");

  const strategies = useQuery(
    api.strategies.listStrategiesForSelect,
    isAuthenticated ? {} : "skip",
  );

  const strategy = useQuery(
    api.strategies.getStrategy,
    strategyId ? { strategyId: strategyId as Id<"strategies"> } : "skip",
  );

  const rules = useQuery(
    api.strategies.getStrategyRules,
    strategyId ? { strategyId: strategyId as Id<"strategies"> } : "skip",
  );

  if (!isAuthenticated) return null;

  const currentSessions = getCurrentSessions();
  const isApproved   = strategy ? APPROVED_STATUSES.has(strategy.status) : false;
  const sessionMatch = strategy?.allowedSessions.length === 0
    ? true
    : currentSessions.some((s) => strategy?.allowedSessions.includes(s));

  const overallBlocked =
    strategy && (strategy.status === "DRAFT" || strategy.status === "REJECTED");

  return (
    <Card className={institutionalCardClass(`p-0 ${overallBlocked ? "border-rose-500/30" : ""}`)}>
      <CardHeader className="border-b border-amber-500/10 px-4 py-3">
        <CardTitle className="card-title-inst flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-amber-400" />
          لجنة الاستراتيجية
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-4">

        {/* Strategy selector */}
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            الاستراتيجية المرجعية
          </label>
          <select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-3 py-2 text-foreground text-sm"
          >
            <option value="">
              {!strategies
                ? "جاري التحميل..."
                : strategies.length === 0
                ? "لا توجد استراتيجيات — أنشئ واحدة في مكتبة الاستراتيجيات"
                : "ا��تر استراتيجية للمقارنة..."}
            </option>
            {(strategies ?? []).map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} — {STATUS_AR[s.status] ?? s.status}
              </option>
            ))}
          </select>
        </div>

        {/* Blocked banner */}
        {overallBlocked ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2">
            <p className="text-rose-300 text-xs font-medium">
              ⛔ الاستراتيجية في حالة {STATUS_AR[strategy!.status]} — منع تام من الاستخدام.
            </p>
          </div>
        ) : null}

        {strategy ? (
          <>
            {/* Automated checks */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                فحوصات تلقائية
              </p>
              <div className="space-y-0">
                <CheckRow
                  label="حالة الاس��راتيجية"
                  status={isApproved ? "pass" : overallBlocked ? "fail" : "warn"}
                  detail={
                    isApproved
                      ? `${STATUS_AR[strategy.status]} — مسموح بالاستخدام`
                      : `${STATUS_AR[strategy.status]} — يُنصح بالحذر`
                  }
                />
                <CheckRow
                  label="الجلسة الحالية"
                  status={
                    strategy.allowedSessions.length === 0
                      ? "info"
                      : sessionMatch
                      ? "pass"
                      : "fail"
                  }
                  detail={`الآن: ${currentSessions.length > 0 ? currentSessions.join(" + ") : "خارج الجلسات"} — مسموح: ${
                    strategy.allowedSessions.length > 0
                      ? strategy.allowedSessions.join(" · ")
                      : "أي جلسة"
                  }`}
                />
              </div>
            </div>

            {/* Manual checks */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                فحوصات يدوية — تحقق بنفسك
              </p>
              <div className="space-y-0">
                <CheckRow
                  label="��لفريم الزمني"
                  status="info"
                  detail={`الفريمات المسموحة: ${strategy.allowedTimeframes.join(" · ") || "أي فري��"}`}
                />
                <CheckRow
                  label="حالة السوق"
                  status="info"
                  detail={`المطلوب: ${
                    strategy.marketCondition === "ANY"
                      ? "أي حالة"
                      : strategy.marketCondition === "TRENDING"
                      ? "اتجاهي (Trending)"
                      : strategy.marketCondition === "RANGING"
                      ? "عرضي (Ranging)"
                      : strategy.marketCondition === "VOLATILE"
                      ? "متقلب (Volatile)"
                      : strategy.marketCondition
                  }`}
                />
                {rules ? (
                  <CheckRow
                    label="شروط الدخول"
                    status="info"
                    detail="موثقة أدناه — تحقق يدوياً"
                  />
                ) : null}
              </div>
            </div>

            {/* Strategy rules */}
            {rules ? (
              <div className="space-y-3 pt-2 border-t border-border/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  قواعد الاستراتيجية
                </p>
                {rules.entryConditions ? (
                  <RuleBlock title="شروط الد��ول" text={rules.entryConditions} color="foreground" />
                ) : null}
                {rules.blockConditions ? (
                  <RuleBlock title="شروط المنع" text={rules.blockConditions} color="amber-300" />
                ) : null}
                {rules.invalidationRules ? (
                  <RuleBlock title="شروط الإلغاء" text={rules.invalidationRules} color="rose-300" />
                ) : null}
                {rules.exitConditions ? (
                  <RuleBlock title="شروط الخروج" text={rules.exitConditions} color="foreground" />
                ) : null}
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                  {rules.minRR > 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      حد RR: <span className="text-amber-100/80 font-medium">{rules.minRR}</span>
                    </span>
                  ) : null}
                  {rules.maxSpread > 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      أقصى سبريد: <span className="text-amber-100/80 font-medium">{rules.maxSpread}</span>
                    </span>
                  ) : null}
                  {rules.entryType ? (
                    <span className="text-[11px] text-muted-foreground">
                      نوع الدخول: <span className="text-amber-100/80 font-medium">{rules.entryType}</span>
                    </span>
                  ) : null}
                  {rules.defaultPlan ? (
                    <span className="text-[11px] text-muted-foreground">
                      الخطة ال��فتراضية: <span className="text-amber-100/80 font-medium">{rules.defaultPlan}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60 pt-1 border-t border-border/20">
                لا توجد قواعد موثقة لهذه الاستراتيجية — وثّق القواعد في مكتبة الاستراتيجيات.
              </p>
            )}
          </>
        ) : strategyId ? (
          <p className="text-xs text-muted-foreground animate-pulse">جاري التحميل...</p>
        ) : (
          <p className="text-xs text-muted-foreground/60">
            اختر ��ستراتيجية لعرض متطلباتها ومقارنتها بتحليلك الحالي يدوياً.
          </p>
        )}

        <p className="text-[10px] text-muted-foreground/50 border-t border-border/15 pt-3">
          هذه اللجنة تعرض قواعد الاستراتيجية للمراجعة اليدوية ��� لا تمنع التنفيذ تقنياً — القرار للمستخدم.
        </p>
      </CardContent>
    </Card>
  );
}
