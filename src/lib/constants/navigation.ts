import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Database,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Play,
  Server,
  Settings,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const NAV_ITEMS: NavItem[] = [
  { label: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard },
  { label: "المختبر", href: "/lab", icon: FlaskConical },
  { label: "التقارير", href: "/reports", icon: FileText },
  { label: "المراقبة", href: "/monitoring", icon: Activity },
  { label: "Replay", href: "/replay", icon: Play },
  { label: "الإعدادات", href: "/settings", icon: Settings },
];

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "النظام",
    items: [{ label: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "التداول والتحليل",
    items: [{ label: "المختبر", href: "/lab", icon: FlaskConical }],
  },
  {
    title: "التقارير والاختبار",
    items: [
      { label: "التقارير", href: "/reports", icon: FileText },
      { label: "Replay", href: "/replay", icon: Play },
      { label: "اختبار Convex", href: "/convex-test", icon: Database },
      { label: "قاعدة Convex", href: "/convex-core", icon: Server },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { label: "المراقبة", href: "/monitoring", icon: Activity },
      { label: "الإعدادات", href: "/settings", icon: Settings },
    ],
  },
];
