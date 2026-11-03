import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * A labelled form control with an optional hint and an inline error.
 *
 *   <Field label="Email" hint="We reply within a day" error={errors.email}>
 *     <Input type="email" value={email} onChange={...} />
 *   </Field>
 *
 * The label is tied to the control (id, aria-describedby, aria-invalid), so
 * there is no need to pass an id.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Shows "Optional" next to the label. Required is the default; say so only when it is not. */
  optional?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}) {
  const auto = React.useId();
  const id = children.props.id ?? auto;
  const hintId = `${id}-hint`;
  const control = React.cloneElement(children, {
    id,
    "aria-describedby": hint || error ? hintId : undefined,
    "aria-invalid": error ? true : undefined,
  });
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional && <span className="text-11 text-muted-foreground">Optional</span>}
      </div>
      {control}
      {error ? (
        <p id={hintId} className="text-11 text-destructive-text">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-11 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
