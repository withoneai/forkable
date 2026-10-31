// Next-page parameters per Pagination type (ported from the One CLI's pagination.ts, plus
// hasMore on cursors, page, relay and nextUrl). Returns null to stop.

import type { Pagination } from "../contract.js";
import { getPath } from "../expr/path.js";
import { applyParam, queryFromUrl, type BuiltRequest } from "./request.js";

export interface PageState { page: number; offset: number; pageSize: number | null }

export interface NextPage {
  /** Value sent for the next page (also the fixture cursor). */
  cursor: string;
  apply(req: BuiltRequest): void;
}

function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

export function nextPage(pg: Pagination, data: unknown, state: PageState, items: unknown[]): NextPage | null {
  switch (pg.type) {
    case "none":
    case "linkHeader": // runAction exposes no response headers (0.19.0): single page
      return null;
    case "cursor": {
      if (pg.hasMore !== undefined) {
        const hm = truthy(getPath(data, pg.hasMore));
        if (pg.hasMoreInverted ? hm : !hm) return null;
      }
      const next = getPath(data, pg.next);
      if (next === undefined || next === null || next === "") return null;
      const v = String(next);
      return { cursor: v, apply: (r) => applyParam(r, pg.passAs, v) };
    }
    case "offset": {
      if (items.length === 0) return null;
      if (pg.hasMore !== undefined && !truthy(getPath(data, pg.hasMore))) return null;
      let next: number;
      if (pg.nextPath !== undefined) {
        const n = getPath(data, pg.nextPath);
        if (n === undefined || n === null || n === "") return null;
        next = Number(n);
      } else next = state.offset + items.length;
      if (pg.total !== undefined) {
        const total = Number(getPath(data, pg.total));
        if (Number.isFinite(total) && next >= total) return null;
      }
      if (pg.hasMore === undefined && pg.nextPath === undefined && state.pageSize !== null && items.length < state.pageSize) return null;
      return { cursor: String(next), apply: (r) => applyParam(r, pg.passAs, next) };
    }
    case "page": {
      if (items.length === 0) return null;
      const start = pg.start ?? 1;
      const nextPageNo = start + state.page + 1;
      if (pg.totalPages !== undefined) {
        const tp = Number(getPath(data, pg.totalPages));
        if (Number.isFinite(tp) && nextPageNo > tp - (start === 0 ? 1 : 0)) return null;
      } else if (state.pageSize !== null && items.length < state.pageSize) return null;
      return { cursor: String(nextPageNo), apply: (r) => applyParam(r, pg.passAs, nextPageNo) };
    }
    case "lastId": {
      if (items.length === 0) return null;
      if (pg.hasMore !== undefined && !truthy(getPath(data, pg.hasMore))) return null;
      const last = getPath(items[items.length - 1], pg.idPath);
      if (last === undefined || last === null) return null;
      const v = String(last);
      return { cursor: v, apply: (r) => applyParam(r, pg.passAs, v) };
    }
    case "relay": {
      if (!truthy(getPath(data, pg.hasNextPage))) return null;
      const c = getPath(data, pg.endCursor);
      if (c === undefined || c === null || c === "") return null;
      const v = String(c);
      return { cursor: v, apply: (r) => applyParam(r, pg.passAs, v) };
    }
    case "nextUrl": {
      const url = getPath(data, pg.next);
      if (typeof url !== "string" || !url) return null;
      return { cursor: url, apply: (r) => { r.query = queryFromUrl(url); } };
    }
  }
}

/** Re-applies a saved cursor value (resume after a failed page). */
export function applyCursor(pg: Pagination, req: BuiltRequest, cursor: string): void {
  switch (pg.type) {
    case "cursor": case "lastId": case "relay": return applyParam(req, pg.passAs, cursor);
    case "offset": case "page": return applyParam(req, pg.passAs, Number(cursor));
    case "nextUrl": req.query = queryFromUrl(cursor); return;
    default: return;
  }
}
