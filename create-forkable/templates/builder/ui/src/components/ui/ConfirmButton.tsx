import { useEffect, useState } from "react";
import { Button, type ButtonProps } from "./Button";

/** First click arms, second click within 4s confirms. Esc or blur disarms. */
export function ConfirmButton({ onConfirm, children, confirmLabel = "Click again to confirm", variant = "default", ...rest }:
  Omit<ButtonProps, "onClick"> & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      {...rest}
      variant={armed ? "destructive" : variant}
      aria-live="polite"
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => { if (e.key === "Escape") setArmed(false); }}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
