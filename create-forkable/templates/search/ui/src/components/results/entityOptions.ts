import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe } from "@/lib/queries";

export interface EntityOption { id: string; name: string; short: string; type: "person" | "company"; self: boolean }

/** People and companies for the From / With chips: GET /entities, both types. */
export function useEntityOptions(): EntityOption[] {
  const people = useQuery({ queryKey: ["entities", "person"], queryFn: () => api.entities("", "person"), staleTime: 60_000 });
  const companies = useQuery({ queryKey: ["entities", "company"], queryFn: () => api.entities("", "company"), staleTime: 60_000 });
  const me = useMe().data?.user;
  const out: EntityOption[] = [];
  for (const p of people.data ?? []) out.push({ id: p.id, name: p.name, short: p.name.split(" ")[0]!.toLowerCase(), type: "person", self: !!me && (p.name === me.name || p.subtitle === me.email) });
  for (const c of companies.data ?? []) out.push({ id: c.id, name: c.name, short: c.subtitle && /\.[a-z]{2,}$/.test(c.subtitle) ? c.subtitle : c.name.toLowerCase().replace(/\s+/g, "-"), type: "company", self: !!me?.email && !!c.subtitle && me.email.endsWith(`@${c.subtitle}`) });
  return out;
}
