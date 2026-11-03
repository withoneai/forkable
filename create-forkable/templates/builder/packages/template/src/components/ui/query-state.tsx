import type { UseQueryResult } from "@tanstack/react-query";
import * as React from "react";
import { ErrorState } from "./error-state";
import { SkeletonRows } from "./skeleton";

/**
 * Loading, failed, empty and loaded, for one query, so no list is ever a
 * blank box or an endless spinner.
 *
 *   <QueryState query={notes} isEmpty={(d) => d.notes.length === 0}
 *     empty={<EmptyState icon={StickyNote} title="No notes yet" description="Notes you add show up here." action={<Button onClick={openNew}>New note</Button>} />}>
 *     {(d) => <List>{d.notes.map(...)}</List>}
 *   </QueryState>
 */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  loading,
  errorTitle,
  children,
}: {
  query: Pick<UseQueryResult<T>, "data" | "error" | "isPending" | "isError" | "refetch">;
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  /** What shows while loading (default: skeleton rows). */
  loading?: React.ReactNode;
  errorTitle?: string;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <>{loading ?? <SkeletonRows />}</>;
  if (query.isError) return <ErrorState title={errorTitle} error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data as T;
  if (isEmpty?.(data) && empty) return <>{empty}</>;
  return <>{children(data)}</>;
}
