export type NavItem = {
  label: string;
  href: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const NAV_ITEMS: NavItem[] = [
  { label: "لوحة التحكم", href: "/dashboard" },
  { label: "المختبر", href: "/lab" },
  { label: "التقارير", href: "/reports" },
  { label: "المراقبة", href: "/monitoring" },
  { label: "Replay", href: "/replay" },
  { label: "الإعدادات", href: "/settings" },
];

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "النظام",
    items: [{ label: "لوحة التحكم", href: "/dashboard" }],
  },
  {
    title: "التداول والتحليل",
    items: [{ label: "المختبر", href: "/lab" }],
  },
  {
    title: "التقارير والاختبار",
    items: [
      { label: "التقارير", href: "/reports" },
      { label: "Replay", href: "/replay" },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { label: "المراقبة", href: "/monitoring" },
      { label: "الإعدادات", href: "/settings" },
    ],
  },
];
