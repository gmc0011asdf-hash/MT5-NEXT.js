import type { MonitoringStatusResponse } from "@/lib/types/monitoring-api";
import type { MonitoringRow, MonitoringStatus } from "@/lib/types/trading";

function mapTriState(status: string): MonitoringStatus {
  const s = status.toLowerCase();
  if (s === "ok" || s === "active" || s === "connected") return "سليم";
  if (s === "degraded" || s === "disconnected") return "تحذير";
  if (s === "error") return "خطأ";
  return "غير معروف";
}

function mapMt5(data: MonitoringStatusResponse["mt5"]): MonitoringStatus {
  const s = data.status.toLowerCase();
  if (s === "connected") return "سليم";
  if (s === "disconnected") return "تحذير";
  return "غير معروف";
}

function governanceStatus(g: MonitoringStatusResponse["governance"]): MonitoringStatus {
  if (g.kill_switch_active === true) return "خطأ";
  const d = (g.decision ?? "").toUpperCase();
  if (d === "BLOCK") return "تحذير";
  if (d === "DELAY_REVIEW" || d === "REDUCE") return "تحذير";
  return "سليم";
}

export function mapMonitoringSnapshotToRows(data: MonitoringStatusResponse): MonitoringRow[] {
  const tables = data.database.tables;
  const tableBits = tables
    ? [
        tables.decision_runs && "decision_runs",
        tables.execution_guard_logs && "execution_guard_logs",
        tables.order_lifecycle_events && "order_lifecycle_events",
        tables.risk_state_daily && "risk_state_daily",
        tables.news_events && "news_events",
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const govParts = [
    `قرار الحوكمة: ${data.governance.decision}`,
    data.governance.kill_switch_active != null
      ? `Kill switch: ${data.governance.kill_switch_active ? "نشط" : "غير نشط"}`
      : null,
    data.governance.risk_multiplier != null ? `مضاعف المخاطرة: ${data.governance.risk_multiplier}` : null,
  ].filter(Boolean);

  const protParts = [
    `الحالة: ${data.protection.status}`,
    data.protection.news_events_count != null ? `أخبار مسجّلة: ${data.protection.news_events_count}` : null,
    data.protection.high_impact_now != null ? `تأثير عالٍ الآن: ${data.protection.high_impact_now}` : null,
  ].filter(Boolean);

  const exec = data.execution;
  const lifecycleCount = exec.last_lifecycle_events?.length ?? 0;
  const guardCount = exec.last_guard_events?.length ?? 0;
  const execDetail = [
    `التنفيذ المعلق: ${exec.pending_execution_enabled ? "مفعّل" : "معطّل"}`,
    exec.live_order_execution_enabled != null
      ? `التنفيذ الحي: ${exec.live_order_execution_enabled ? "مفعّل" : "معطّل"}`
      : null,
    `أحداث الحارس الأخيرة: ${guardCount} — أحداث دورة الحياة: ${lifecycleCount}`,
  ]
    .filter(Boolean)
    .join(" — ");

  return [
    {
      key: "backend",
      labelAr: "Backend",
      status: mapTriState(data.backend.status),
      detail: `UTC: ${data.backend.server_time_utc}${data.backend.version ? ` — الإصدار: ${data.backend.version}` : ""}`,
    },
    {
      key: "mt5",
      labelAr: "MT5",
      status: mapMt5(data.mt5),
      detail: `${data.mt5.status} — المصدر: ${data.mt5.source}${data.mt5.account_login != null ? ` — تسجيل الدخول: ${data.mt5.account_login}` : ""}`,
    },
    {
      key: "database",
      labelAr: "Database",
      status: mapTriState(data.database.status),
      detail: tableBits ? `جداول مكتشفة: ${tableBits}` : `حالة المخطط: ${data.database.status}`,
    },
    {
      key: "governance",
      labelAr: "Governance",
      status: governanceStatus(data.governance),
      detail: govParts.join(" — "),
    },
    {
      key: "protection",
      labelAr: "Protection",
      status: mapTriState(data.protection.status),
      detail: protParts.join(" — "),
    },
    {
      key: "lifecycle",
      labelAr: "Lifecycle",
      status: exec.pending_execution_enabled ? "تحذير" : "سليم",
      detail: execDetail,
    },
  ];
}
