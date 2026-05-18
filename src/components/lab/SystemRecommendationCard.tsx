"use client";

/**
 * SystemRecommendationCard — Gold Recommendation Engine v1
 * ─────────────────────────────────────────────────────────────────────────────
 * عرض بطاقة "توصية النظام" الموحّدة.
 * المدخل: GoldRecommendation جاهز من buildGoldRecommendation.
 * لا منطق حساب — عرض فقط.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from "react";
import type {
  GoldRecommendation,
  RecommendationStatus,
  RecommendationDirection,
} from "@/lib/gold/gold-recommendation-engine";

// ─── Status display config ────────────────────────────────────────────────────

type StatusConfig = {
  label:       string;
  icon:        string;
  badgeClass:  string;
  borderClass: string;
  bgClass:     string;
  dotClass:    string;
};

const STATUS_CONFIG: Record<RecommendationStatus, StatusConfig> = {
  BLOCKED: {
    label:       "محظور",
    icon:        "✗",
    badgeClass:  "text-red-300 bg-red-500/10 border-red-500/40",
    borderClass: "border-red-500/25",
    bgClass:     "bg-red-500/5",
    dotClass:    "bg-red-400",
  },
  NO_TRADE: {
    label:       "لا صفقة",
    icon:        "—",
    badgeClass:  "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
    borderClass: "border-zinc-500/20",
    bgClass:     "bg-zinc-500/5",
    dotClass:    "bg-zinc-500",
  },
  WATCH: {
    label:       "مراقبة",
    icon:        "◎",
    badgeClass:  "text-sky-300 bg-sky-500/10 border-sky-500/30",
    borderClass: "border-sky-500/20",
    bgClass:     "bg-sky-500/5",
    dotClass:    "bg-sky-400",
  },
  CANDIDATE: {
    label:       "مرشّح",
    icon:        "◈",
    badgeClass:  "text-amber-300 bg-amber-500/10 border-amber-500/30",
    borderClass: "border-amber-500/20",
    bgClass:     "bg-amber-500/5",
    dotClass:    "bg-amber-400",
  },
  EXPERIMENTAL: {
    label:       "تجربة محكومة",
    icon:        "◇",
    badgeClass:  "text-violet-300 bg-violet-500/10 border-violet-500/30",
    borderClass: "border-violet-500/20",
    bgClass:     "bg-violet-500/5",
    dotClass:    "bg-violet-400",
  },
  APPROVED: {
    label:       "جاهز للمراجعة",
    icon:        "▶",
    badgeClass:  "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    borderClass: "border-emerald-500/20",
    bgClass:     "bg-emerald-500/5",
    dotClass:    "bg-emerald-400",
  },
};

// ─── Direction helpers ────────────────────────────────────────────────────────

function directionLabel(d: RecommendationDirection): string {
  if (d === "BUY")  return "↑ شراء";
  if (d === "SELL") return "↓ بيع";
  return "محايد";
}

function directionClass(d: RecommendationDirection): string {
  if (d === "BUY")  return "text-emerald-300 font-bold";
  if (d === "SELL") return "text-red-300 font-bold";
  return "text-zinc-400";
}

// ─── Confidence bar ───────────────────────────────────────────────────────────

function ConfidenceBar({ pct, status }: { pct: number; status: RecommendationStatus }) {
  const barColor =
    status === "APPROVED"     ? "bg-emerald-500/70" :
    status === "EXPERIMENTAL" ? "bg-violet-500/70"  :
    status === "CANDIDATE"    ? "bg-amber-500/70"   :
    status === "WATCH"        ? "bg-sky-500/70"     :
    status === "BLOCKED"      ? "bg-red-500/70"     :
                                "bg-zinc-500/50";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-700/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Collapsible list ─────────────────────────────────────────────────────────

function CollapsibleList({
  label,
  items,
  defaultOpen = false,
  itemClass = "text-foreground/75",
  dotClass  = "text-amber-400/60",
}: {
  label:        string;
  items:        string[];
  defaultOpen?: boolean;
  itemClass?:   string;
  dotClass?:    string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground/70 transition-colors"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{label} ({items.length})</span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {items.map((item, i) => (
            <li key={i} className={`flex items-start gap-1.5 text-xs leading-relaxed ${itemClass}`}>
              <span className={`mt-0.5 shrink-0 ${dotClass}`}>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SystemRecommendationCard({
  recommendation: rec,
}: {
  recommendation: GoldRecommendation;
}) {
  const cfg = STATUS_CONFIG[rec.recommendationStatus];

  return (
    <div
      dir="rtl"
      className={`rounded-xl border ${cfg.borderClass} ${cfg.bgClass} p-4 space-y-4`}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dotClass}`} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              توصية النظام
            </span>
          </div>
          <p className="text-sm font-bold text-foreground/90 leading-snug mt-0.5">
            {rec.title}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Status badge */}
          <span className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold ${cfg.badgeClass}`}>
            <span>{cfg.icon}</span>
            <span>{cfg.label}</span>
          </span>

          {/* Direction badge */}
          {rec.direction !== "NEUTRAL" && (
            <span className={`text-sm ${directionClass(rec.direction)}`}>
              {directionLabel(rec.direction)}
            </span>
          )}

          {/* Grade */}
          <span className="text-[10px] font-mono font-bold text-amber-300/80 border border-amber-500/20 rounded px-1.5 py-0.5">
            {rec.grade}
          </span>
        </div>
      </div>

      {/* ── Confidence bar ──────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>ثقة النظام</span>
          <span>{rec.confidencePercent}%</span>
        </div>
        <ConfidenceBar pct={rec.confidencePercent} status={rec.recommendationStatus} />
      </div>

      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <p className="text-xs text-foreground/75 leading-relaxed">{rec.summary}</p>

      {/* ── Reasons / Warnings / Blockers ────────────────────────────────── */}
      <div className="space-y-3">
        <CollapsibleList
          label="أسباب التوصية"
          items={rec.reasons}
          defaultOpen={rec.reasons.length > 0}
          itemClass="text-foreground/75"
          dotClass="text-amber-400/60"
        />
        <CollapsibleList
          label="تحذيرات"
          items={rec.warnings}
          defaultOpen={rec.warnings.length > 0}
          itemClass="text-amber-300/80"
          dotClass="text-amber-400"
        />
        <CollapsibleList
          label="أسباب المنع"
          items={rec.blockers}
          defaultOpen={rec.blockers.length > 0}
          itemClass="text-red-300/80"
          dotClass="text-red-400"
        />
      </div>

      {/* ── Risk summary ────────────────────────────────────────────────────── */}
      {rec.riskSummary !== "—" && (
        <div className="rounded-md border border-border/30 bg-background/20 px-3 py-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">المخاطر: </span>
          <span className="text-xs text-foreground/80 font-mono">{rec.riskSummary}</span>
        </div>
      )}

      {/* ── Execution status + next action ──────────────────────────────────── */}
      <div className="border-t border-border/20 pt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">قرار التنفيذ</span>
          <span className={`text-xs font-semibold ${
            rec.executionAllowed ? "text-emerald-300" : "text-zinc-400"
          }`}>
            {rec.executionModeLabel}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          <span className="text-amber-400/70 font-medium">الخطوة التالية: </span>
          {rec.nextAction}
        </p>
      </div>

      {/* ── Disclaimer ──────────────────────────────────────────────────────── */}
      <p className="text-[10px] text-muted-foreground/40 italic border-t border-border/20 pt-2">
        توصية النظام — تحليل استرشادي فقط — ليس توصية مالية — لا تنفيذ تداول تلقائي.
      </p>
    </div>
  );
}
