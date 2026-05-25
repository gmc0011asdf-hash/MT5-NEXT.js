# Gold Pro Lab — مختبر تحليل الذهب المؤسسي
## وثيقة التصميم الكاملة

**التاريخ:** 2026-05-25  
**المرحلة:** Gold Pro Lab  
**الحالة:** معتمد — جاهز للتنفيذ  
**المسار:** `/lab/gold-pro` (صفحة جديدة مستقلة)

---

## 1. الهدف

بناء مختبر تحليل ذهب مؤسسي يعمل بالبيانات المباشرة من MT5 Bridge، يحسب تلقائياً:
- اتجاه السوق عبر 4 إطارات زمنية
- نقاط الدخول والخروج المثلى
- Stop Loss و Take Profit مبنيان على ATR الفعلي
- حجم الصفقة المناسب لـ 2% مخاطرة
- توصية نهائية (BUY / SELL / WAIT) مع نسبة ثقة
- حفظ التوصيات في Convex لقياس الدقة مع مرور الوقت

**ملاحظة:** النظام للأغراض التحليلية المعلوماتية فقط — ليس توصية مالية.

---

## 2. المعمارية — Hybrid Architecture

```
MT5 Bridge (FastAPI :8010)
    │
    ▼
Next.js API Routes (/api/lab/gold-pro/*)
    │
    ▼
Analysis Engine (TypeScript — Client-side)
    ├── fetchCandles(M15, H1, H4, D1)
    ├── fetchTick(XAUUSD)
    ├── calculateIndicators()
    └── generateSignal()
    │
    ├──▶ UI عرض فوري (React State)
    └──▶ Convex mutation — حفظ snapshot
```

**السبب:** الحسابات في المتصفح (سرعة فورية) + الحفظ في Convex (تاريخ قابل للقياس).

---

## 3. أقسام الواجهة — Layout C المعتمد

### القسم 1 — الشريط العلوي (3 بطاقات)
| البطاقة | المحتوى |
|---|---|
| السعر الحي | BID/ASK · Spread · Session · News Warning |
| Confluence Score | رقم 0-100 · Progress bar · تصنيف نصي |
| التوصية النهائية | BUY/SELL/WAIT · Entry · SL · TP1 · TP2 · R/R |

### القسم 2 — إدارة المخاطر + MTF (بطاقتان)
| البطاقة | المحتوى |
|---|---|
| Position Sizing | الرصيد · 2% مخاطرة · ATR · Lot محسوب · P&L متوقع |
| MTF Analysis | M15/H1/H4/D1 اتجاه كل منهم · ADX strength |

### القسم 3 — المؤشرات التفصيلية (3 بطاقات)
| البطاقة | المحتوى |
|---|---|
| مؤشرات الاتجاه | EMA 21/50/200 · MACD · ADX |
| الزخم والتقلب | RSI · Stoch RSI · ATR · Bollinger Bands |
| دعم/مقاومة | Fibonacci 38.2/61.8 · Pivot Points · مستويات S/R |

### القسم 4 — Pivot Points + سجل التوصيات (بطاقتان)
| البطاقة | المحتوى |
|---|---|
| Pivot Points | R2/R1/PP/S1/S2 يومية وأسبوعية |
| سجل التوصيات | آخر 10 توصيات · الحالة · دقة إجمالية % |

---

## 4. محرك التحليل — Analysis Engine

### 4.1 المؤشرات المحسوبة (10 مؤشرات)

```typescript
interface GoldAnalysis {
  // Trend
  ema21: number;
  ema50: number;
  ema200: number;
  macd: { value: number; signal: number; histogram: number };
  adx: { value: number; diPlus: number; diMinus: number };

  // Momentum
  rsi: number;
  stochRsi: { k: number; d: number }; // Stoch(RSI,3,3,14,14) — Chande & Kroll 1994

  // Volatility
  atr: number;
  bollingerBands: { upper: number; middle: number; lower: number; width: number };

  // Levels
  pivotPoints: { r2: number; r1: number; pp: number; s1: number; s2: number };
  fibonacci: { level382: number; level618: number; level786: number };
  supportResistance: { supports: number[]; resistances: number[] };
}
```

### 4.2 حساب EMA

```typescript
function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}
```

### 4.3 حساب RSI

```typescript
function calculateRSI(prices: number[], period = 14): number[] {
  // Wilder's Smoothing Method
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => Math.max(c, 0));
  const losses = changes.map(c => Math.max(-c, 0));
  // Wilder smoothing (not simple average)
  ...
}
```

### 4.4 حساب ATR (Wilder)

```typescript
function calculateATR(candles: Candle[], period = 14): number {
  const trueRanges = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
  });
  // Wilder smoothing
  return wilderSmooth(trueRanges, period);
}
```

### 4.5 حساب MACD

```typescript
// MACD = EMA(12) - EMA(26)
// Signal = EMA(9) of MACD
// Histogram = MACD - Signal
function calculateMACD(prices: number[]) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calculateEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return { macdLine, signal, histogram };
}
```

### 4.6 حساب Bollinger Bands

