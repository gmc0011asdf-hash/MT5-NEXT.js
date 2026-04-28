"use client";

import { useEffect, useState } from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { LiveMarketCard } from "@/components/dashboard/LiveMarketCard";
import { useMockMarketStream } from "@/hooks/use-mock-market-stream";
import { MARKET_SYMBOLS } from "@/lib/mock-market-stream";

export function LiveMarketTicker() {
  const { bySymbol, lastTickAt } = useMockMarketStream();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const ordered = MARKET_SYMBOLS.map((s) => bySymbol[s]);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="font-medium text-base text-foreground md:text-lg">أسعار تجريبية (واجهة فقط)</h3>
        <p className="max-w-prose text-end text-muted-foreground text-xs leading-snug">
          بيانات حركة تجريبية للواجهة — لا توجد أوامر تنفيذ.
        </p>
      </div>
      <ScrollArea className="w-full whitespace-nowrap pb-1">
        <div className="flex gap-3 pb-2">
          {ordered.map((tick) => (
            <LiveMarketCard key={tick.symbol} tick={tick} />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <p className="text-muted-foreground text-[11px] tabular-nums">
        آخر تحديث للتيار الوهمي:{" "}
        {mounted && lastTickAt ? new Date(lastTickAt).toLocaleTimeString("ar-SA", { hour12: false }) : "--:--:--"}
      </p>
    </section>
  );
}
