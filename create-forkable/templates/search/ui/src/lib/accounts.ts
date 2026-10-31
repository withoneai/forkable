// Two accounts on one platform (two Gmails): the accounts Search indexes, from the
// sources list, and the short label that tells them apart everywhere in the UI.
import { useMemo } from "react";
import type { ApiSource } from "@/contract/api-types";
import { useSources } from "@/lib/queries";

export interface Account { platform: string; label: string; short: string; mark: string; sourceIds: string[]; items: number }

/** "dana@acme.com" next to "dana@acme.dev" is "acme.com"; next to "sam@acme.com" it is "dana". */
export function shortAccount(label: string, siblings: string[]): string {
  const [local, domain] = label.includes("@") ? [label.split("@")[0]!, label.split("@")[1]!] : [label, ""];
  const others = siblings.filter((s) => s !== label);
  if (!domain || !others.length) return label;
  const sameLocal = others.some((o) => o.split("@")[0] === local);
  return sameLocal ? domain : local;
}

/** The letter for an account's mark: where its short label first differs from its siblings' ("acme.com" vs "acme.dev": C and D). */
export function markFor(label: string, siblings: string[]): string {
  const shorts = siblings.map((s) => shortAccount(s, siblings));
  const me = shortAccount(label, siblings);
  const others = shorts.filter((s) => s !== me);
  if (!others.length) return me.replace(/[^a-z0-9]/gi, "")[0] ?? "?";
  let i = 0;
  while (i < me.length && others.every((o) => o[i] === me[i])) i++;
  const rest = me.slice(i).replace(/[^a-z0-9]/gi, "");
  return (rest[0] ?? me[0] ?? "?").toUpperCase();
}

export function accountsOf(sources: ApiSource[]): Map<string, Account[]> {
  const by = new Map<string, Map<string, Account>>();
  for (const s of sources) {
    if (s.health.status === "awaiting_grant") continue;
    const m = by.get(s.platform) ?? new Map<string, Account>();
    const a = m.get(s.connectionLabel) ?? { platform: s.platform, label: s.connectionLabel, short: s.connectionLabel, mark: "", sourceIds: [], items: 0 };
    a.sourceIds.push(s.id);
    a.items += s.health.itemCount;
    m.set(s.connectionLabel, a);
    by.set(s.platform, m);
  }
  const out = new Map<string, Account[]>();
  for (const [p, m] of by) {
    const list = [...m.values()];
    for (const a of list) { a.short = shortAccount(a.label, list.map((x) => x.label)); a.mark = markFor(a.label, list.map((x) => x.label)); }
    out.set(p, list);
  }
  return out;
}

/** Accounts per platform; `multi` only lists platforms with two or more. */
export function useAccounts(): { byPlatform: Map<string, Account[]>; multi: Account[]; isMulti: (platform: string) => boolean; find: (platform: string, label: string) => Account | undefined } {
  const q = useSources();
  return useMemo(() => {
    const byPlatform = accountsOf(q.data?.sources ?? []);
    const multi = [...byPlatform.values()].filter((l) => l.length > 1).flat();
    return {
      byPlatform, multi,
      isMulti: (p: string) => (byPlatform.get(p)?.length ?? 0) > 1,
      find: (p: string, label: string) => byPlatform.get(p)?.find((a) => a.label === label),
    };
  }, [q.data]);
}
