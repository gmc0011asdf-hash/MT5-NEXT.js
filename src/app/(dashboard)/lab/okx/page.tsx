import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { institutionalCardClass } from "@/lib/ui-institutional";

export default function OkxLabPlaceholder() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">مختبر OKX</h2>
        <p className="label-secondary mt-1">بيئة تحليل OKX المعزولة — قيد التأسيس.</p>
      </div>

      <Alert className="border-amber-500/20 bg-amber-500/5">
        <AlertTitle>تنبيه</AlertTitle>
        <AlertDescription>
          OKX Lab — Read-only placeholder, no live execution
        </AlertDescription>
      </Alert>

      <Card className={institutionalCardClass("p-4")}>
        <CardHeader className="space-y-2 p-0">
          <CardTitle className="card-title-inst text-base">حالة النظام</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            هذه الصفحة هي مجرد عنصر نائب (Placeholder). لا يوجد أي كود تنفيذ صفقات أو اتصال حقيقي.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 p-0 pt-3">
          <p className="text-sm text-muted-foreground">التكامل مع OKX لم يبدأ بعد. سيتم بناء هذا المسار في مرحلة لاحقة بشكل معزول تماماً عن MT5.</p>
        </CardContent>
      </Card>
    </div>
  );
}
