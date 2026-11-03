import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Me {
  user: { id: string; name: string | null; email: string | null } | null;
  /** "connect": One Connect is on for this app. "off": no One login. */
  mode: "connect" | "off";
  /** "sample" on the keyless sample One. */
  grant?: "one" | "sample" | null;
  /** True once this app's own Connect app is set up. */
  canSignIn: boolean;
  /** Preview only, before One Connect is set up: user is a local stand-in, not a One sign-in. */
  previewUser?: boolean;
}

/** The signed-in user (null when signed out). One query, shared by every component that asks. */
export function useMe() {
  return useQuery({ queryKey: ["one", "me"], queryFn: () => api<Me>("/api/one/me"), staleTime: 60_000 });
}

/** "Avery Chen" -> "AC", "You (preview)" -> "YP". */
export function initials(name: string | null | undefined, email?: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
