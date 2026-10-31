import { useState } from "react";
import { cn, logoUrl, platformName } from "@/lib/utils";

/** A platform's logo from assets.withone.ai, lazy, with a letter tile when it fails to load. */
export function SourceLogo({ platform, size = 16, className, src }: { platform: string | null | undefined; size?: number; className?: string; src?: string }) {
  const url = src ?? logoUrl(platform);
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === url) {
    return (
      <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-sm bg-muted font-semibold text-muted-foreground", className)} style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.56)) }}>
        {platformName(platform).slice(0, 1)}
      </span>
    );
  }
  return <img src={url} alt="" aria-hidden loading="lazy" width={size} height={size} onError={() => setBroken(url)} className={cn("shrink-0 object-contain", className)} style={{ width: size, height: size }} />;
}

/** Overlapping logos for "found in" clusters (max 4). */
export function LogoStack({ platforms, size = 14, max = 4 }: { platforms: (string | null | undefined)[]; size?: number; max?: number }) {
  const shown = [...new Set(platforms.filter(Boolean))].slice(0, max);
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={p} className={cn("inline-flex rounded-sm bg-card p-px ring-1 ring-border", i > 0 && "-ml-1")} title={platformName(p)}>
          <SourceLogo platform={p} size={size} />
        </span>
      ))}
    </span>
  );
}
