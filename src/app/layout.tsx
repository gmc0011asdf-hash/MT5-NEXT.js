import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Cairo, Geist_Mono } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClerkProvider } from "@/components/providers/convex-clerk-provider";

import "./globals.css";

const cairo = Cairo({
  variable: "--font-sans",
  subsets: ["arabic", "latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "نظام الملك الهندسي للتداول العالمي",
  description: "واجهة مؤسسية لنظام التداول والتحليل وإدارة المخاطر",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="ar"
        dir="rtl"
        className={`${cairo.variable} ${geistMono.variable} dark h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="min-h-full bg-background font-sans text-foreground">
          <ConvexClerkProvider>
            <TooltipProvider delay={0}>{children}</TooltipProvider>
          </ConvexClerkProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
