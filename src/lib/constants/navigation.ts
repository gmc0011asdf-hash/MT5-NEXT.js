import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart2,
  BookOpen,
  Database,
  FileText,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Play,
  Server,
  Settings,
  Shield,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  id: string;
  title: string;
  icon: LucideIcon;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    title: "الرئيسية",
    icon: LayoutDashboard,
    items: [
      { label: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    id: "mt5",
    title: "منصة MT5",
    icon: Globe,
    items: [
      { label: "المراقبة", href: "/monitoring", icon: Activity },
      { label: "إعادة التشغيل", href: "/replay", icon: Play },
    ],
  },
  {
    id: "analysis",
    title: "التحليل والمختبر",
    icon: FlaskConical,
    items: [
      { label: "المختبر", href: "/lab/mt5", icon: FlaskConical },
    ],
  },
  {
    id: "reports",
    title: "التقارير والمراقبة",
    icon: BarChart2,
    items: [
      { label: "سجل القرارات", href: "/decision-journal", icon: BookOpen },
      { label: "التقارير", href: "/reports", icon: FileText },
    ],
  },
  {
    id: "system",
    title: "الإعدادات والنظام",
    icon: Shield,
    items: [
      { label: "الإعدادات", href: "/settings", icon: Settings },
      { label: "Convex Core", href: "/convex-core", icon: Server },
      { label: "Convex Test", href: "/convex-test", icon: Database },
    ],
  },
];

// Legacy flat list kept for any existing consumers
export const NAV_ITEMS: NavItem[] = [
  { label: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard },
  { label: "المختبر", href: "/lab/mt5", icon: FlaskConical },
  { label: "سجل القرارات", href: "/decision-journal", icon: BookOpen },
  { label: "التقارير", href: "/reports", icon: FileText },
  { label: "المراقبة", href: "/monitoring", icon: Activity },
  { label: "إعادة التشغيل", href: "/replay", icon: Play },
  { label: "الإعدادات", href: "/settings", icon: Settings },
];

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "النظام",
    items: [{ label: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "التداول والتحليل",
    items: [{ label: "المختبر", href: "/lab/mt5", icon: FlaskConical }],
  },
  {
    title: "التقارير والاختبار",
    items: [
      { label: "سجل القرارات", href: "/decision-journal", icon: BookOpen },
      { label: "التقارير", href: "/reports", icon: FileText },
      { label: "إعادة التشغيل", href: "/replay", icon: Play },
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
