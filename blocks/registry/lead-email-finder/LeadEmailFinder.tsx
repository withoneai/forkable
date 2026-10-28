import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import clsx from "clsx";
import { OneClientError, oneFetch, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { LeadReceipt } from "../lead/Receipt";
import { PROVIDER_LABELS, type EmailFindResponse, type EmailStatus, type VerifyResponse } from "../lead/types";

export interface LeadEmailFinderProps {
  defaults?: { name?: string; domain?: string };
  className?: string;
}

const STATUS: Record<EmailStatus, string> = { valid: "Valid", invalid: "Invalid", unknown: "Unknown", catch_all: "Catch-all domain", unverified: "Not verified" };

/** Find a work email from a name and domain, then verify it from its own button. */
export function LeadEmailFinder({ defaults = {}, className }: LeadEmailFinderProps) {
  const [name, setName] = useState(defaults.name ?? "");
  const [domain, setDomain] = useState(defaults.domain ?? "");
  const [found, setFound] = useState<{ data: EmailFindResponse; meta: OneMeta } | null>(null);
  const [verified, setVerified] = useState<{ data: VerifyResponse; meta: OneMeta } | null>(null);
  const [busy, setBusy] = useState<"find" | "verify" | null>(null);
  const [err, setErr] = useState<OneClientError | null>(null);

  const act = async (kind: "find" | "verify") => {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === "find") {
        setVerified(null);
        setFound(await oneFetch<EmailFindResponse>("/api/lead/email", { method: "POST", body: { name, domain } }));
      } else if (found?.data.email) {
        setVerified(await oneFetch<VerifyResponse>("/api/lead/verify", { method: "POST", body: { email: found.data.email } }));
      }
    } catch (e) {
      setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)));
    } finally {
      setBusy(null);
    }
  };
  const input = "h-8 min-w-0 flex-1 rounded-md border border-border bg-raised px-2.5 text-13 text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-strong focus:border-strong";

  return (
    <div data-block="lead-email-finder" className={clsx("flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && domain.trim()) act("find");
        }}
        className="flex items-center gap-2"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={input} />
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="company.com" className={input} />
        <Button type="submit" variant="primary" disabled={!name.trim() || !domain.trim() || !!busy}>
          {busy === "find" ? "Finding" : "Find email"}
        </Button>
      </form>
      {err && <ErrorState error={err} />}
      {busy === "find" && <Skeleton className="h-28 w-full" />}
      {found && busy !== "find" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-raised p-3">
            {found.data.email ? (
              <>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-mono text-13 text-foreground">{found.data.email}</span>
                  <span className="text-11 text-muted-foreground">
                    From {PROVIDER_LABELS[found.data.source!]}
                    {found.data.confidence !== null && `, ${Math.round(found.data.confidence * 100)}% confidence`}
                    {verified && ` · ${verified.data.status ? STATUS[verified.data.status] : "No definitive answer"}${verified.data.source ? ` per ${PROVIDER_LABELS[verified.data.source]}` : ""}`}
                  </span>
                </div>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <SourceChip meta={found.meta} />
                  {verified?.data.status === "valid" ? (
                    <span className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground">
                      <BadgeCheck className="size-3.5" />
                      Valid
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => act("verify")} disabled={!!busy} title="Checks the address with Clearout, then Hunter. A no-answer costs nothing.">
                      {busy === "verify" ? "Verifying" : verified ? "Verify again" : "Verify"}
                    </Button>
                  )}
                </span>
              </>
            ) : (
              <span className="text-13 text-muted-foreground">No email found. A miss costs nothing.</span>
            )}
          </div>
          <LeadReceipt receipt={found.data.receipt} />
          {verified && <LeadReceipt receipt={verified.data.receipt} />}
        </div>
      )}
    </div>
  );
}
