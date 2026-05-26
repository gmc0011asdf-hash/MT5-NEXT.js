"use client";

import { useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { Button } from "@/components/ui/button";
import { api } from "../../../../convex/_generated/api";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { ConvexSafeWrapper } from "@/components/gold-pro/ConvexSafeWrapper";

function ConvexTestPageContent() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const events = useQuery(
    api.testEvents.listTestEvents,
    canUseConvex ? {} : "skip",
  );
  const latestEvent = useQuery(
    api.testEvents.latestTestEvent,
    canUseConvex ? {} : "skip",
  );
  const createTestEvent = useMutation(api.testEvents.createTestEvent);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const buttonDisabled = isConvexAuthLoading || !isAuthenticated || pending;

  async function handleSend() {
    if (isConvexAuthLoading || !isAuthenticated) {
      setMessage("يجب تسجيل الدخول أولًا لاختبار Convex");
      return;
    }
    setMessage(null);
    setPending(true);
    try {
      await createTestEvent({
        title: "حدث اختبار من لوحة التحكم",
        source: "convex-test",
      });
      setMessage("تم إرسال الحدث بنجاح.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "تعذر إكمال العملية. حاول مرة أخرى بعد تسجيل الدخول.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4" dir="rtl">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-200/90 text-sm font-medium">
        ⚠️ [تجريبي — أدوات التطوير فقط] هذه الصفحة مخصصة لبيئة التطوير ولا تظهر في الإنتاج.
      </div>
      <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/5 px-4 py-2 text-zinc-300/80 text-xs">
        Convex usage guard: التحديث التلقائي محدود في التطوير — البيانات المعروضة تحديث مباشر خفيف فقط.
      </div>
      <div>
        <h1 className="font-semibold text-2xl text-foreground">اختبار Convex</h1>
        <p className="text-muted-foreground text-sm">قراءة وكتابة تجريبية عبر بيانات مصادقة Clerk + Convex</p>
      </div>

      <div className={institutionalCardClass("space-y-2 p-4")}>
        <h2 className="font-medium text-amber-100/90">حالة المصادقة</h2>
        {isConvexAuthLoading && (
          <p className="text-muted-foreground text-sm">جاري ربط جلسة الدخول مع Convex...</p>
        )}
        {!isConvexAuthLoading && !isAuthenticated && (
          <p className="text-amber-200/90 text-sm">يرجى تسجيل الدخول لاستخدام اختبار Convex</p>
        )}
        {canUseConvex && isLoaded && isSignedIn && user && (
          <p className="text-foreground text-sm">
            مسجّل الدخول: {user.emailAddresses[0]?.emailAddress ?? user.id}
          </p>
        )}

        <div className="mt-2 rounded-md border border-amber-900/40 bg-black/20 p-2 font-mono text-[11px] leading-relaxed text-amber-100/80">
          <div>Clerk — محمّل: {String(isLoaded)} · مسجّل: {String(isSignedIn)}</div>
          <div>Convex — تحميل المصادقة: {String(isConvexAuthLoading)} · مصادق: {String(isAuthenticated)}</div>
        </div>
      </div>

      <div className={institutionalCardClass("flex flex-col gap-3 p-4")}>
        <h2 className="font-medium text-amber-100/90">إرسال اختبار</h2>
        <Button
          type="button"
          size="default"
          disabled={buttonDisabled}
          onClick={() => void handleSend()}
        >
          إرسال اختبار إلى Convex
        </Button>
        {message && (
          <p
            className={
              message.startsWith("تم")
                ? "text-emerald-300/95 text-sm"
                : "text-rose-300/95 text-sm"
            }
          >
            {message}
          </p>
        )}
        {latestEvent && canUseConvex && (
          <p className="text-muted-foreground text-sm">
            أحدث سجل:{" "}
            <span className="text-amber-100/90 tabular-nums">
              {new Date(latestEvent.createdAt).toLocaleString("ar-SA", { hour12: false })}
            </span>
            {" · "}
            {latestEvent.title}
          </p>
        )}
        <p className="text-muted-foreground text-xs leading-relaxed">
          إذا ظهرت هنا وداخل لوحة تحكم Convex فهي محفوظة في قاعدة بيانات Convex.
        </p>
      </div>

      {canUseConvex && events !== undefined && (
        <div className={institutionalCardClass("p-4")}>
          <h2 className="mb-2 font-medium text-amber-100/90">السجل (أحدث أولاً)</h2>
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">لا توجد أحداث بعد.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-foreground text-sm">
              {events.map((row) => (
                <li key={row._id} className="text-xs sm:text-sm">
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(row.createdAt).toLocaleString("ar-SA", { hour12: false })}
                  </span>{" "}
                  — {row.title} <span className="text-amber-200/70">({row.source})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConvexTestPage() {
  return (
    <ConvexSafeWrapper>
      <ConvexTestPageContent />
    </ConvexSafeWrapper>
  );
}
