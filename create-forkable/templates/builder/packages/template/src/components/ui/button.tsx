import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** The one main action on a page or in a dialog. */
        default: "bg-foreground text-background hover:bg-foreground/85",
        accent: "bg-accent text-accent-foreground hover:bg-accent/90",
        /** Secondary actions next to the main one. */
        outline: "border border-border bg-card hover:bg-card-hover",
        /** Row actions, toolbars, icon buttons. */
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        /** Delete and other actions that cannot be undone (behind a ConfirmDialog). */
        destructive: "border border-border bg-card text-destructive-text hover:bg-destructive-text/8",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-13",
        lg: "h-9 px-4 text-sm",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and disables the button while a request runs. Keep the label (e.g. "Saving"). */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), loading && "[&>svg:not(.animate-spin)]:hidden", className)} disabled={asChild ? undefined : disabled || loading} aria-busy={loading || undefined} {...props}>
      {asChild ? children : (
        <>
          {loading && <Loader2 className="animate-spin" />}
          {children}
        </>
      )}
    </Comp>
  );
});
Button.displayName = "Button";
