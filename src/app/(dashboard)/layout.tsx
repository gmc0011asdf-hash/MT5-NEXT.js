import { AppShell } from "@/components/layout/AppShell";
import { DashboardExperienceProviders } from "@/components/providers/dashboard-experience-providers";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardExperienceProviders>
      <AppShell>{children}</AppShell>
    </DashboardExperienceProviders>
  );
}
