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
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";

const SYMBOL_SYNC_CHUNK = 100;
const DISPLAY_ROW_CAP = 300;

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
  const updateSymbolMutation = useMutation(api.mt5Bridge.updateMySymbolSetting);

  const mt5Symbols = useQuery(api.coreQueries.getMyMt5SymbolsWithSettings, canUseConvex ? {} : "skip");
  const auditEvents = useQuery(api.coreQueries.getMyAuditEvents, canUseConvex ? {} : "skip");

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [symbolSearch, setSymbolSearch] = useState("");

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

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">الإعدادات</h2>
        <p className="label-secondary mt-1">حقول معطّلة — إعدادات عرض فقط.</p>
        <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-amber-100/90 text-sm">
          إعدادات عرض فقط في هذه النسخة الأولية.
        </p>
      </div>

      <Section title="أزواج وأدوات MT5 الظاهرة">
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100/90 text-xs leading-relaxed">
          هذه إعدادات عرض فقط ولا تنفذ أي صفقة.
        </p>
        <div className="flex flex-wrap items-center gap-3">
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
        <p className="text-muted-foreground text-xs leading-relaxed">
          تظهر هنا فقط الرموز المعروضة في Market Watch داخل MT5. لإضافة رمز جديد، أظهره أولًا في MT5 ثم أعد المزامنة.
        </p>

        <div className="max-w-md space-y-2">
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
                          <Button
                            type="button"
                            size="sm"
                            variant={row.enabled ? "default" : "outline"}
                            onClick={() =>
                              void patchSymbol(row.name, { enabled: !row.enabled, showInLab: row.showInLab })
                            }
                          >
                            {row.enabled ? "تشغيل" : "إيقاف"}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant={row.showInLab ? "default" : "outline"}
                            onClick={() =>
                              void patchSymbol(row.name, { enabled: row.enabled, showInLab: !row.showInLab })
                            }
                          >
                            {row.showInLab ? "تشغيل" : "إيقاف"}
                          </Button>
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

      <Section title="سجل التدقيق (Convex)">
        <p className="text-muted-foreground text-xs leading-relaxed">
          هذا سجل إداري للقراءة فقط يوضح عمليات المزامنة والإعدادات.
        </p>
        {!canUseConvex && !isConvexAuthLoading ? (
          <p className="text-muted-foreground text-sm">سجّل الدخول لعرض سجل التدقيق.</p>
        ) : isConvexAuthLoading || auditEvents === undefined ? (
          <p className="text-muted-foreground text-sm">جاري تحميل سجل التدقيق…</p>
        ) : auditEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">لا توجد أحداث تدقيق بعد.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-amber-500/10">
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
      </Section>

      <Section title="إعدادات المنصة">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="حساب MT5" value="— (عرض)" />
          <Field label="الخادم" value="غير مُكوَّن" />
          <Field label="حالة الاتصال" value="غير متصل (واجهة)" />
          <Field label="وضع العرض" value="Demo" />
        </div>
      </Section>

      <Section title="إعدادات المخاطرة">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="مخاطرة بالدولار (عرض)" value="0 USD" />
          <Field label="حد أقصى يومي للصفقات" value="0" />
          <Field label="حد أقصى يومي للخسارة" value="0 USD" />
          <Field label="حد أقصى لنفس الزوج" value="0" />
        </div>
      </Section>

      <Section title="إعدادات الأزواج (واجهة)">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="الأزواج المفعّلة" value="EURUSD, XAUUSD (وهمي)" />
          <Field label="تفضيل الإطار الزمني" value="H1 / M15 (عرض)" />
          <Field label="الرموز الافتراضية" value="XAUUSD" />
        </div>
      </Section>

      <Section title="إعدادات الحوكمة">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Kill switch" value="غير متاح — عرض" />
          <Field label="تبريد بعد خسارة" value="— دقيقة" />
          <Field label="حد الخسائر المتتالية" value="—" />
        </div>
      </Section>

      <Section title="إعدادات الواجهة">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">معاينة السمة</span>
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/15 bg-black/25 px-3 py-2">
              <span className="text-muted-foreground text-xs">داكن مؤسسي</span>
              <Badge variant="outline" className="border-amber-500/25 text-amber-100">
                مفعّل (عرض)
              </Badge>
            </div>
          </div>
          <Field label="الكثافة" value="مريحة (افتراضي)" />
          <Field label="الاتجاه" value="RTL / العربية" />
        </div>
      </Section>

      <Section title="إعدادات التنبيهات">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Telegram ID" placeholder="@username أو معرف" />
          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">تفعيل التنبيهات</span>
            <div className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2">
              <span className="text-muted-foreground text-xs">بريد / دفع — معطّل</span>
              <Badge variant="secondary">معطّل</Badge>
            </div>
          </div>
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
