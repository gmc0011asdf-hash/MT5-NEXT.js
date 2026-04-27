"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "@/lib/constants/navigation";

const STORAGE_KEY = "mt5_sidebar_collapsed";

export function AppSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "true") setCollapsed(true);
    } catch {
      // ignore
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed, storageReady]);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-l border-amber-500/10 bg-sidebar/95 text-sidebar-foreground backdrop-blur-sm",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-[4.5rem] max-md:max-w-[4.5rem]" : "w-64 max-md:w-56",
      )}
    >
      <div className="flex min-h-14 items-center gap-1 border-b border-amber-500/10 px-1.5 py-2.5 sm:px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => setCollapsed((c) => !c)}
          aria-pressed={collapsed}
          aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
        >
          {collapsed ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
        </Button>
        <div
          className={cn("min-w-0 flex-1", collapsed && "sr-only md:sr-only")}
          aria-hidden={collapsed}
        >
          <p className="font-medium text-amber-100/90 text-sm">التنقل</p>
          <p className="mt-0.5 text-muted-foreground text-xs">واجهة مؤسسية</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p
              className={cn(
                "mb-1.5 px-2 font-medium text-[11px] text-amber-200/70 uppercase tracking-wide",
                collapsed && "sr-only",
              )}
            >
              {section.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                const linkClass = cn(
                  "min-h-10 items-center gap-2 rounded-xl border text-sm transition-colors",
                  collapsed ? "justify-center px-2" : "px-3 py-2",
                  active
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-50 ring-1 ring-amber-500/20"
                    : "border-transparent hover:border-amber-500/10 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                );

                if (collapsed) {
                  return (
                    <Tooltip key={item.href}>
                      <TooltipTrigger
                        render={(htmlProps) => (
                          <Link
                            {...htmlProps}
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={cn("flex w-full", linkClass, htmlProps.className)}
                          >
                            <Icon className="size-4 shrink-0" aria-hidden />
                          </Link>
                        )}
                      />
                      <TooltipContent side="left" align="center" className="text-xs">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      className={cn("flex w-full", linkClass)}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-amber-500/10 px-2 py-2.5 sm:px-3">
        <p
          className={cn(
            "text-muted-foreground text-[10px] leading-relaxed",
            collapsed && "sr-only",
          )}
        >
          Next UI · Read-only · Demo
        </p>
      </div>
    </aside>
  );
}
