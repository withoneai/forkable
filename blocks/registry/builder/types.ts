// The shapes the Builder routes return and the Builder blocks render.

export interface CatalogAction { actionId: string; title: string; method: string; path: string; platform: string }
export interface CatalogDoc extends CatalogAction { knowledge: string }

export interface SourceFile { path: string; content: string }

export interface ManifestAction { platform: string; actionId: string; title: string | null; method: string | null; access: "read" | "write"; usedBy: string[] }
export interface Manifest { $schema: string; actions: ManifestAction[] }
export interface ScanIssue { code: "BLD003" | "BLD004" | "SECRET"; severity: "error" | "warning"; file: string; line: number; message: string }
export interface ManifestResponse { manifest: Manifest; issues: ScanIssue[]; files: number }

export interface PublishStep { step: "repo" | "blobs" | "tree" | "commit" | "branch"; status: "done" | "failed"; detail: string }
export interface PublishResponse { url: string | null; owner: string | null; repo: string; private: boolean; commit: string | null; steps: PublishStep[] }
