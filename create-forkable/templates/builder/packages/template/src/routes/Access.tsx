import { AccessPanel } from "@/components/connect/AccessPanel";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";

/** Connected tools for the signed-in user. */
export default function Access() {
  return (
    <AppShell width="narrow">
      <PageHeader title="Connected tools" description="The accounts this app works with." />
      <AccessPanel />
    </AppShell>
  );
}
