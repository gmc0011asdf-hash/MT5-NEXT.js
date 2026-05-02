import { AlertCircle, BookOpen, Download } from "lucide-react";

export default function DecisionJournalPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-amber-500">سجل قرارات التحليل</h1>
          <p className="text-muted-foreground">جميع قرارات اللجان والتحليل ستظهر هنا لاحقاً</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            disabled 
            className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-500 opacity-50 cursor-not-allowed border border-amber-500/20"
          >
            <Download className="h-4 w-4" />
            تصدير التقرير — قريباً
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Read-only / لا يوجد تنفيذ تداول</p>
          <p className="opacity-80">هذه الواجهة مخصصة للعرض والمراقبة فقط. النظام لا ينفذ صفقات حقيقية من هذه الشاشة.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow">
        <div className="p-6">
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">لا توجد قرارات مسجلة</h3>
            <p className="text-sm max-w-sm mx-auto">لم تقم اللجان والوكلاء باتخاذ أي قرارات تحليلية بعد، أو أن الربط مع قاعدة البيانات غير مفعل في هذا الوضع (Placeholder).</p>
          </div>
          
          <div className="mt-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">الوقت</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">المنصة</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">الرمز</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">الفريم</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">الحالة</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">القرار</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">درجة الفرصة</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">سبب الدخول أو المنع</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">expires_at</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">next_review_at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border border-t border-border">
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground bg-muted/10">
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
