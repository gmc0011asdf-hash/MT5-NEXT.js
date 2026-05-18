"use client";

import { useState, useEffect, useCallback } from "react";
import {
  GOLD_PROFILE,
  runGoldDecisionEngine,
  type GoldDecisionResult,
  type GoldConnectionState,
} from "@/lib/gold/gold-profile";
import {
  classifyMarketRegime,
  parseOhlcCandles,
  type RegimeClassification,
  type MarketRegime,
} from "@/lib/gold/gold-regime-classifier";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { Button } from "@/components/ui/button";

const LOCAL_SYMBOLS_KEY = "mt5:selectedAnalysisSymbols";
const CANDLE_COUNT      = 30;

// ─── Regime display helpers ───────────────────────────────────────────────────

const REGIME_LABELS: Record<MarketRegime, string> = {
  Pending:              "معلق",
  Trend:                "اتجاه",
  Range:                "نطاق",
  LowQuality:           "جودة منخفضة",
  DataMissing:          "بيانات ناقصة",
  NewsRiskPlaceholder:  "خطر إخباري",
};

const REGIME_BADGE: Record<MarketRegime, string> = {
  Pending:             "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  Trend:               "border-blue-500/30 bg-blue-500/10 text-blue-300",
  Range:               "border-violet-500/30 bg-violet-500/10 text-violet-300",
  LowQuality:          "border-orange-500/30 bg-orange-500/10 text-orange-300",
  DataMissing:         "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  NewsRiskPlaceholder: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

const CONFIDENCE_BADGE: Record<"Low" | "Medium", string> = {
  Low:    "text-zinc-400",
  Medium: "text-amber-300/80",
};

// ─── Component ────────────────────────────────────────────────────────────────

type LoadState = "idle" | "loading" | "loaded" | "error";

export function GoldStatusCard() {
  const [loadState,  setLoadState]  = useState<LoadState>("idle");
  const [decision,   setDecision]   = useState<GoldDecisionResult | null>(null);
  const [connState,  setConnState]  = useState<GoldConnectionState | null>(null);
  const [regime,     setRegime]     = useState<RegimeClassification | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchedAt,  setFetchedAt]  = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setFetchError(null);

    try {
      const [connRes, symRes, candleRes] = await Promise.all([
        fetch("/api/mt5-readonly/connection-status", { cache: "no-store" }),
        fetch("/api/mt5-readonly/symbols?visibleOnly=true", { cache: "no-store" }),
        fetch(
          `/api/mt5-readonly/candles?symbols=${GOLD_PROFILE.symbol}&timeframes=M15&count=${CANDLE_COUNT}`,
          { cache: "no-store" },
        ),
      ]);

      const connData   = (await connRes.json())   as Record<string, unknown>;
      const symData    = (await symRes.json())    as Record<string, unknown>;
      const candleData = (await candleRes.json()) as Record<string, unknown>;

      // ── Connection state ────────────────────────────────────────────────────
      const mt5Connected = connData.connected === true;
      const readOnly     = connData.read_only !== false;
      const symbolList   = Array.isArray(symData.symbols)
        ? (symData.symbols as Array<{ name?: unknown }>)
        : [];
      const symbolCount  = symbolList.length;
      const xauusdInApi  = symbolList.some((s) => s.name === GOLD_PROFILE.symbol);

      const lsRaw      = typeof window !== "undefined" ? localStorage.getItem(LOCAL_SYMBOLS_KEY) : null;
      const lsSymbols  = lsRaw ? (JSON.parse(lsRaw) as string[]) : [];
      const xauusdFound = xauusdInApi || lsSymbols.includes(GOLD_PROFILE.symbol);

      const state: GoldConnectionState = {
        mt5Connected,
        readOnly,
        xauusdFound,
        spread:      null,
        lastPrice:   null,
        symbolCount,
      };

      // ── Market Regime ───────────────────────────────────────────────────────
      const rawCandles  = Array.isArray(candleData.candles) ? candleData.candles : [];
      const ohlcCandles = parseOhlcCandles(rawCandles as unknown[]);
      const classified  = classifyMarketRegime(ohlcCandles);

      // ── Decision engine ─────────────────────────────────────────────────────
      const result = runGoldDecisionEngine(state, classified);

      setConnState(state);
      setRegime(classified);
      setDecision(result);
      setFetchedAt(new Date());
      setLoadState("loaded");
    } catch {
      setFetchError("فشل الاتصال بخدمة MT5 المحلية — تأكد من تشغيل الجسر.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isBlock = decision?.decision === "BLOCK";

  return (
    <div className={institutionalCardClass("p-4 space-y-3")} dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300/90 tracking-wide">
            {GOLD_PROFILE.modeName}
          </span>
          <span className="font-bold text-amber-200 text-sm tabular-nums">
            {GOLD_PROFILE.symbol}
          </span>
        </div>

        {loadState === "loaded" && decision && (
          <span
            className={
              isBlock
                ? "rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-0.5 text-sm font-bold text-rose-300"
                : "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-0.5 text-sm font-bold text-emerald-300"
            }
          >
            {isBlock ? "⛔ BLOCK" : "⏸ WAIT"}
          </span>
        )}

        {loadState === "loading" && (
          <span className="text-muted-foreground text-xs animate-pulse">
            جاري تحميل البيانات...
          </span>
        )}
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {loadState === "error" && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300/90 text-sm">
          {fetchError}
        </div>
      )}

      {/* ── Loaded content ─────────────────────────────────────────────────── */}
      {loadState === "loaded" && decision && connState && (
        <>
          {/* Decision reasons */}
          <ul className="space-y-1">
            {decision.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                <span className="mt-0.5 shrink-0 text-amber-400/60">•</span>
                {r}
              </li>
            ))}
          </ul>

          {/* Next Action */}
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              الإجراء التالي
            </span>
            <p className="mt-0.5 text-xs text-amber-100/90">{decision.nextAction}</p>
          </div>

          {/* Market Regime */}
          {regime && (
            <div className="rounded-md border border-zinc-500/20 bg-zinc-500/[0.04] px-3 py-2.5 space-y-1.5">
              {/* Regime header row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  نظام السوق
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${REGIME_BADGE[regime.regime]}`}
                >
                  {REGIME_LABELS[regime.regime]}
                </span>
                <span className={`text-[10px] font-medium ${CONFIDENCE_BADGE[regime.confidence]}`}>
                  ثقة: {regime.confidence}
                </span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  ({regime.candleCount} شمعة M15)
                </span>
              </div>

              {/* Regime reason */}
              <p className="text-xs text-zinc-300/80">{regime.reason}</p>

              {/* News risk */}
              {regime.newsRisk && (
                <p className="text-[10px] text-amber-400/70">
                  ⚠️ XAUUSD حساس لأخبار الاقتصاد الكلي — راجع التقويم الاقتصادي قبل التحليل
                </p>
              )}

              {/* Informational disclaimer */}
              <p className="text-[10px] text-muted-foreground/50">
                التصنيف استرشادي — ليس إشارة تداول ولا توصية شراء أو بيع
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>مصدر البيانات: MT5 محلي — تنفيذ محكوم</span>
              {fetchedAt && (
                <span className="tabular-nums">
                  آخر تحديث: {fetchedAt.toLocaleTimeString("ar-SA", { hour12: false })}
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-amber-200"
              onClick={() => void load()}
            >
              تحديث
            </Button>
          </div>
        </>
      )}

      {/* MT5 Governance notice */}
      <p className="text-[10px] text-muted-foreground/50 text-left" dir="ltr">
        MT5 EXECUTION GOVERNED · التحليل والقرار قبل التنفيذ
      </p>
    </div>
  );
}
