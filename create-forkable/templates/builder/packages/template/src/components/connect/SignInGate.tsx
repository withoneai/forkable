import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/me";
import { ConnectButton } from "./ConnectButton";

/**
 * Pages for signed-in people only (admin lists, anything showing other
 * people's data). Signed out, the page says so and offers Sign in instead of
 * an empty list or a 401. The API routes still check with requireUser(c).
 *
 *   <AppShell><SignInGate><Requests /></SignInGate></AppShell>
 */
export function SignInGate({ children, title = "Sign in to continue", description = "This page is for the Acme Inc team." }: { children: ReactNode; title?: string; description?: string }) {
  const me = useMe();
  if (me.isPending) return <Skeleton className="h-32 w-full" />;
  if (me.data?.user) return <>{children}</>;
  return (
    <div className="mx-auto mt-8 flex max-w-sm flex-col items-center rounded-lg border border-border bg-card px-6 py-10 text-center">
      <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-border bg-faint text-muted-foreground">
        <Lock className="size-4" />
      </div>
      <p className="text-15 font-semibold">{title}</p>
      <p className="mt-1 text-13 text-muted-foreground">{description}</p>
      <div className="mt-4">
        <ConnectButton />
      </div>
    </div>
  );
}
