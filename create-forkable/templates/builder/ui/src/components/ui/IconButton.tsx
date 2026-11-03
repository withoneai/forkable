import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "label"> {
  label: string;
  /** Shown after the label inside the tooltip, e.g. a key. */
  hint?: ReactNode;
  size?: "sm" | "md";
  tooltip?: boolean;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, hint, size = "md", tooltip = true, active, className, children, type = "button", ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100",
        "hover:bg-card-hover hover:text-foreground active:bg-muted disabled:pointer-events-none disabled:opacity-45",
        active && "bg-muted text-foreground",
        size === "sm" ? "size-6 [&>svg]:size-3.5 [&>svg]:stroke-[1.75]" : "size-7 [&>svg]:size-[16px] [&>svg]:stroke-[1.75]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip label={hint ? <>{label}<span className="ml-0.5 rounded-sm bg-background/20 px-1 font-normal opacity-90">{hint}</span></> : label}>
      {btn}
    </Tooltip>
  );
});
