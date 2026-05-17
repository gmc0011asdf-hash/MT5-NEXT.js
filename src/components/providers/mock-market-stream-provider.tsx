"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  createInitialMarketState,
  stepMarketState,
  type MarketSymbol,
  type MarketTick,
} from "@/lib/mock-market-stream";

function nextIntervalMs(): number {
  return 3000 + Math.floor(Math.random() * 2000);
}

type Ctx = {
  ticks: MarketTick[];
  bySymbol: Record<MarketSymbol, MarketTick>;
  getTick: (symbol: MarketSymbol) => MarketTick;
  lastTickAt: number;
};

const MockMarketStreamContext = createContext<Ctx | null>(null);

export function MockMarketStreamProvider({ children }: { children: ReactNode }) {
  const [bySymbol, setBySymbol] = useState(createInitialMarketState);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeout = setTimeout(() => {
        setBySymbol((p) => stepMarketState(p));
        schedule();
      }, nextIntervalMs());
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  const value = useMemo<Ctx>(() => {
    const ticks = Object.values(bySymbol) as MarketTick[];
    const lastTickAt = Math.max(...ticks.map((t) => t.updatedAt), 0);
    return {
      ticks,
      bySymbol,
      getTick: (symbol: MarketSymbol) => bySymbol[symbol],
      lastTickAt,
    };
  }, [bySymbol]);

  return (
    <MockMarketStreamContext.Provider value={value}>{children}</MockMarketStreamContext.Provider>
  );
}

export function useMockMarketStream(): Ctx {
  const ctx = useContext(MockMarketStreamContext);
  if (!ctx) {
    throw new Error("useMockMarketStream must be used within MockMarketStreamProvider");
  }
  return ctx;
}
