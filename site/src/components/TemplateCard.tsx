import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import { Glyph } from "./Glyph";
import { connectorLogo } from "./icons";
import type { Template } from "../lib/templates";

export function TemplateCard({
  template,
  active,
  onSelect,
}: {
  template: Template;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <a
      href={template.comingSoon ? undefined : template.site}
      target={template.comingSoon ? undefined : "_blank"}
      rel={template.comingSoon ? undefined : "noopener"}
      tabIndex={template.comingSoon ? 0 : undefined}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "group flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors",
        active ? "border-foreground/30 bg-card" : "border-border bg-background/60 hover:border-foreground/20",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Glyph id={template.mark} className="size-5 shrink-0 text-accent-fg" />
        <h3 className="text-15 font-medium">{template.name}</h3>
        <span className="whitespace-nowrap rounded-sm border border-border px-1.5 py-0.5 text-11 text-muted-foreground">{template.tier}</span>
        <span className="whitespace-nowrap rounded-sm border border-border px-1.5 py-0.5 text-11 text-muted-foreground">{template.kind}</span>
      </div>
      {template.comingSoon ? (
        <span className="-mt-1.5 font-mono text-11 text-muted-foreground">Coming soon</span>
      ) : (
        <span className="-mt-1.5 inline-flex items-center gap-0.5 font-mono text-11 text-muted-foreground transition-colors group-hover:text-foreground">{template.site.replace("https://", "")}<ArrowUpRight className="size-3 shrink-0" strokeWidth={2} /></span>
      )}
      <p className="text-13 text-muted-foreground">{template.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap text-11 text-muted-foreground">Comes connected to</span>
          {template.platforms.map((p) => (
            <img key={p.slug} src={connectorLogo(p.slug)} alt={p.name} className="size-4 rounded-sm" />
          ))}
        </div>
      </div>
    </a>
  );
}
