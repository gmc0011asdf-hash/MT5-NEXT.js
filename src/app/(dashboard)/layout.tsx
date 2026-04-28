import { AppShell } from "@/components/layout/AppShell";
import { DashboardExperienceProviders } from "@/components/providers/dashboard-experience-providers";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardExperienceProviders>
      <div className="min-h-dvh">
        <AppShell>{children}</AppShell>
      </div>
    </DashboardExperienceProviders>
  );
}
