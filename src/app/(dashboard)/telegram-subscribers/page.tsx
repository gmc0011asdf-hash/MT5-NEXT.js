"use client";

import { useState, useCallback, useEffect } from "react";
import { Users, RefreshCw, Ban, CheckCircle2 } from "lucide-react";

interface Subscriber {
  id: number;
  telegramUserId: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  isBlocked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastStartAt: string | null;
}

interface SubscribersResponse {
  ok: boolean;
  total: number;
  active: number;
  blocked: number;
  subscribers: Subscriber[];
  error?: string;
}

function statusBadge(s: Subscriber) {
  if (s.isBlocked) {
    return <span className="rounded border border-red-800 bg-red-950 px-2 py-0.5 text-xs text-red-400">محظور</span>;
  }
  if (s.isActive) {
    return <span className="rounded border border-green-700 bg-green-950 px-2 py-0.5 text-xs text-green-400">نشط</span>;
  }
  return <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">متوقف</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function TelegramSubscribersPage() {
  const [data, setData] = useState<SubscribersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingChatId, setActingChatId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/subscribers", { cache: "no-store" });
      const body: SubscribersResponse = await res.json();
      if (!body.ok) {
        setError(body.error ?? "تعذر تحميل قائمة المشتركين");
      }
      setData(body);
    } catch {
      setError("تعذر الاتصال بخدمة MT5 المحلية");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleBlock = useCallback(async (s: Subscriber) => {
    setActingChatId(s.chatId);
    setError(null);
    try {
      const endpoint = s.isBlocked ? "/api/telegram/subscribers/unblock" : "/api/telegram/subscribers/block";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: s.chatId }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? body.detail ?? "تعذر تنفيذ الإجراء");
        return;
      }
      await loadData();
    } catch {
      setError("تعذر الاتصال بخدمة MT5 المحلية");
    } finally {
      setActingChatId(null);
    }
  }, [loadData]);

  const subscribers = data?.subscribers ?? [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
            <Users className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">مشتركو بوت التوصيات</h1>
            <p className="text-xs text-muted-foreground">
              إدارة المشتركين في إشعارات وتوصيات نظام الملك الهندسي عبر تيليجرام
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-2 text-xs text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid gap-4 grid-cols-3">
          <div className="rounded-xl border border-green-800 bg-green-950/30 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-green-400">{data?.active ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">نشط</p>
          </div>
          <div className="rounded-xl border border-red-800 bg-red-950/30 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-red-400">{data?.blocked ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">محظور</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-slate-200">{data?.total ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">الإجمالي</p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">قائمة المشتركين</p>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              {loading ? "جاري التحديث..." : "تحديث"}
            </button>
          </div>

          {subscribers.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-500 py-6">
              لا يوجد مشتركون بعد — أرسل /start للبوت من حساب تيليجرام لتجربته
            </p>
          )}

          {subscribers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500">
                    <th className="p-2 text-right">الاسم</th>
                    <th className="p-2 text-right">المعرف</th>
                    <th className="p-2 text-right">Telegram ID</th>
                    <th className="p-2 text-right">الحالة</th>
                    <th className="p-2 text-right">آخر تفعيل</th>
                    <th className="p-2 text-right">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((s) => {
                    const fullName = [s.firstName, s.lastName].filter(Boolean).join(" ");
                    const acting = actingChatId === s.chatId;
                    return (
                      <tr key={s.chatId} className="border-b border-slate-800">
                        <td className="p-2 font-bold text-slate-200">{fullName || "—"}</td>
                        <td className="p-2 text-slate-400">{s.username ? `@${s.username}` : "—"}</td>
                        <td className="p-2 text-slate-400">{s.telegramUserId}</td>
                        <td className="p-2">{statusBadge(s)}</td>
                        <td className="p-2 text-slate-400">{formatDate(s.lastStartAt)}</td>
                        <td className="p-2">
                          <button
                            onClick={() => toggleBlock(s)}
                            disabled={acting}
                            className={
                              s.isBlocked
                                ? "flex items-center gap-1 rounded border border-green-700 px-2 py-1 text-green-400 hover:bg-green-950 disabled:opacity-50"
                                : "flex items-center gap-1 rounded border border-red-800 px-2 py-1 text-red-400 hover:bg-red-950 disabled:opacity-50"
                            }
                          >
                            {s.isBlocked ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                            {acting ? "..." : s.isBlocked ? "إلغاء الحظر" : "حظر"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600">
          ⚠️ هذه القائمة لإدارة الاشتراك في الإشعارات فقط وليست توصية مالية
        </p>
      </div>
    </div>
  );
}
