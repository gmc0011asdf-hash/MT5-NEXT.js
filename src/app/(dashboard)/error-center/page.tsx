import { AlertTriangle, Download, ShieldAlert } from "lucide-react";

export default function ErrorCenterPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-amber-500">
            مركز الأخطاء
          </h1>
          <p className="text-muted-foreground">
            تجميع أخطاء النظام والتنبيهات التشغيلية
          </p>
        </div>
        <button
          disabled
          className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-500 opacity-50 cursor-not-allowed"
        >
          <Download className="h-4 w-4" />
          تصدير سجل الأخطاء — قريباً
        </button>
      </div>

      {/* Placeholder banner */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Placeholder فقط — لا يوجد ربط حقيقي</p>
          <p className="opacity-80">
            هذه الواجهة مخصصة للعرض التصميمي فقط. ربط سجل الأخطاء الحقيقي سيتم في مرحلة لاحقة.
          </p>
        </div>
      </div>

      {/* Error table */}
      <div className="rounded-xl border border-border bg-card shadow">
        <div className="p-6">
          {/* Empty state */}
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <ShieldAlert className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">
              لا توجد أخطاء مسجلة
            </h3>
            <p className="text-sm max-w-sm mx-auto">
              لم يتم تسجيل أي أخطاء تشغيلية بعد، أو أن الربط مع النظام الحقيقي غير مفعّل في هذه المرحلة (Placeholder).
            </p>
          </div>

          {/* Table skeleton */}
          <div className="mt-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    الوقت
                  </th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    المصدر
                  </th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    المستوى
                  </th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    الرسالة
                  </th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    الحالة
                  </th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    الإجراء المقترح
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border border-t border-border">
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted-foreground bg-muted/10"
                  >
                    البيانات غير متاحة (Placeholder)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
