"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";

import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/lib/constants/navigation";
import { useMt5ConnectionStatus } from "@/lib/hooks/use-mt5-connection-status";

export function AppSidebar() {
  const pathname = usePathname();
  const { status } = useMt5ConnectionStatus();
  const mt5Connected = status?.connected === true;

  return (
    <aside
      className="sticky top-0 flex h-dvh w-72 min-w-72 max-w-72 shrink-0 flex-col overflow-y-auto border-l border-amber-500/10 bg-black/20 px-4 py-4 text-sidebar-foreground backdrop-blur-sm"
    >
      <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3.5">
        <p className="text-stone-100 text-base font-semibold leading-tight">نظام الملك الهندسي</p>
        <p className="mt-1 text-stone-400 text-sm leading-tight">للتداول العالمي</p>
        <Badge variant="outline" className="mt-2.5 border-amber-500/20 bg-amber-500/10 text-amber-100">
          MT5 Read-only
        </Badge>
      </div>

      <div className="mt-3 rounded-xl border border-amber-500/15 bg-white/[0.03] p-3.5">
        <p className="text-stone-100 text-sm font-semibold">حالة النظام</p>
        <div className="mt-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-stone-400">MT5</span>
            <Badge
              variant="outline"
              className={mt5Connected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"}
            >
              {mt5Connected ? "متصل" : "غير متصل"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-stone-400">البيانات</span>
            <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-100">
              {mt5Connected ? "حقيقية من MT5" : "بانتظار الاتصال"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-stone-400">الوضع</span>
            <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-100">
              قراءة فقط
            </Badge>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-1 min-h-0 flex-col">
        <p className="px-1 text-stone-300 text-sm font-semibold">التنقل</p>
        <nav className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-amber-400/20 bg-amber-500/15 text-amber-100"
                    : "border-transparent text-stone-300 hover:bg-white/5 hover:text-stone-100",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate whitespace-nowrap text-start font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-2 border-t border-amber-500/10 pt-3">
        <p className="text-stone-400 text-xs leading-relaxed">
          MT5 الحقيقي
          <br />
          قراءة فقط
        </p>
      </div>
    </aside>
  );
}
