"use client";

import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

type Mt5EmptyStateReason = "disconnected" | "not_synced" | "no_data";

const CONFIG: Record<
  Mt5EmptyStateReason,
  { icon: React.ElementType; iconClass: string; title: string; body: string }
> = {
  disconnected: {
    icon: WifiOff,
    iconClass: "text-rose-400/80",
    title: "MT5 غير متصل",
    body: "افتح منصة MT5 وشغّل خدمة القراءة المحلية على المنفذ 8010.",
  },
  not_synced: {
    icon: RefreshCw,
    iconClass: "text-amber-400/80",
    title: "لم تتم المزامنة بعد",
    body: "MT5 متصل لكن لم يتم جلب البيانات — اضغط مزامنة MT5 المحلي للتحليل.",
  },
  no_data: {
    icon: AlertTriangle,
    iconClass: "text-stone-400/70",
    title: "لا توجد بيانات في الفترة المحددة",
    body: "جرّب توسيع نطاق التاريخ أو التحقق من الرمز المطلوب.",
  },
};

type Mt5EmptyStateProps = {
  reason: Mt5EmptyStateReason;
  className?: string;
};

export function Mt5EmptyState({ reason, className }: Mt5EmptyStateProps) {
  const { icon: Icon, iconClass, title, body } = CONFIG[reason];
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-muted/10 px-4 py-6 text-center",
        className,
      )}
    >
      <Icon className={cn("size-6 shrink-0", iconClass)} aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
