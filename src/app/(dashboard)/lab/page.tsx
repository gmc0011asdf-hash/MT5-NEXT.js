import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockSignals } from "@/lib/constants/mock-data";
import { institutionalCardClass } from "@/lib/ui-institutional";
import type { LabUiPhase } from "@/lib/types/trading";

function phaseBadge(phase: LabUiPhase) {
  switch (phase) {
    case "READY":
      return <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">READY</Badge>;
    case "WAITING":
      return <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-100">WAITING</Badge>;
    case "HOLD":
      return <Badge className="border-slate-500/40 bg-slate-500/15 text-slate-200">HOLD</Badge>;
    case "BLOCKED":
      return <Badge className="border-rose-500/35 bg-rose-500/10 text-rose-200">BLOCKED</Badge>;
    default:
      return null;
  }
}

export default function LabPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">المختبر المؤسسي</h2>
        <p className="label-secondary mt-1">جدول تجريبي — بدون أزرار تنفيذ.</p>
      </div>

      <Alert className="border-amber-500/20 bg-amber-500/5">
        <AlertTitle>تنبيه</AlertTitle>
        <AlertDescription>
          هذه نسخة واجهة Next.js للعرض والقراءة فقط، التنفيذ ما زال غير مفعل هنا.
        </AlertDescription>
      </Alert>

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">إشارات المختبر (وهمية)</CardTitle>
          <p className="text-muted-foreground text-xs">لا تنفيذ — رموز الحالة للعرض فقط.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          <Table>
            <TableHeader>
              <TableRow className="border-amber-500/10 hover:bg-transparent">
                <TableHead className="text-foreground">الزوج</TableHead>
                <TableHead className="text-foreground">الحكم</TableHead>
                <TableHead className="text-foreground">الاحتمالية</TableHead>
                <TableHead className="text-foreground">الحالة</TableHead>
                <TableHead className="text-foreground">مرحلة العرض</TableHead>
                <TableHead className="text-foreground">الإطار</TableHead>
                <TableHead className="text-foreground">السبب</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockSignals.map((row) => (
                <TableRow key={row.id} className="border-border/60">
                  <TableCell className="font-medium text-amber-100/90 tabular-nums">{row.pair}</TableCell>
                  <TableCell>{row.verdict}</TableCell>
                  <TableCell className="tabular-nums">{(row.probability * 100).toFixed(0)}٪</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.status}</TableCell>
                  <TableCell>{phaseBadge(row.labPhase)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{row.timeframe}</TableCell>
                  <TableCell className="max-w-[220px] text-muted-foreground text-xs leading-snug">
                    {row.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
