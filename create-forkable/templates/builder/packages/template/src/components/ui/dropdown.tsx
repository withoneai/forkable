import { DropdownMenu as M } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dropdown = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        className={cn("pop-in z-50 min-w-40 rounded-md border border-border bg-card p-1 shadow-pop", className)}
        {...props}
      />
    </M.Portal>
  );
}
export function DropdownItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex h-7 select-none items-center gap-2 rounded-sm px-2 text-13 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}
export function DropdownLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("label-caps px-2 py-1", className)} {...props} />;
}