```typescript
// BB(20, 2σ) — المعيار العالمي
function calculateBB(prices: number[], period = 20, stdDev = 2) {
  const sma = prices.slice(-period).reduce((a, b) => a + b) / period;
  const variance = prices.slice(-period).reduce((sum, p) =>
    sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: sma + stdDev * std, middle: sma, lower: sma - stdDev * std };
}
```

### 4.7 حساب ADX

```typescript
// ADX(14) — Wilder's Directional Movement Index
// ADX > 25 = اتجاه قوي
// ADX > 40 = اتجاه قوي جداً
// ADX < 20 = سوق جانبي — تجنب الإشارات
```

### 4.8 Pivot Points (Floor Method)

```typescript
function calculatePivots(high: number, low: number, close: number) {
  const pp = (high + low + close) / 3;
  return {
    r2: pp + (high - low),
    r1: 2 * pp - low,
    pp,
    s1: 2 * pp - high,
    s2: pp - (high - low),
  };
}
```

### 4.9 Fibonacci Retracement

```typescript
// Swing High = أعلى سعر في آخر 20 شمعة H4
// Swing Low  = أدنى سعر في آخر 20 شمعة H4
function calculateFibonacci(swingHigh: number, swingLow: number) {
  const range = swingHigh - swingLow;
  return {
    level236: swingHigh - range * 0.236,
    level382: swingHigh - range * 0.382,
    level500: swingHigh - range * 0.500,
    level618: swingHigh - range * 0.618,
    level786: swingHigh - range * 0.786,
  };
}
```

---

## 5. نظام التوصية — Signal Engine

### 5.1 Confluence Score (0-100)

| المكوّن | الوزن | شرط BUY | شرط SELL |
|---|---|---|---|
| EMA21 > EMA50 | 10 | ✓ | ✗ |
| EMA50 > EMA200 | 10 | ✓ | ✗ |
| MACD Histogram > 0 | 15 | ✓ | ✗ |
| RSI 40-70 (منطقة آمنة) | 10 | ✓ | ✓ |
| RSI > 50 | 10 | ✓ | ✗ |
| ADX > 25 (اتجاه قوي) | 10 | ✓ | ✓ |
| السعر > BB Middle | 10 | ✓ | ✗ |
| MTF توافق 3/4 | 15 | ✓ | ✗ |
| Session مناسبة | 5 | ✓ | ✓ |
| لا أخبار خلال 2h | 5 | ✓ | ✓ |
| **المجموع** | **100** | | |

### 5.2 قرار التوصية

```typescript
function generateSignal(score: number): 'BUY' | 'SELL' | 'WAIT' {
  if (score >= 70) return 'BUY';
  if (score <= 30) return 'SELL';
  return 'WAIT'; // 31-69 = انتظر
}
```

### 5.3 حساب SL/TP (ATR-Based)

```typescript
function calculateSLTP(
  entryPrice: number,
  atr: number,
  signal: 'BUY' | 'SELL'
) {
  const slMultiplier = 1.5;  // SL = 1.5× ATR
  const tp1Multiplier = 2.0; // TP1 = 2.0× ATR (RR = 1:1.33)
  const tp2Multiplier = 3.0; // TP2 = 3.0× ATR (RR = 1:2.0)

  if (signal === 'BUY') {
    return {
      sl: entryPrice - atr * slMultiplier,
      tp1: entryPrice + atr * tp1Multiplier,
      tp2: entryPrice + atr * tp2Multiplier,
      rr: tp1Multiplier / slMultiplier, // 1.33
    };
  }
  // SELL: معكوس
}
```

### 5.4 Position Sizing (2% Rule)

```typescript
function calculateLotSize(
  balance: number,
  slPoints: number,
  riskPercent = 0.02
) {
  const riskAmount = balance * riskPercent;     // $66.92
  const tickValue = 0.1;                         // $0.1 per point per 0.01 lot
  const lotSize = riskAmount / (slPoints * tickValue * 100);
  return Math.floor(lotSize * 100) / 100;        // تقريب لأسفل
}
```

---

## 6. Convex Schema — جدول جديد

```typescript
// في convex/schema.ts — يُضاف بمرحلة صريحة
goldProAnalysis: defineTable({
  userId: v.string(),
  timestamp: v.number(),
  symbol: v.string(),                    // "XAUUSD"
  price: v.number(),                     // السعر وقت التحليل
  signal: v.union(
    v.literal("BUY"),
    v.literal("SELL"),
    v.literal("WAIT")
  ),
  confluenceScore: v.number(),           // 0-100
  confidence: v.number(),                // نفس الـ score
  entryPrice: v.number(),
  stopLoss: v.number(),
  takeProfit1: v.number(),
  takeProfit2: v.number(),
  rrRatio: v.number(),
  lotSize: v.number(),
  atr: v.number(),
  timeframe: v.string(),                 // "H1"
  mtfAlignment: v.number(),             // عدد الإطارات المتوافقة
  indicators: v.object({
    ema21: v.number(),
    ema50: v.number(),
    ema200: v.number(),
    rsi: v.number(),
    macd: v.number(),
    adx: v.number(),
    bbPosition: v.string(),             // "above" | "below" | "middle"
  }),
  outcome: v.optional(v.union(
    v.literal("win"),
    v.literal("loss"),
    v.literal("pending")
  )),
  outcomePrice: v.optional(v.number()),
})
.index("by_user", ["userId"])
.index("by_user_timestamp", ["userId", "timestamp"]),
```

