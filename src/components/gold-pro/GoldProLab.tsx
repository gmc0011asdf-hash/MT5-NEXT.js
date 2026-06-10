// src/components/gold-pro/GoldProLab.tsx
"use client";

import { useState, useCallback } from "react";
import type { GoldProAnalysis, RawCandle } from "@/lib/gold-pro/types";
import {
  lastEMA, lastRSI, calculateATR, calculateMACD,
  calculateBollingerBands, calculateADX, calculateStochRSI,
  calculatePivotPoints, calculateFibonacci, calculateSupportResistance,
} from "@/lib/gold-pro/indicators";
import { calculateConfluence, detectSession } from "@/lib/gold-pro/confluence-engine";
import { calculateSLTP, calculatePositionSize } from "@/lib/gold-pro/position-sizing";
import { generateTradeSetups } from "@/lib/gold-pro/trade-setups";
import { PriceHeader } from "./PriceHeader";
import { ConfluenceScoreCard } from "./ConfluenceScore";
import { SignalCard } from "./SignalCard";
import { PositionSizingPanel } from "./PositionSizingPanel";
import { MTFPanel } from "./MTFPanel";
import { IndicatorsPanel } from "./IndicatorsPanel";
import { SupportResistancePanel } from "./SupportResistancePanel";
import { PivotPointsPanel } from "./PivotPointsPanel";
import { TradeSetupsPanel } from "./TradeSetupsPanel";
import { HistorySection } from "./HistorySection";
import { ConvexSafeWrapper } from "./ConvexSafeWrapper";
import { ManualTradeAlert } from "./ManualTradeAlert";
import { OpenPositionsPanel } from "./OpenPositionsPanel";

