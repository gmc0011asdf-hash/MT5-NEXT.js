"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "@/lib/constants/navigation";

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-amber-500/10 bg-sidebar/95 text-sidebar-foreground backdrop-blur-sm">
      <div className="border-b border-amber-500/10 px-4 py-4">
        <p className="font-medium text-amber-100/90 text-sm">التنقل</p>
        <p className="mt-0.5 text-muted-foreground text-xs">واجهة مؤسسية</p>
      </div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-2 font-medium text-[11px] text-amber-200/70 uppercase tracking-wide">
              {section.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-xl border border-transparent px-3 py-2 text-sm transition-colors",
                      active
                        ? "border-amber-500/20 bg-amber-500/10 text-amber-50"
                        : "hover:border-amber-500/10 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-amber-500/10 px-4 py-3">
        <p className="text-muted-foreground text-[10px] leading-relaxed">
          Next UI · Read-only · Demo
        </p>
      </div>
    </aside>
  );
}
