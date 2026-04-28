"use client";

import { useEffect, useState } from "react";

export type Mt5ConnectionStatus = {
  connected: boolean;
  account_login: number | null;
  server: string | null;
  company: string | null;
  name: string | null;
  balance: number | null;
  equity: number | null;
  free_margin: number | null;
  currency: string | null;
  leverage: number | null;
  read_only: boolean;
  error?: string;
};

const POLL_MS = 12_000;

export function useMt5ConnectionStatus() {
  const [status, setStatus] = useState<Mt5ConnectionStatus | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadStatus() {
      try {
        const res = await fetch("/api/mt5-readonly/connection-status", { cache: "no-store" });
        const payload = (await res.json()) as Mt5ConnectionStatus;
        if (!alive) return;
        setStatus(payload);
        setLastCheckedAt(Date.now());
      } catch {
        if (!alive) return;
        setStatus({
          connected: false,
          account_login: null,
          server: null,
          company: null,
          name: null,
          balance: null,
          equity: null,
          free_margin: null,
          currency: null,
          leverage: null,
          read_only: true,
          error: "تعذّر الاتصال بخدمة MT5 المحلية",
        });
        setLastCheckedAt(Date.now());
      }
    }

    void loadStatus();
    const id = setInterval(() => {
      void loadStatus();
    }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return { status, lastCheckedAt };
}
