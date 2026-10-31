import { Component, type ReactNode } from "react";

/**
 * Catches a render error so one bad row shows a message with Reload
 * instead of turning the whole app black.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[search] render error", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-15 font-semibold">Something on this page failed to load.</p>
        <p className="max-w-md text-13 text-muted-foreground">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="squircle h-8 rounded-md border border-border bg-card px-3 text-13 transition-colors hover:bg-card-hover"
        >
          Reload
        </button>
      </div>
    );
  }
}
