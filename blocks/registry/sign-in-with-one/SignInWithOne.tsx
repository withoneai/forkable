import { useOneConnect } from "@withone/connect/react";
import { oneFetch, useOneQuery } from "../lib/one-client";
import { Button } from "../lib/one-ui";

interface Status {
  configured: boolean;
  connected: boolean;
  connections: { platform: string; name: string }[];
}

/** The sign-in for a fork: one button, then who is connected and what they granted. */
export function SignInWithOne({ authorizeUrl = "/api/one/authorize" }: { authorizeUrl?: string }) {
  const status = useOneQuery<Status>("/api/one/status");
  const { open, status: flow } = useOneConnect({ authorizeUrl });
  const s = status.data;

  if (s?.connected) {
    return (
      <div data-block="sign-in-with-one" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {s.connections.map((x) => (
            <span key={x.platform} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-raised px-2 text-xs text-foreground">
              <img src={`https://assets.withone.ai/connectors/${x.platform}.svg`} alt="" className="size-3.5" />
              {x.name}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={open}>Change access</Button>
          <Button variant="ghost" onClick={() => oneFetch("/api/one/disconnect", { method: "POST" }).then(status.reload)}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-block="sign-in-with-one" className="flex flex-col items-start gap-2">
      <Button variant="primary" onClick={open} disabled={!s?.configured || flow === "connecting"} className="h-9 px-4">
        <OneMark />
        {flow === "connecting" ? "Opening One..." : "Sign in with One"}
      </Button>
      <p className="text-11 text-muted-foreground">
        {s && !s.configured ? "Add your Connect app to turn this on. Until then the components show the Acme sample." : "Secured by One. Connect your own accounts and revoke them any time."}
      </p>
    </div>
  );
}

function OneMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}