export function GoldProLab() {
  const [analysis, setAnalysis] = useState<GoldProAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lab/gold-pro/analysis");
      if (!res.ok) throw new Error("فشل جلب البيانات من MT5 Bridge");
      const data = await res.json();
      if (!data.connected || !data.tick) throw new Error("MT5 Bridge غير متصل");

      const { tick, candlesH1, candlesH4, candlesD1, candlesM15, account } = data;
      const currentPrice = tick.ask as number;
      const balance = account?.balance ?? 3000;

      // --- حساب المؤشرات على H1 --------------------------------------------
      const ema21 = lastEMA(candlesH1 as RawCandle[], 21);
      const ema50 = lastEMA(candlesH1 as RawCandle[], 50);
      const ema200 = lastEMA(candlesH1 as RawCandle[], 200);
      const rsi = lastRSI(candlesH1 as RawCandle[], 14);
      // ATR fallback: إذا لم تكن بيانات H1 كافية، نستخدم H4 ATR / 2.5 أو الافتراضي
      const atrH1Raw = calculateATR(candlesH1 as RawCandle[], 14);
      const atrH4Raw = calculateATR(candlesH4 as RawCandle[], 14);
      const atr = atrH1Raw > 0 ? atrH1Raw : atrH4Raw > 0 ? Math.round(atrH4Raw / 2.5 * 100) / 100 : 8.0;
      const macd = calculateMACD(candlesH1 as RawCandle[]);
      const bb = calculateBollingerBands(candlesH1 as RawCandle[], 20);
      const adx = calculateADX(candlesH1 as RawCandle[], 14);
      const stochRsi = calculateStochRSI(candlesH1 as RawCandle[]);
      const pivots = calculatePivotPoints(candlesD1 as RawCandle[]);
      const fib = calculateFibonacci(candlesH4 as RawCandle[]);
      const sr = calculateSupportResistance(candlesH1 as RawCandle[], currentPrice);

      // --- MTF -------------------------------------------------------------
      const makeTF = (candles: RawCandle[], tf: "M15" | "H1" | "H4" | "D1") => {
        const e21 = lastEMA(candles, 21);
        const e50 = lastEMA(candles, 50);
        const e200 = lastEMA(candles, 200);
        const r = lastRSI(candles, 14);
        const bias = e21 > e50 && r > 50 ? "bullish" as const :
                     e21 < e50 && r < 50 ? "bearish" as const : "neutral" as const;
        return { timeframe: tf, bias, rsi: r, emaFastAboveSlow: e21 > e50, aboveEma200: currentPrice > e200 };
      };
      const mtfM15 = makeTF(candlesM15 as RawCandle[], "M15");
      const mtfH1  = makeTF(candlesH1 as RawCandle[],  "H1");
      const mtfH4  = makeTF(candlesH4 as RawCandle[],  "H4");
      const mtfD1  = makeTF(candlesD1 as RawCandle[],  "D1");
      const bullishCount = [mtfM15, mtfH1, mtfH4, mtfD1].filter(t => t.bias === "bullish").length;
      const mtf = { m15: mtfM15, h1: mtfH1, h4: mtfH4, d1: mtfD1, bullishCount, alignment: bullishCount * 25 };

      // --- Session ---------------------------------------------------------
      const utcHour = new Date().getUTCHours();
      const session = detectSession(utcHour);

      // --- Confluence -------------------------------------------------------
      const confluence = calculateConfluence({
        indicators: { ema21, ema50, ema200, macd, adx, rsi, stochRsi, atr, bollingerBands: bb, pivotPoints: pivots, fibonacci: fib, supportResistance: sr },
        mtf,
        currentPrice,
        sessionOk: session.ok,
        newsRisk: false, // مرحلة مستقبلية
      });

      // --- SL/TP + Position Size --------------------------------------------
      const sltp = calculateSLTP(currentPrice, atr, confluence.signal);
      const positioning = calculatePositionSize(balance, sltp.slDistance);

      // --- الصفقات المتعددة (H4 Swing + H1 Intraday + M15 Scalp) ----------
      const tradeSetups = generateTradeSetups(
        currentPrice,
        balance,
        candlesM15 as RawCandle[],
        candlesH1  as RawCandle[],
        candlesH4  as RawCandle[],
        session.ok,
      );

      // عدد الشموع المستلمة من API
      const candleCount = data.candleCount ?? {
        H1: (candlesH1 as RawCandle[]).length,
        H4: (candlesH4 as RawCandle[]).length,
        D1: (candlesD1 as RawCandle[]).length,
        M15: (candlesM15 as RawCandle[]).length,
      };

      setAnalysis({
        timestamp: Date.now(),
        symbol: "XAUUSD",
        price: currentPrice,
        bid: tick.bid,
        ask: tick.ask,
        spread: tick.spread_points,
        marketClosed: tick.market_closed,
        sessionLabel: session.label,
        indicators: { ema21, ema50, ema200, macd, adx, rsi, stochRsi, atr, bollingerBands: bb, pivotPoints: pivots, fibonacci: fib, supportResistance: sr },
        mtf,
        confluence,
        sltp,
        positioning,
        dataQuality: (candlesH1 as RawCandle[]).length >= 50 ? "good" : "partial",
        tradeSetups,
        candleCount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSnapshot = useCallback(async () => {
    if (!analysis || saving) return;
    setSaving(true);
    try {
      await fetch("/api/lab/gold-pro/save-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: analysis.symbol,
          timestamp: analysis.timestamp,
          price: analysis.price,
          signal: analysis.confluence.signal,
          confluenceScore: analysis.confluence.score,
          entryPrice: analysis.sltp.entryPrice,
          stopLoss: analysis.sltp.stopLoss,
          takeProfit1: analysis.sltp.takeProfit1,
          takeProfit2: analysis.sltp.takeProfit2,
          rrRatio: analysis.sltp.rrRatio1,
          lotSize: analysis.positioning.lotSize,
          atr: analysis.indicators.atr,
          mtfAlignment: analysis.mtf.bullishCount,
          indicators: {
            ema21: analysis.indicators.ema21,
            ema50: analysis.indicators.ema50,
            ema200: analysis.indicators.ema200,
            rsi: analysis.indicators.rsi,
            macd: analysis.indicators.macd.value,
            adx: analysis.indicators.adx.adx,
            bbPosition: analysis.indicators.bollingerBands.position,
          },
        }),
      });
    } finally {
      setSaving(false);
    }
  }, [analysis, saving]);

  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-amber-400">🏆 Gold Pro Lab</h1>
          <p className="text-xs text-slate-400">مختبر تحليل الذهب المؤسسي — للأغراض التحليلية المعلوماتية فقط</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="rounded-lg bg-amber-500 px-6 py-2 font-bold text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? "⏳ جاري التحليل..." : "⚡ تحليل الآن"}
          </button>
          {analysis && (
            <button
              onClick={saveSnapshot}
              disabled={saving}
              className="rounded-lg border border-indigo-500 px-4 py-2 text-indigo-400 hover:bg-indigo-950 disabled:opacity-50"
            >
              {saving ? "💾..." : "💾 حفظ"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {!analysis && !loading && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-12 text-center text-slate-400">
          <div className="mb-2 text-4xl">📊</div>
          <p>اضغط &quot;تحليل الآن&quot; لبدء تحليل XAUUSD من البيانات المباشرة</p>
        </div>
      )}

      {analysis && (
        <>
          {/* Row 0-A: Manual Trade Alert — يظهر فقط عند Score ≥ 70 */}
          <ManualTradeAlert analysis={analysis} />

          {/* Row 0-B: Multi-Trade Setups — الصفقات المقترحة */}
          <TradeSetupsPanel
            setups={analysis.tradeSetups}
            candleCount={analysis.candleCount}
          />

          {/* Row 1: Price + Confluence + Signal */}
          <div className="grid grid-cols-3 gap-4">
            <PriceHeader analysis={analysis} />
            <ConfluenceScoreCard confluence={analysis.confluence} />
            <SignalCard analysis={analysis} />
          </div>

          {/* Row 2: Position Sizing + MTF */}
          <div className="grid grid-cols-2 gap-4">
            <PositionSizingPanel analysis={analysis} />
            <MTFPanel mtf={analysis.mtf} adx={analysis.indicators.adx} />
          </div>

          {/* Row 3: Indicators */}
          <div className="grid grid-cols-3 gap-4">
            <IndicatorsPanel analysis={analysis} />
            <SupportResistancePanel analysis={analysis} />
            <PivotPointsPanel pivots={analysis.indicators.pivotPoints} currentPrice={analysis.price} />
          </div>

          {/* Row 5: Open Positions — Live polling كل 5 ثوانٍ */}
          <OpenPositionsPanel />

          {/* Row 6: History — معزول بـ Error Boundary حماية من أخطاء Convex */}
          <ConvexSafeWrapper>
            <HistorySection />
          </ConvexSafeWrapper>
        </>
      )}

      <p className="text-center text-xs text-slate-600">
        ⚠️ للأغراض التحليلية المعلوماتية فقط — ليس توصية مالية — نظام الملك الهندسي للتداول العالمي
      </p>
    </div>
  );
}
