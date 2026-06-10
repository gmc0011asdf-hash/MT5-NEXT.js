import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  FileText,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Settings,
  Shield,
} from "lucide-react";

export type NavItem = {
  label: string;
  href:  string;
  icon:  LucideIcon;
};

export type NavGroup = {
  id:     string;
  title:  string;
  icon:   LucideIcon;
  items:  NavItem[];
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

// ---------------------------------------------------------------------------
// Primary navigation — 6 core items across 4 groups.
// No auth gates, no Convex checks — purely static data.
// ---------------------------------------------------------------------------

export const NAV_GROUPS: NavGroup[] = [
  {
    id:    "home",
    title: "الرئيسية",
    icon:  LayoutDashboard,
    items: [
      { label: "لوحة القيادة", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    id:    "labs",
    title: "غرف العمليات",
    icon:  FlaskConical,
    items: [
      { label: "طرفية الذهب",    href: "/lab/mt5", icon: FlaskConical },
      { label: "طرفية الكريبتو", href: "/lab/okx", icon: Globe        },
      { label: "مختبر الجدار الثلاثي", href: "/lab/triple-firewall", icon: Shield },
    ],
  },
  {
    id:    "intel",
    title: "التحليل والاستخبارات",
    icon:  BookOpen,
    items: [
      { label: "سجل القرارات",             href: "/decision-journal", icon: BookOpen },
      { label: "رادار الأخبار الاقتصادية", href: "/reports",           icon: FileText },
    ],
  },
  {
    id:    "system",
    title: "النظام",
    icon:  Settings,
    items: [
      { label: "الإعدادات المحلية", href: "/settings", icon: Settings },
    ],
  },
];

// ---------------------------------------------------------------------------
// Legacy flat list — kept for any existing consumers (do not remove).
// ---------------------------------------------------------------------------

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const NAV_SECTIONS: NavSection[] = NAV_GROUPS.map((g) => ({
  title: g.title,
  items: g.items,
}));
