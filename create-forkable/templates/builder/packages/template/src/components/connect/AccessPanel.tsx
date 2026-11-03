import { ShieldCheck } from "lucide-react";
import { ConnectButton } from "./ConnectButton";

/** What this app can reach on the user's behalf, and the button to grant it. */
export function AccessPanel() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-faint text-muted-foreground">
        <ShieldCheck className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-13 font-semibold">Your connected tools</p>
        <p className="mt-0.5 text-13 text-muted-foreground">Connect the tools this app works with. Secured by One, and you can revoke access any time.</p>
      </div>
      <ConnectButton />
    </div>
  );
}
