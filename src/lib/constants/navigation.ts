import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertOctagon,
  BarChart2,
  BookMarked,
  BookOpen,
  Database,
  FileText,
  FlaskConical,
  Gem,
  Globe,
  HeartPulse,
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
    id: "gold",
    title: "منصة الذهب",
    icon: Gem,
    items: [
      { label: "Gold Command Center",   href: "/gold",               icon: Gem },
      { label: "Gold Strategy Lab",     href: "/gold/strategy-lab",  icon: FlaskConical },
      { label: "مكتبة الاستراتيجيات",   href: "/strategy-library",   icon: BookMarked },
    ],
  },
  {
    id: "analysis",
    title: "التحليل والمختبر",
    icon: FlaskConical,
    items: [
      { label: "MT5 General Lab", href: "/lab/mt5", icon: FlaskConical },
    ],
  },
  {
    id: "reports",
    title: "التقارير والمراقبة",
    icon: BarChart2,
    items: [
      { label: "سجل القرارات", href: "/decision-journal", icon: BookOpen },
      { label: "التقارير", href: "/reports", icon: FileText },
      { label: "صحة النظام", href: "/system-health", icon: HeartPulse },
      { label: "مركز الأخطاء", href: "/error-center", icon: AlertOctagon },
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
  { label: "لوحة التحكم",           href: "/dashboard",         icon: LayoutDashboard },
  { label: "Gold Command Center",   href: "/gold",              icon: Gem },
  { label: "Gold Strategy Lab",     href: "/gold/strategy-lab", icon: FlaskConical },
  { label: "مكتبة الاستراتيجيات",   href: "/strategy-library",  icon: BookMarked },
  { label: "MT5 General Lab",       href: "/lab/mt5",           icon: FlaskConical },
  { label: "سجل القرارات", href: "/decision-journal", icon: BookOpen },
  { label: "التقارير", href: "/reports", icon: FileText },
  { label: "صحة النظام", href: "/system-health", icon: HeartPulse },
  { label: "مركز الأخطاء", href: "/error-center", icon: AlertOctagon },
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
    title: "منصة الذهب",
    items: [
      { label: "Gold Command Center",   href: "/gold",              icon: Gem },
      { label: "Gold Strategy Lab",     href: "/gold/strategy-lab", icon: FlaskConical },
      { label: "مكتبة الاستراتيجيات",   href: "/strategy-library",  icon: BookMarked },
    ],
  },
  {
    title: "التحليل والمختبر",
    items: [{ label: "MT5 General Lab", href: "/lab/mt5", icon: FlaskConical }],
  },
  {
    title: "التقارير والاختبار",
    items: [
      { label: "سجل القرارات", href: "/decision-journal", icon: BookOpen },
      { label: "التقارير", href: "/reports", icon: FileText },
      { label: "صحة النظام", href: "/system-health", icon: HeartPulse },
      { label: "مركز الأخطاء", href: "/error-center", icon: AlertOctagon },
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
