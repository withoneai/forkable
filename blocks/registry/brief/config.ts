import type { Brand, Competitor } from "./types.js";

// The brand you track and who you compare it with. This file is yours: edit
// it, or load it from your own settings. Until Sign in with One is set up the
// blocks use the Acme Inc sample and ignore this.
export const briefConfig: { brand: Brand; competitors: Competitor[] } = {
  brand: { name: "Your brand", domain: "example.com", aliases: [] },
  competitors: [],
};
