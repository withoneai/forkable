import { Sparkles } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

// The home page ("/"). Replace this with the app's first real screen. Other
// pages live in src/routes, are listed in src/main.tsx and linked in src/lib/nav.ts.
export default function App() {
  return (
    <AppShell>
      <PageHeader title="Acme Inc" description="A new app for the Acme Inc team." />
      <EmptyState icon={Sparkles} title="Nothing here yet" description="The first screen of this app will show up here as soon as it is built." />
    </AppShell>
  );
}
