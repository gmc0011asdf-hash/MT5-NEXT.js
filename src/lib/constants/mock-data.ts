import type { LabSignal, MonitoringRow } from "@/lib/types/trading";

export const mockSignals: LabSignal[] = [
  {
    id: "sig-001",
    pair: "EURUSD",
    verdict: "مراقبة فقط",
    probability: 0.62,
    status: "تجريبي",
    timeframe: "H1",
    reason: "بيانات وهمية للعرض — لا تنفيذ.",
    labPhase: "WAITING",
  },
  {
    id: "sig-002",
    pair: "XAUUSD",
    verdict: "لا قرار",
    probability: 0.41,
    status: "مسودة",
    timeframe: "M15",
    reason: "نموذج أولي بدون اتصال MT5.",
    labPhase: "HOLD",
  },
  {
    id: "sig-003",
    pair: "GBPUSD",
    verdict: "احتمال ضعيف",
    probability: 0.28,
    status: "قيد المراجعة",
    timeframe: "H4",
    reason: "عرض توضيحي للجدول فقط.",
    labPhase: "BLOCKED",
  },
  {
    id: "sig-004",
    pair: "USDJPY",
    verdict: "جاهز للمراجعة",
    probability: 0.78,
    status: "مؤكد",
    timeframe: "M30",
    reason: "عرض واجهة فقط — READY لا يعني تنفيذاً.",
    labPhase: "READY",
  },
];

export const mockMonitoringStatus: MonitoringRow[] = [
  {
    key: "backend",
    labelAr: "Backend",
    status: "سليم",
    detail: "وضع تجريبي — لا طلبات حية.",
  },
  {
    key: "mt5",
    labelAr: "MT5",
    status: "تحذير",
    detail: "غير متصل (متوقع في هذه النسخة).",
  },
  {
    key: "database",
    labelAr: "Database",
    status: "سليم",
    detail: "لا تكامل بعد.",
  },
  {
    key: "governance",
    labelAr: "Governance",
    status: "سليم",
    detail: "سياسات افتراضية للواجهة.",
  },
  {
    key: "protection",
    labelAr: "Protection",
    status: "سليم",
    detail: "تنفيذ معطّل عالمياً.",
  },
  {
    key: "lifecycle",
    labelAr: "Lifecycle",
    status: "غير معروف",
    detail: "لا مسار طلبات حي.",
  },
];

export const mockDecisionReport = {
  title: "تقرير القرار المؤسسي (وهمي)",
  mainReason: "لا يوجد اتصال ببيانات قرار حي — هذا ملخص عرضي للواجهة فقط.",
  supportFactors: ["اتساع النطاق التجريبي", "ثبات واجهة المستخدم"],
  blockFactors: ["عدم اتصال MT5", "عدم ربط API"],
  tradePlan: "لا توجد خطة صفقة — العرض فقط.",
  confidenceNote: "درجة الثقة هنا للعرض فقط؛ لا تُستخدم لاتخاذ قرار استثماري.",
};
