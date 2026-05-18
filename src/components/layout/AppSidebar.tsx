"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "@/lib/constants/navigation";

// Routes that are development-only tools. Hidden in production builds.
const DEV_ONLY_HREFS = new Set(["/convex-core", "/convex-test"]);
const IS_DEV = process.env.NODE_ENV === "development";

function filterDevItems<T extends { href: string }>(items: T[]): T[] {
  if (IS_DEV) return items;
  return items.filter((item) => !DEV_ONLY_HREFS.has(item.href));
}

function groupContainsPath(items: { href: string }[], pathname: string) {
  return items.some(
    (item) =>
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href)),
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  const visibleGroups = NAV_GROUPS.flatMap((group) => {
    const items = filterDevItems(group.items);
    return items.length > 0 ? [{ ...group, items }] : [];
  });

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of visibleGroups) {
      initial[group.id] = groupContainsPath(group.items, pathname);
    }
    return initial;
  });

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const group of visibleGroups) {
        if (groupContainsPath(group.items, pathname)) {
          next[group.id] = true;
        }
      }
      return next;
    });
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside
      dir="rtl"
      className="fixed top-0 right-0 z-40 flex h-dvh w-72 min-w-72 max-w-72 flex-col overflow-hidden border-l border-amber-500/10 bg-black/20 backdrop-blur-sm"
    >
      {/* Navigation label */}
      <div className="shrink-0 px-5 pt-5 pb-1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
          التنقل
        </p>
      </div>

      {/* Scrollable navigation area */}
      <nav
        className="flex-1 min-h-0 overflow-y-auto px-3 pt-2 pb-3 [scrollbar-width:thin] [scrollbar-color:rgb(245_158_11_/_0.15)_transparent]"
        aria-label="التنقل الرئيسي"
      >
        <div className="flex flex-col gap-0.5">
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const isOpen = openGroups[group.id] ?? false;
            const hasActive = groupContainsPath(group.items, pathname);

            return (
              <div key={group.id}>
                {/* Section heading button */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    hasActive
                      ? "text-amber-300 hover:bg-white/5"
                      : "text-stone-400 hover:bg-white/5 hover:text-stone-200",
                  )}
                >
                  <GroupIcon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate text-start">
                    {group.title}
                  </span>
                  <ChevronLeft
                    className={cn(
                      "size-3.5 shrink-0 text-stone-600 transition-transform duration-200",
                      isOpen ? "-rotate-90" : "rotate-0",
                    )}
                    aria-hidden
                  />
                </button>

                {/* Collapsible items */}
                {isOpen && (
                  <div className="mb-1 flex flex-col gap-0.5 pr-3">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const active =
                        pathname === item.href ||
                        (item.href !== "/dashboard" &&
                          pathname.startsWith(item.href));

                      return (
                        <Link
                          key={item.href + item.label}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-10 w-full items-center gap-2.5 rounded-xl border px-3 text-sm transition-colors",
                            active
                              ? "border-amber-400/20 bg-amber-500/15 text-amber-100"
                              : "border-transparent text-stone-300 hover:bg-white/5 hover:text-stone-100",
                          )}
                        >
                          <ItemIcon className="size-4 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-start font-medium">
                            {item.label}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-amber-500/10 px-5 py-3">
        <p className="text-[11px] leading-relaxed text-stone-500">
          MT5 الحقيقي · محكوم بالقواعد
        </p>
      </div>
    </aside>
  );
}
