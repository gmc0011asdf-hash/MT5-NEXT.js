"use client";

import { useEffect, useState } from "react";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MarketPulseIndicator } from "@/components/dashboard/MarketPulseIndicator";
import { StatusBadge } from "@/components/common/status-indicator";
import { useMockMarketStream } from "@/hooks/use-mock-market-stream";
import { useReadOnlyMonitoringSnapshot } from "@/lib/hooks/use-read-only-monitoring-snapshot";

const SYSTEM_NAME = "نظام الملك الهندسي للتداول العالمي";

export function AppHeader() {
  const { isLoaded, isSignedIn } = useAuth();
  const snap = useReadOnlyMonitoringSnapshot();
  const { lastTickAt } = useMockMarketStream();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const lastUpdateLabel =
    mounted && lastTickAt
      ? new Date(lastTickAt).toLocaleTimeString("ar-SA", { hour12: false })
      : "—";

  const mt5Connected = snap.phase === "live" && snap.live.mt5.status === "connected";
  const mt5Badge = snap.phase === "live" ? (mt5Connected ? "MT5 (قراءة): متصل" : `MT5: ${snap.live.mt5.status}`) : "MT5 غير متصل";

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/10 bg-gradient-to-l from-card/90 to-card/40 px-4 py-2 backdrop-blur-md sm:gap-3 md:px-5">
      <div className="min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[12rem]">
        <h1 className="truncate font-semibold text-sm text-foreground sm:text-base">{SYSTEM_NAME}</h1>
        <p className="text-muted-foreground text-[11px] tabular-nums sm:text-xs">
          آخر تحديث واجهة: {lastUpdateLabel}
        </p>
      </div>
      <Separator orientation="vertical" className="hidden h-8 sm:block" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:ms-auto sm:flex-none md:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MarketPulseIndicator mockLive />
          <StatusBadge variant="neutral">قراءة فقط</StatusBadge>
          <Badge
            variant="outline"
            className={
              mt5Connected
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/20 bg-rose-500/5 text-rose-200/90"
            }
          >
            {mt5Badge}
          </Badge>
          <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-100">
            Demo Mode
          </Badge>
          <Badge variant="outline" className="border-border text-muted-foreground">
            Pending معطّل
          </Badge>
        </div>
        <div className="border-amber-500/10 flex shrink-0 items-center gap-2 border-s ps-2 sm:ps-3">
          {isLoaded && isSignedIn && (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8 ring-1 ring-amber-500/20",
                },
              }}
            />
          )}
          {isLoaded && !isSignedIn && (
            <>
              <SignInButton mode="modal">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-amber-500/25 bg-amber-500/5 text-amber-50 hover:bg-amber-500/10"
                >
                  تسجيل الدخول
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button type="button" variant="secondary" size="sm" className="text-foreground">
                  إنشاء حساب
                </Button>
              </SignUpButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
