import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockDecisionReport } from "@/lib/constants/mock-data";
import { institutionalCardClass } from "@/lib/ui-institutional";

export default function ReportsPage() {
  const r = mockDecisionReport;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">التقارير</h2>
        <p className="label-secondary mt-1">بطاقات عرض — بيانات آمنة وغير حية. لا ضمانات ربح.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className={institutionalCardClass("p-4 md:col-span-2")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">القرار المؤسسي</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0">
            <p className="text-muted-foreground text-sm">{r.title}</p>
            <p className="border-t border-amber-500/10 pt-2 text-foreground text-sm leading-relaxed">
              {r.mainReason}
            </p>
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">السبب الرئيسي</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm leading-relaxed">{r.mainReason}</CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">عوامل الدعم</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="list-inside list-disc space-y-1.5 text-muted-foreground text-sm leading-relaxed">
              {r.supportFactors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">عوامل المنع</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="list-inside list-disc space-y-1.5 text-muted-foreground text-sm leading-relaxed">
              {r.blockFactors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">خطة الصفقة</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm leading-relaxed">{r.tradePlan}</CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4 md:col-span-2")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">ملاحظة الثقة</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm leading-relaxed">{r.confidenceNote}</CardContent>
        </Card>
      </div>
    </div>
  );
}
