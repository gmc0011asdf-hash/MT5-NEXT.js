"use client";

import { useEffect, useState } from "react";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/common/status-indicator";
import { useMt5ConnectionStatus } from "@/lib/hooks/use-mt5-connection-status";

const SYSTEM_NAME = "نظام الملك الهندسي للتداول العالمي";

export function AppHeader() {
  const { isLoaded, isSignedIn } = useAuth();
  const { status, lastCheckedAt } = useMt5ConnectionStatus();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const lastUpdateLabel = mounted && lastCheckedAt
    ? new Date(lastCheckedAt).toLocaleTimeString("ar-SA", { hour12: false })
    : "—";

  const mt5Connected = status?.connected === true;

  return (
    <header className="shrink-0 border-b border-amber-500/10 bg-gradient-to-l from-card/90 to-card/40 px-4 py-3 backdrop-blur-md md:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-sm text-foreground sm:text-base">{SYSTEM_NAME}</h1>
          <p className="text-muted-foreground text-[11px] tabular-nums sm:text-xs">
            آخر تحقق MT5: {lastUpdateLabel}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            mt5Connected
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/20 bg-rose-500/5 text-rose-200/90"
          }
        >
          {mt5Connected ? "متصل بمنصة MT5" : "غير متصل بمنصة MT5"}
        </Badge>
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
      <Separator className="my-3 border-amber-500/10" />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge variant="neutral">محكوم بالقواعد</StatusBadge>
        {!mt5Connected ? (
          <span className="text-muted-foreground text-xs leading-relaxed">
            افتح منصة MT5 وشغّل خدمة MT5 المحلية
          </span>
        ) : (
          <>
            {status?.account_login ? (
              <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-100 tabular-nums">
                الحساب: {status.account_login}
              </Badge>
            ) : null}
            {status?.name ? (
              <Badge variant="outline" className="max-w-[220px] truncate border-border text-muted-foreground">
                الاسم: {status.name}
              </Badge>
            ) : null}
            {status?.server ? (
              <Badge variant="outline" className="max-w-[260px] truncate border-border text-muted-foreground">
                الخادم: {status.server}
              </Badge>
            ) : null}
            {status?.balance !== null ? (
              <Badge variant="outline" className="border-border text-muted-foreground tabular-nums">
                الرصيد: {status.balance} {status.currency ?? ""}
              </Badge>
            ) : null}
            {status?.equity !== null ? (
              <Badge variant="outline" className="border-border text-muted-foreground tabular-nums">
                Equity: {status.equity}
              </Badge>
            ) : null}
            {status?.free_margin !== null ? (
              <Badge variant="outline" className="border-border text-muted-foreground tabular-nums">
                Free Margin: {status.free_margin}
              </Badge>
            ) : null}
          </>
        )}
        <Badge variant="outline" className="border-border text-muted-foreground">
          مصدر البيانات: MT5 الحقيقي
        </Badge>
        <Badge variant="outline" className="border-border text-muted-foreground">
          الرموز: Market Watch
        </Badge>
        <Badge variant="outline" className="border-border text-muted-foreground">
          الشموع: MT5 محكوم
        </Badge>
      </div>
    </header>
  );
}
