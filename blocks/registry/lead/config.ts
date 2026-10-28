import type { ProviderId } from "./types.js";

// Which data providers the waterfall may call, and what one hit costs you.
// This file is yours. Every provider ships off: reselling their data needs a
// contract with each one (Lead's research found none of them a clean yes),
// so turn one on only after you have it, and enter the unit cost from that
// contract. A provider with no cost never runs. Before Sign in with One is set
// up the blocks ignore this and run the Acme sample with sample costs.
export const leadConfig: { providers: Record<ProviderId, { enabled: boolean; unitCost: number | null }> } = {
  providers: {
    "people-data-labs": { enabled: false, unitCost: null },
    coresignal: { enabled: false, unitCost: null },
    findymail: { enabled: false, unitCost: null },
    hunter: { enabled: false, unitCost: null },
    clearout: { enabled: false, unitCost: null },
  },
};
