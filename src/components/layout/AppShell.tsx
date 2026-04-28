import type { ReactNode } from "react";

import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar } from "@/components/layout/AppSidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh w-full flex-row overflow-x-hidden">
      <div className="sticky top-0 h-dvh shrink-0 overflow-y-auto">
        <AppSidebar />
      </div>
      <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <AppHeader />
        <div className="flex flex-1 flex-col p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
