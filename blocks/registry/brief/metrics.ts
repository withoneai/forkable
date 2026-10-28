import { ENGINES, type Brand, type Competitor, type EngineId, type ReportResponse, type Run } from "./types.js";

// Brief's metrics (reoz docs/SPEC.md section 4, packages/core/src/metrics.ts),
// pure functions over judged runs. Visibility is per engine, then averaged,
// so an engine that ran more never dominates. Share of voice is summed over
// the period and divided once, never a mean of daily ratios.

const round1 = (n: number) => Math.round(n * 10) / 10;
const anyMentioned = (r: Run) => r.mentioned || Object.values(r.competitors).some(Boolean);

function perEngineMean(runs: Run[], ratio: (rows: Run[]) => number | null): number | null {
  const vals: number[] = [];
  for (const e of ENGINES) {
    const rows = runs.filter((r) => r.engine === e);
    const v = rows.length ? ratio(rows) : null;
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Runs naming the brand / runs naming any tracked asset, per engine then averaged. 0..100. */
export function visibilityScore(runs: Run[]): number {
  const v = perEngineMean(runs, (rows) => {
    const den = rows.filter(anyMentioned);
    return den.length ? den.filter((r) => r.mentioned).length / den.length : null;
  });
  return v === null ? 0 : round1(v * 100);
}

const ORDER = { first: 1, listed: 2, buried: 3, not_mentioned: null } as const;
export function averagePosition(runs: Run[]): number | null {
  const v = perEngineMean(runs, (rows) => {
    const o = rows.filter((r) => r.mentioned).map((r) => ORDER[r.position]).filter((x): x is 1 | 2 | 3 => x !== null);
    return o.length ? o.reduce((a, b) => a + b, 0) / o.length : null;
  });
  return v === null ? null : Math.round(v * 100) / 100;
}

const isOwned = (domain: string, own: string) => domain === own || domain.endsWith(`.${own}`);

export function report(runs: Run[], brand: Brand, competitors: Competitor[]): ReportResponse {
  const days = [...new Set(runs.map((r) => r.day))].sort();
  let brandCount = 0;
  const comp: Record<string, number> = Object.fromEntries(competitors.map((c) => [c.id, 0]));
  for (const r of runs) {
    if (r.mentioned) brandCount++;
    for (const c of competitors) if (r.competitors[c.id]) comp[c.id]!++;
  }
  const total = brandCount + Object.values(comp).reduce((a, b) => a + b, 0);
  const pct = (n: number) => (total ? round1((n / total) * 100) : 0);
  const shareOfVoice = [{ id: "brand", name: brand.name, share: pct(brandCount), isBrand: true }, ...competitors.map((c) => ({ id: c.id, name: c.name, share: pct(comp[c.id]!), isBrand: false }))].sort((a, b) => b.share - a.share);

  const byDomain = new Map<string, Map<string, number>>();
  let cited = 0;
  for (const r of runs)
    for (const c of r.citations) {
      cited++;
      const pages = byDomain.get(c.domain) ?? new Map<string, number>();
      pages.set(c.url, (pages.get(c.url) ?? 0) + 1);
      byDomain.set(c.domain, pages);
    }
  const citations = [...byDomain.entries()]
    .map(([domain, pages]) => {
      const count = [...pages.values()].reduce((a, b) => a + b, 0);
      return {
        domain,
        count,
        share: cited ? round1((count / cited) * 100) : 0,
        owned: isOwned(domain, brand.domain),
        competitor: competitors.find((c) => isOwned(domain, c.domain))?.name ?? null,
        pages: [...pages.entries()].map(([url, n]) => ({ url, count: n })).sort((a, b) => b.count - a.count).slice(0, 5),
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    brand,
    competitors,
    runs: runs.length,
    prompts: new Set(runs.map((r) => r.promptId)).size,
    days,
    visibility: visibilityScore(runs),
    perEngine: ENGINES.map((engine: EngineId) => {
      const rows = runs.filter((r) => r.engine === engine);
      return { engine, visibility: visibilityScore(rows), runs: rows.length };
    }).filter((e) => e.runs > 0),
    shareOfVoice,
    trend: days.map((day) => ({ day, brand: visibilityScore(runs.filter((r) => r.day === day)) })),
    averagePosition: averagePosition(runs),
    citations,
  };
}
