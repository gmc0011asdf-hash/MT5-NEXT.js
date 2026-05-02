"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";

const SYMBOL_SYNC_CHUNK = 100;
const DISPLAY_ROW_CAP = 300;
const DEFAULT_TERMINAL_PATH = "C:\\Program Files\\MetaTrader 5\\terminal64.exe";

type Mt5ConnectionStatus = {
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

function SymbolToggleSwitch({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`group relative inline-flex h-8 w-[78px] items-center rounded-full border px-1 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 ${
        checked
          ? "border-emerald-500/50 bg-emerald-500/20"
          : "border-rose-500/45 bg-rose-500/20"
      }`}
    >
      <span className={`w-full px-1 text-[10px] font-semibold tracking-wide ${checked ? "text-emerald-100 text-right" : "text-rose-100 text-left"}`}>
        {checked ? "ON" : "OFF"}
      </span>
      <span
        className={`absolute top-1 h-6 w-6 rounded-full border shadow-sm transition-transform ${
          checked
            ? "left-1 border-emerald-300/50 bg-emerald-100/90 translate-x-0"
            : "left-1 border-rose-300/50 bg-rose-100/90 translate-x-[48px]"
        }`}
      />
    </button>
  );
}

function dedupeSymbolsByName(raw: unknown[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    map.set(name, rec);
  }
  return [...map.values()];
}

