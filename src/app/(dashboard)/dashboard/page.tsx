import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardActivitySection } from "@/components/dashboard/DashboardActivitySection";
import { DashboardHeaderSummary } from "@/components/dashboard/DashboardHeaderSummary";
import { DashboardSystemCards } from "@/components/dashboard/DashboardSystemCards";
import { LiveMarketTicker } from "@/components/dashboard/LiveMarketTicker";
import { mockSignals } from "@/lib/constants/mock-data";
import { institutionalCardClass } from "@/lib/ui-institutional";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <DashboardHeaderSummary />

      <section className="space-y-3">
        <h3 className="page-title">لوحة التحكم</h3>
        <p className="label-secondary">ملخص مؤسسي — بيانات السوق أدناه وهمية للواجهة فقط.</p>
      </section>

      <LiveMarketTicker />

      <section className="space-y-3">
        <h3 className="card-title-inst text-foreground">حالة الأنظمة</h3>
        <DashboardSystemCards />
      </section>

      <DashboardActivitySection />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">حالة الحساب</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">
            وضع تجريبي — لا أرصدة حية ولا اتصال وسيط.
          </CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">قرارات اليوم</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">0 قرارات — لا مسار تنفيذ.</CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">المخاطر اليومية</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">حدود افتراضية للعرض فقط.</CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4 md:col-span-2 xl:col-span-3")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">لمحة من المختبر</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-sm">
            {mockSignals.slice(0, 2).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/10 bg-muted/20 px-3 py-2"
              >
                <span className="font-medium text-amber-100/90 tabular-nums">{s.pair}</span>
                <span className="text-muted-foreground">{s.verdict}</span>
                <span className="text-muted-foreground text-xs tabular-nums">{s.timeframe}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Alert className="border-amber-500/25 bg-amber-500/5">
        <AlertTitle>تنبيه أمان</AlertTitle>
        <AlertDescription>
          هذه الواجهة للقراءة والمراقبة فقط ولا ترسل أوامر تداول. بيانات الأسعار أعلاه تيار وهمي للعرض.
        </AlertDescription>
      </Alert>
    </div>
  );
}
