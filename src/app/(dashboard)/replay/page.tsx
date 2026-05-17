import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { institutionalCardClass } from "@/lib/ui-institutional";

const MOCK_STATS = [
  { label: "إجمالي القرارات", value: "0", hint: "عرض فقط" },
  { label: "READY", value: "0", hint: "—" },
  { label: "WAITING", value: "0", hint: "—" },
  { label: "TP / SL", value: "— / —", hint: "لا بيانات" },
  { label: "Avg R", value: "—", hint: "لا حساب حي" },
];

export default function ReplayPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">اختبار Replay</h2>
        <p className="label-secondary mt-1">لا يوجد اتصال حقيقي في هذه النسخة الأولية.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MOCK_STATS.map((s) => (
          <Card key={s.label} className={institutionalCardClass("p-3")}>
            <CardHeader className="p-0 pb-1">
              <CardTitle className="text-muted-foreground text-xs font-medium">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <p className="price-figure text-foreground">{s.value}</p>
              <p className="mt-1 text-muted-foreground text-[11px]">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertNote />

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">بيانات OHLC (JSON)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4 md:px-6">
          <Textarea
            readOnly
            dir="ltr"
            className="min-h-[220px] resize-y font-mono text-xs leading-relaxed md:min-h-[280px]"
            placeholder='{"bars": []}'
            defaultValue=""
          />
          <Button type="button" disabled variant="outline" className="border-amber-500/25">
            تشغيل Replay (معطّل)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AlertNote() {
  return (
    <p className="rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-rose-100/90 text-sm leading-relaxed">
      Replay لا يتصل بـ MT5 ولا يرسل أوامر.
    </p>
  );
}