export default function SettingsPage() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const syncSymbolsMutation = useMutation(api.mt5Bridge.syncReadOnlySymbolsFromLocalService);
  const syncSnapshotMutation = useMutation(api.mt5Bridge.syncReadOnlySnapshotFromLocalService);
  const updateSymbolMutation = useMutation(api.mt5Bridge.updateMySymbolSetting);

  const mt5Symbols = useQuery(api.coreQueries.getMyMt5SymbolsWithSettings, canUseConvex ? {} : "skip");
  const auditEvents = useQuery(api.coreQueries.getMyAuditEvents, canUseConvex ? {} : "skip");
  const mt5Summary = useQuery(api.coreQueries.getMyMt5ReadOnlySummary, canUseConvex ? {} : "skip");
  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [symbolSearch, setSymbolSearch] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMessage, setConnectMessage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Mt5ConnectionStatus | null>(null);
  const [mt5Login, setMt5Login] = useState("");
  const [mt5Server, setMt5Server] = useState("");
  const [mt5Password, setMt5Password] = useState("");
  const [mt5TerminalPath, setMt5TerminalPath] = useState(DEFAULT_TERMINAL_PATH);

  const filteredSymbols = useMemo(() => {
    if (!mt5Symbols || mt5Symbols.length === 0) return [];
    const q = symbolSearch.trim().toLowerCase();
    if (!q) return mt5Symbols;
    return mt5Symbols.filter((row) => {
      const name = row.name.toLowerCase();
      const desc = (row.description ?? "").toLowerCase();
      const cur = [row.currencyBase, row.currencyProfit, row.currencyMargin].filter(Boolean).join(" ").toLowerCase();
      return name.includes(q) || desc.includes(q) || cur.includes(q);
    });
  }, [mt5Symbols, symbolSearch]);

  const tableRows = useMemo(
    () => filteredSymbols.slice(0, DISPLAY_ROW_CAP),
    [filteredSymbols],
  );

  const showDisplayCapHint = filteredSymbols.length > DISPLAY_ROW_CAP;

  useEffect(() => {
    let mounted = true;
    async function loadConnectionStatus() {
      try {
        const res = await fetch("/api/mt5-readonly/connection-status", { cache: "no-store" });
        const payload = (await res.json()) as Mt5ConnectionStatus;
        if (mounted) setConnectionStatus(payload);
      } catch {
        if (mounted) {
          setConnectionStatus({
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
          });
        }
      }
    }
    void loadConnectionStatus();
    return () => {
      mounted = false;
    };
  }, []);

  async function syncPairsFromMt5() {
    setSyncMessage(null);
    setSyncProgress(null);
    setSyncBusy(true);
    try {
      const res = await fetch("/api/mt5-readonly/symbols?visibleOnly=true", { cache: "no-store" });
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok || payload.connected === false) {
        setSyncMessage(
          typeof payload.error === "string"
            ? payload.error
            : "فشل جلب الأزواج من الخدمة المحلية أو MT5 غير متصل.",
        );
        return;
      }
      const list = dedupeSymbolsByName(Array.isArray(payload.symbols) ? payload.symbols : []);
      if (list.length === 0) {
        setSyncMessage("لا توجد رموز في الاستجابة.");
        return;
      }
      const total = list.length;
      const syncRunId = `sym-${Date.now()}`;
      const chunks: Record<string, unknown>[][] = [];
      for (let i = 0; i < list.length; i += SYMBOL_SYNC_CHUNK) {
        chunks.push(list.slice(i, i + SYMBOL_SYNC_CHUNK));
      }
      const totalChunks = chunks.length;
      let acc = 0;
      for (let i = 0; i < totalChunks; i++) {
        const chunk = chunks[i]!;
        setSyncProgress(`جاري مزامنة الأزواج: ${acc} / ${total}`);
        try {
          await syncSymbolsMutation({
            connected: true,
            symbols: chunk,
            syncRunId,
            total,
            chunkIndex: i,
            totalChunks,
            read_only_mode: typeof payload.read_only_mode === "boolean" ? payload.read_only_mode : true,
          });
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          setSyncMessage(
            `فشلت المزامنة في الدفعة ${i + 1} من ${totalChunks}. ${reason}`,
          );
          setSyncProgress(null);
          return;
        }
        acc += chunk.length;
        setSyncProgress(`جاري مزامنة الأزواج: ${acc} / ${total}`);
      }
      setSyncMessage("تمت مزامنة الرموز الظاهرة في MT5 (قراءة فقط).");
    } catch {
      setSyncMessage("فشل الاتصال بالخدمة المحلية أو الخادم.");
    } finally {
      setSyncBusy(false);
      setSyncProgress(null);
    }
  }

  async function patchSymbol(symbol: string, next: { enabled: boolean; showInLab: boolean }) {
    try {
      await updateSymbolMutation({
        symbol,
        enabled: next.enabled,
        showInLab: next.showInLab,
      });
      setSyncMessage(null);
    } catch {
      setSyncMessage("تعذّر حفظ الإعدادات.");
    }
  }

  async function syncSnapshotAfterConnect() {
    const res = await fetch("/api/mt5-readonly/snapshot", { cache: "no-store" });
    const payload = (await res.json()) as { ok?: boolean; snapshot?: unknown; error?: string };
    if (!res.ok || !payload.ok || payload.snapshot === undefined) {
      throw new Error(payload.error ?? "فشل مزامنة لقطة MT5 بعد الاتصال.");
    }
    await syncSnapshotMutation({ snapshot: payload.snapshot as never });
  }

  async function connectRealMt5Account() {
    setConnectMessage(null);
    setConnectBusy(true);
    try {
      const loginValue = Number(mt5Login);
      if (!Number.isFinite(loginValue) || loginValue <= 0) {
        setConnectMessage("رقم الحساب غير صالح.");
        return;
      }
      if (!mt5Server.trim()) {
        setConnectMessage("السيرفر مطلوب.");
        return;
      }
      if (!mt5Password) {
        setConnectMessage("كلمة المرور مطلوبة.");
        return;
      }
      if (!mt5TerminalPath.trim()) {
        setConnectMessage("مسار terminal64.exe مطلوب.");
        return;
      }

      const res = await fetch("/api/mt5-readonly/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: loginValue,
          server: mt5Server.trim(),
          password: mt5Password,
          terminal_path: mt5TerminalPath.trim(),
        }),
      });
      const payload = (await res.json()) as {
        connected?: boolean;
        account?: {
          login?: number;
          name?: string | null;
          company?: string | null;
          server?: string | null;
          balance?: number | null;
          equity?: number | null;
          free_margin?: number | null;
          currency?: string | null;
          leverage?: number | null;
        };
        error?: string;
      };
      if (!res.ok || payload.connected !== true) {
        setConnectMessage(payload.error ?? "فشل الاتصال بمنصة MT5.");
        return;
      }

      const account = payload.account;
      setConnectionStatus({
        connected: true,
        account_login: account?.login ?? null,
        server: account?.server ?? null,
        company: account?.company ?? null,
        name: account?.name ?? null,
        balance: account?.balance ?? null,
        equity: account?.equity ?? null,
        free_margin: account?.free_margin ?? null,
        currency: account?.currency ?? null,
        leverage: account?.leverage ?? null,
        read_only: true,
      });

      if (canUseConvex) {
        await syncSnapshotAfterConnect();
      }
      setConnectMessage("تم الاتصال بمنصة MT5 بنجاح (قراءة فقط).");
    } catch (e) {
      const reason = e instanceof Error ? e.message : "فشل الاتصال بخدمة MT5 المحلية.";
      setConnectMessage(reason);
    } finally {
      setMt5Password("");
      setConnectBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">الإعدادات</h2>
        <p className="label-secondary mt-1">تكوين وتخصيص إعدادات المنصة.</p>
        <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-amber-100/90 text-sm">
          تأسيس أولي للإعدادات — بعض الأقسام تعمل كـ Placeholders للعرض فقط.
        </p>
      </div>

      <Section title="إعدادات MT5">
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed mb-4">
          اتصال قراءة فقط. لا يتم تنفيذ أي أوامر تداول.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none" htmlFor="mt5-login">
              رقم الحساب
            </label>
            <Input
              id="mt5-login"
              value={mt5Login}
              onChange={(e) => setMt5Login(e.target.value)}
              placeholder="123456"
              dir="ltr"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none" htmlFor="mt5-server">
              السيرفر
            </label>
            <Input
              id="mt5-server"
              value={mt5Server}
              onChange={(e) => setMt5Server(e.target.value)}
              placeholder="Broker-Server"
              dir="ltr"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none" htmlFor="mt5-password">
              كلمة المرور
            </label>
            <Input
              id="mt5-password"
              type="password"
              value={mt5Password}
              onChange={(e) => setMt5Password(e.target.value)}
              placeholder="********"
              dir="ltr"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none" htmlFor="mt5-terminal-path">
              مسار terminal64.exe
            </label>
            <Input
              id="mt5-terminal-path"
              value={mt5TerminalPath}
              onChange={(e) => setMt5TerminalPath(e.target.value)}
              placeholder={DEFAULT_TERMINAL_PATH}
              dir="ltr"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button
            type="button"
            variant="outline"
            disabled={connectBusy}
            onClick={() => void connectRealMt5Account()}
          >
            {connectBusy ? "جاري الاتصال…" : "اتصال بمنصة MT5"}
          </Button>
          {connectMessage ? <span className="text-muted-foreground text-xs">{connectMessage}</span> : null}
        </div>
        {connectionStatus?.connected ? (
          <div className="grid gap-2 mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm md:grid-cols-2">
            <div>رقم الحساب: <span className="tabular-nums">{connectionStatus.account_login ?? "—"}</span></div>
            <div>الاسم: {connectionStatus.name ?? "—"}</div>
            <div>الشركة: {connectionStatus.company ?? "—"}</div>
            <div>السيرفر: {connectionStatus.server ?? "—"}</div>
            <div>الرصيد: <span className="tabular-nums">{connectionStatus.balance ?? "—"}</span></div>
            <div>Equity: <span className="tabular-nums">{connectionStatus.equity ?? "—"}</span></div>
            <div>Free Margin: <span className="tabular-nums">{connectionStatus.free_margin ?? "—"}</span></div>
            <div>العملة: {connectionStatus.currency ?? "—"}</div>
            <div>الرافعة: <span className="tabular-nums">{connectionStatus.leverage ?? "—"}</span></div>
            <div>وضع القراءة فقط: {connectionStatus.read_only ? "نعم" : "لا"}</div>
          </div>
        ) : null}
      </Section>

      <Section title="إعدادات OKX — قراءة فقط (Placeholder)">
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed mb-4">
          هذا القسم مجرد عنصر نائب (Placeholder). سيتم تفعيل الاتصال بواجهة برمجة التطبيقات (API) الخاصة بـ OKX لاحقاً.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="API Key" placeholder="مخفي (عنصر نائب)" />
          <Field label="Secret Key" placeholder="مخفي (عنصر نائب)" />
          <Field label="Passphrase" placeholder="مخفي (عنصر نائب)" />
          <Field label="وضع الاتصال" value="قراءة فقط (مخطط له)" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button type="button" variant="outline" disabled>
            اتصال بـ OKX (قريباً)
          </Button>
        </div>
      </Section>

      <Section title="إعدادات الرموز والأزواج (Symbols)">
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed mb-4">
          تظهر هنا فقط الرموز المعروضة في Market Watch داخل MT5. لإضافة رمز جديد، أظهره أولًا في MT5 ثم أعد المزامنة.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Button
            type="button"
            variant="outline"
            disabled={!canUseConvex || syncBusy}
            onClick={() => void syncPairsFromMt5()}
          >
            {syncBusy ? "جاري المزامنة…" : "مزامنة الرموز الظاهرة في MT5"}
          </Button>
          {syncProgress ? (
            <span className="text-muted-foreground text-xs leading-snug tabular-nums">{syncProgress}</span>
          ) : null}
          {syncMessage ? (
            <span className="text-muted-foreground text-xs leading-snug">{syncMessage}</span>
          ) : null}
        </div>

        <div className="max-w-md space-y-2 mb-4">
          <label className="text-sm font-medium leading-none" htmlFor="mt5-symbol-search">
            بحث في الأزواج
          </label>
          <Input
            id="mt5-symbol-search"
            value={symbolSearch}
            onChange={(e) => setSymbolSearch(e.target.value)}
            placeholder="مثال: XAUUSD أو metal"
            className="bg-background/80"
            dir="ltr"
          />
        </div>

        {!canUseConvex && !isConvexAuthLoading ? (
          <p className="text-muted-foreground text-sm">سجّل الدخول لمزامنة الأزواج من الخدمة المحلية.</p>
        ) : isConvexAuthLoading || mt5Symbols === undefined ? (
          <p className="text-muted-foreground text-sm">جاري تحميل بيانات الأزواج…</p>
        ) : mt5Symbols.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            لا توجد رموز ظاهرة من MT5 بعد — افتح Market Watch في MT5 ثم اضغط مزامنة الرموز الظاهرة.
          </p>
        ) : (
          <div className="space-y-2">
            {showDisplayCapHint ? (
              <p className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed">
                تمت مزامنة جميع الرموز، يتم عرض أول 300 فقط. استخدم البحث للعثور على رمز محدد.
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-xl border border-amber-500/10">
              <Table>
                <TableHeader>
                  <TableRow className="border-amber-500/10 hover:bg-transparent">
                    <TableHead className="text-foreground">الرمز</TableHead>
                    <TableHead className="text-foreground">الوصف</TableHead>
                    <TableHead className="text-foreground">العملات</TableHead>
                    <TableHead className="text-foreground">ظاهر</TableHead>
                    <TableHead className="text-foreground">المصدر</TableHead>
                    <TableHead className="text-foreground">مفعّل</TableHead>
                    <TableHead className="text-foreground">عرض في المختبر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((row) => {
                    const cur = [row.currencyBase, row.currencyProfit, row.currencyMargin]
                      .filter(Boolean)
                      .join(" / ");
                    return (
                      <TableRow key={row._id} className="border-border/60">
                        <TableCell className="font-medium text-amber-100/90 tabular-nums">{row.name}</TableCell>
                        <TableCell className="max-w-[200px] text-muted-foreground text-xs">
                          {row.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs tabular-nums">
                          {cur || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {row.visible ? "نعم" : "لا"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">MT5 Market Watch</TableCell>
                        <TableCell>
                          <SymbolToggleSwitch
                            checked={row.enabled}
                            label={`تبديل مفعّل للرمز ${row.name}`}
                            onToggle={() =>
                              void patchSymbol(row.name, { enabled: !row.enabled, showInLab: row.showInLab })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <SymbolToggleSwitch
                            checked={row.showInLab}
                            label={`تبديل عرض المختبر للرمز ${row.name}`}
                            onToggle={() =>
                              void patchSymbol(row.name, { enabled: row.enabled, showInLab: !row.showInLab })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Section>

      <Section title="إعدادات المخاطرة (Risk Settings)">
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed mb-4">
          إعدادات المخاطرة وإدارة الحوكمة. (للعرض فقط ولن يتم تطبيقها فعلياً في هذه المرحلة).
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="مخاطرة بالدولار (عنصر نائب)" value="50 USD" />
          <Field label="حد أقصى يومي للصفقات" value="3 صفقات" />
          <Field label="حد أقصى يومي للخسارة" value="150 USD" />
          <Field label="حد أقصى لنفس الزوج" value="1 صفقة" />
          
          <div className="col-span-2 mt-2">
            <h4 className="text-sm font-semibold text-amber-100/80 mb-3 border-b border-amber-500/10 pb-2">ضوابط الحوكمة</h4>
          </div>
          <Field label="Kill switch (مفتاح الطوارئ)" value="غير مفعل (عرض)" />
          <Field label="تبريد بعد خسارة متتالية" value="60 دقيقة" />
          <Field label="حد الخسائر المتتالية (Drawdown)" value="3 صفقات خاسرة" />
        </div>
      </Section>

      <Section title="إعدادات التنبيهات (Notifications Settings)">
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed mb-4">
          إعدادات الإشعارات (Telegram, Email, Push). (للعرض فقط).
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Telegram ID" placeholder="@username أو معرف" />
          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">تفعيل التنبيهات الصوتية / المنبثقة</span>
            <div className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2">
              <span className="text-muted-foreground text-xs">معطّل (قيد التطوير)</span>
              <Badge variant="secondary">معطّل</Badge>
            </div>
          </div>
        </div>
      </Section>

      <Section title="إعدادات الاشتراك والباقة (Subscription / Plan)">
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed mb-4">
          سيتم ربط نظام Clerk والفوترة (Billing) لإدارة اشتراكك لاحقاً.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="الباقة الحالية" value="لا يوجد (نسخة تجريبية)" />
          <Field label="حالة الاشتراك" value="غير مفعل" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button type="button" variant="outline" disabled>
            ترقية الباقة (قريباً)
          </Button>
          <Button type="button" variant="ghost" disabled>
            إدارة الفواتير
          </Button>
        </div>
      </Section>

      <Section title="إعدادات الأمان وسجل النظام (Security)">
        <p className="text-muted-foreground text-xs leading-relaxed mb-4">
          سجل التدقيق (Audit Log) يوضح عمليات النظام والإعدادات لأغراض الأمان والمراقبة.
        </p>
        {!canUseConvex && !isConvexAuthLoading ? (
          <p className="text-muted-foreground text-sm">سجّل الدخول لعرض سجل التدقيق.</p>
        ) : isConvexAuthLoading || auditEvents === undefined ? (
          <p className="text-muted-foreground text-sm">جاري تحميل سجل التدقيق…</p>
        ) : auditEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">لا توجد أحداث تدقيق بعد.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-amber-500/10 mb-4">
            <Table>
              <TableHeader>
                <TableRow className="border-amber-500/10 hover:bg-transparent">
                  <TableHead className="text-foreground">الوقت</TableHead>
                  <TableHead className="text-foreground">الإجراء</TableHead>
                  <TableHead className="text-foreground">الكيان</TableHead>
                  <TableHead className="text-foreground">الرسالة</TableHead>
                  <TableHead className="text-foreground">المصدر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditEvents.slice(0, 50).map((row) => (
                  <TableRow key={row._id} className="border-border/60">
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                      {new Date(row.createdAt).toLocaleString("ar-SA", { hour12: false })}
                    </TableCell>
                    <TableCell className="font-medium text-xs">{row.action}</TableCell>
                    <TableCell className="text-xs">{row.entity}</TableCell>
                    <TableCell className="max-w-[280px] text-muted-foreground text-xs leading-snug">
                      {row.message}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{row.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        
        <div className="grid gap-4 md:grid-cols-2 pt-2">
          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">إدارة الجلسات</span>
            <div className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2">
              <span className="text-muted-foreground text-xs">الجلسة الحالية آمنة</span>
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-200">
                مشفرة
              </Badge>
            </div>
          </div>
        </div>
      </Section>

      <Section title="جاهزية مرحلة العقول واللجان">
        <p className="text-muted-foreground text-xs leading-relaxed mb-4">
          قائمة تحقق للقراءة فقط قبل تشغيل مرحلة العقول واللجان.
        </p>
        <div className="grid gap-2 text-sm">
          <CheckItem label="اتصال MT5 قراءة فقط" ok={mt5Summary?.hasRealMt5LocalData === true} />
          <CheckItem label="مزامنة الحساب" ok={Boolean(mt5Summary?.latestAccountSnapshot)} />
          <CheckItem label="مزامنة الأسعار" ok={(mt5Summary?.lastSyncAt ?? 0) > 0} />
          <CheckItem label="مزامنة الصفقات النشطة" ok={(mt5Summary?.openPositionsCount ?? 0) >= 0} />
          <CheckItem label="مزامنة سجل الصفقات" ok={(auditEvents?.some((e) => e.action.includes("trade_history")) ?? false)} />
          <CheckItem label="الرموز الظاهرة من MT5" ok={(mt5Symbols?.length ?? 0) > 0} />
          <CheckItem label="إعدادات الأزواج للمختبر" ok={(mt5Symbols?.some((s) => s.showInLab) ?? false)} />
          <CheckItem label="الحوكمة readOnly" ok={governance?.readOnly === true} />
          <CheckItem label="منع تنفيذ التداول" ok={governance?.tradingEnabled === false} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className={institutionalCardClass("p-4 md:p-5")}>
      <CardHeader className="border-b border-amber-500/10 p-0 pb-3">
        <CardTitle className="card-title-inst">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-0 pt-4">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  placeholder,
}: {
  label: string;
  value?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium leading-none">{label}</label>
      <Input
        disabled
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="bg-muted/30"
      />
    </div>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-amber-500/10 bg-muted/20 px-3 py-2">
      <span>{label}</span>
      <Badge variant={ok ? "outline" : "secondary"} className={ok ? "border-emerald-500/30 text-emerald-200" : ""}>
        {ok ? "جاهز" : "غير جاهز"}
      </Badge>
    </div>
  );
}