---

## 7. API Routes الجديدة

```
GET /api/lab/gold-pro/analysis
  → يجلب: ticks + candles (M15/H1/H4/D1) من MT5 Bridge
  → يرجع: raw data فقط

POST /api/lab/gold-pro/save-snapshot
  → يستقبل: نتيجة التحليل
  → يحفظ في Convex عبر server-side mutation
  → يرجع: snapshot ID
```

---

## 8. هيكل الملفات

```
src/
├── app/
│   ├── (dashboard)/
│   │   └── lab/
│   │       └── gold-pro/
│   │           └── page.tsx              ← الصفحة الرئيسية (جديدة)
│   └── api/
│       └── lab/
│           └── gold-pro/
│               ├── analysis/
│               │   └── route.ts          ← جلب البيانات من Bridge
│               └── save-snapshot/
│                   └── route.ts          ← حفظ في Convex
├── lib/
│   └── gold-pro/
│       ├── analysis-engine.ts            ← محرك الحسابات الكاملة
│       ├── indicators.ts                 ← EMA/RSI/ATR/MACD/BB/ADX/Fib/Pivot
│       ├── signal-engine.ts              ← Confluence Score + توصية
│       ├── position-sizing.ts            ← حساب Lot + SL/TP
│       └── types.ts                      ← GoldAnalysis, Signal, Candle...
└── components/
    └── gold-pro/
        ├── GoldProLab.tsx                ← المكوّن الرئيسي
        ├── PriceHeader.tsx               ← السعر الحي + Session
        ├── ConfluenceScore.tsx           ← الرقم + Progress
        ├── SignalCard.tsx                ← التوصية + SL/TP
        ├── PositionSizing.tsx            ← إدارة المخاطر
        ├── MTFPanel.tsx                  ← تحليل الإطارات
        ├── IndicatorsPanel.tsx           ← المؤشرات التفصيلية
        ├── SupportResistance.tsx         ← دعم/مقاومة/فيبوناتشي
        ├── PivotPoints.tsx               ← Pivot Points
        └── AnalysisHistory.tsx           ← سجل التوصيات
```

---

## 9. Convex Functions

```
convex/
└── goldProAnalysis.ts
    ├── saveAnalysis (mutation)      ← حفظ snapshot جديد
    ├── getMyAnalyses (query)        ← آخر 20 تحليل للمستخدم
    ├── updateOutcome (mutation)     ← تحديث نتيجة الصفقة (win/loss)
    └── getAccuracyStats (query)     ← إحصاءات الدقة الإجمالية
```

---

## 10. قواعد السلامة المطبّقة

| القاعدة | التطبيق |
|---|---|
| Read-only | لا يوجد أي order_send أو تنفيذ |
| ليس توصية مالية | disclaimer ثابت في كل صفحة |
| Auth | كل mutation تستخدم ctx.auth.getUserIdentity() |
| لا userId من الواجهة | userId يُستخرج server-side فقط |
| Convex Schema | يُضاف بمرحلة صريحة + codegen |

---

## 11. مراحل التنفيذ

| المرحلة | الوصف | الأولوية |
|---|---|---|
| **P1** | `lib/gold-pro/indicators.ts` — كل حسابات المؤشرات | عالية |
| **P2** | `lib/gold-pro/signal-engine.ts` — Confluence + توصية | عالية |
| **P3** | `lib/gold-pro/position-sizing.ts` — Lot + SL/TP | عالية |
| **P4** | `/api/lab/gold-pro/analysis/route.ts` — جلب البيانات | عالية |
| **P5** | `components/gold-pro/*` — كل مكوّنات UI | متوسطة |
| **P6** | `app/lab/gold-pro/page.tsx` — تجميع الصفحة | متوسطة |
| **P7** | `convex/schema.ts` — إضافة goldProAnalysis table | متوسطة |
| **P8** | `convex/goldProAnalysis.ts` — mutations + queries | متوسطة |
| **P9** | `AnalysisHistory.tsx` — سجل التوصيات + دقة | منخفضة |
| **P10** | Navigation link + تحديث PROJECT_CONTEXT.md | منخفضة |

---

## 12. معايير الإتمام

```
[ ] pnpm exec tsc --noEmit → zero errors
[ ] pnpm build → successful
[ ] Confluence Score يحسب صحيحاً على بيانات حية
[ ] SL/TP = 1.5× ATR و 2×/3× ATR
[ ] Lot size = (balance × 2%) / (SL_points × tick_value)
[ ] R/R لا يقل عن 1:1.3 للقبول
[ ] Disclaimer ظاهر في الصفحة
[ ] لا order_send في أي ملف
[ ] Auth مطبّق على كل mutation
[ ] RTL محترم في كل مكوّن
```

---

*وثيقة التصميم معتمدة — 2026-05-25 — نظام الملك الهندسي للتداول العالمي*
