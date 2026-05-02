import { AlertCircle, CheckCircle2, Circle, XCircle } from "lucide-react";

type ServiceStatus = "healthy" | "placeholder" | "disabled" | "unknown";

interface ServiceCard {
  name: string;
  nameAr: string;
  status: ServiceStatus;
  note: string;
}

const SERVICES: ServiceCard[] = [
  {
    name: "MT5 Read-only Bridge",
    nameAr: "جسر MT5 (قراءة فقط)",
    status: "healthy",
    note: "متصل — وضع القراءة فقط. لا يُنفّذ تداول.",
  },
  {
    name: "OKX Connector",
    nameAr: "موصّل OKX",
    status: "placeholder",
    note: "غير مفعّل — عنصر نائب للمرحلة القادمة.",
  },
  {
    name: "Convex Database",
    nameAr: "قاعدة بيانات Convex",
    status: "healthy",
    note: "متصل — يعمل بشكل طبيعي.",
  },
  {
    name: "Clerk Auth",
    nameAr: "مصادقة Clerk",
    status: "healthy",
    note: "مفعّل — نظام المصادقة يعمل.",
  },
  {
    name: "Telegram Notifications",
    nameAr: "إشعارات Telegram",
    status: "placeholder",
    note: "غير مفعّل — سيتم الربط لاحقاً.",
  },
  {
    name: "News Provider",
    nameAr: "مزوّد الأخبار",
    status: "placeholder",
    note: "غير مفعّل — سيتم الربط لاحقاً.",
  },
  {
    name: "Scheduler",
    nameAr: "المجدوِل",
    status: "placeholder",
    note: "غير مفعّل — سيتم الربط لاحقاً.",
  },
  {
    name: "Trading Execution",
    nameAr: "تنفيذ التداول",
    status: "disabled",
    note: "مُعطَّل عمداً — النظام في وضع العرض فقط.",
  },
];

function StatusBadge({ status }: { status: ServiceStatus }) {
  if (status === "healthy") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        يعمل
      </span>
    );
  }
  if (status === "placeholder") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
        <Circle className="h-3.5 w-3.5" />
        Placeholder
      </span>
    );
  }
  if (status === "disabled") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
        <XCircle className="h-3.5 w-3.5" />
        مُعطَّل
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <Circle className="h-3.5 w-3.5" />
      غير معروف
    </span>
  );
}

export default function SystemHealthPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-amber-500">
          مركز صحة النظام
        </h1>
        <p className="text-muted-foreground">
          مراقبة حالة الخدمات الأساسية
        </p>
      </div>

      {/* Read-only banner */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Read-only / لا يوجد تنفيذ تداول</p>
          <p className="opacity-80">
            هذه الشاشة للمراقبة فقط. الحالات الموضحة هي بيانات ثابتة (Placeholder) ولا تعكس API حقيقياً في هذه المرحلة.
          </p>
        </div>
      </div>

      {/* Service cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SERVICES.map((svc) => (
          <div
            key={svc.name}
            className="rounded-xl border border-border bg-card p-5 shadow flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground leading-tight">
                  {svc.nameAr}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {svc.name}
                </p>
              </div>
              <StatusBadge status={svc.status} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
              {svc.note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
