// Where the Sign in with One popup lands (returnTo=/connected): it tells the New
// profile sheet that opened it, then closes. Opened as a full tab it says so.
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";

export function Connected() {
  const inPopup = typeof window !== "undefined" && !!window.opener && window.opener !== window;
  useEffect(() => {
    if (!inPopup) return;
    try { window.opener.postMessage({ type: "search:signed-in" }, window.location.origin); } catch { /* the sheet polls anyway */ }
    const t = setTimeout(() => window.close(), 600);
    return () => clearTimeout(t);
  }, [inPopup]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-background"><Check className="size-4" /></span>
        <p className="text-15 font-semibold">Signed in</p>
        <p className="text-13 text-muted-foreground">{inPopup ? "This window closes by itself." : "You can close this tab and go back to Search."}</p>
        {!inPopup && <Link to="/" className="text-13 font-medium underline underline-offset-2">Open Search</Link>}
      </div>
    </div>
  );
}
