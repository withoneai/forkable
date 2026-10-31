// The browser-safe types of docs/CONTRACT.md (sections 4, 6.1, 7), straight
// from @search/core. Types only: nothing from core runs in the browser here
// except query/parse (see ./query.ts).
export type * from "@search/core/api-types";
export type * from "@search/core/contract";
