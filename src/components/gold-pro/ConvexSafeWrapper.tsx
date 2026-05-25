// src/components/gold-pro/ConvexSafeWrapper.tsx
// Error Boundary — يحمي الصفحة من أخطاء Convex (plan limits, network errors)
"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ConvexSafeWrapper extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, message: msg };
  }

  render() {
    if (this.state.hasError) {
      const isPlanLimit = this.state.message.includes("exceeded") || this.state.message.includes("disabled");
      return this.props.fallback ?? (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
          <p className="text-sm text-slate-400">📊 التاريخ والإحصاءات غير متاحة مؤقتاً</p>
          {isPlanLimit ? (
            <p className="mt-1 text-xs text-yellow-600">
              ⚠️ تم تجاوز حد الخطة المجانية لـ Convex — يمكن الترقية على{" "}
              <span className="text-yellow-500">dashboard.convex.dev</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-600">خطأ في الاتصال بقاعدة البيانات</p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
