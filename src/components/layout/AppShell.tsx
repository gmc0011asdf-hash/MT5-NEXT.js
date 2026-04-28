import type { ReactNode } from "react";

import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar } from "@/components/layout/AppSidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-background">
      <AppSidebar />
      <main className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-hidden mr-72">
        <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-1 flex-col">
          <AppHeader />
          <div className="flex min-w-0 flex-1 flex-col p-4 md:p-6 lg:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
