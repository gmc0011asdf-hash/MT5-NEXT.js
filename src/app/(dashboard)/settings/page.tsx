import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { institutionalCardClass } from "@/lib/ui-institutional";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">الإعدادات</h2>
        <p className="label-secondary mt-1">حقول معطّلة — قيم تجريبية للعرض فقط.</p>
        <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-amber-100/90 text-sm">
          إعدادات عرض فقط في هذه النسخة الأولية.
        </p>
      </div>

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

      <Section title="إعدادات الأزواج">
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
