import { ZERO_USAGE, type HarnessEvent, type Usage } from "./types.js";
import { addUsage } from "./parsers/util.js";

/**
 * Turn usage from a stream of usage events. Per-call readings add up into a
 * live estimate; a `total` reading (Claude's result, Codex's turn.completed)
 * replaces the sum, never adds to it.
 */
export class UsageMeter {
  private sum: Usage = { ...ZERO_USAGE };
  private total: Usage | null = null;

  push(ev: Extract<HarnessEvent, { t: "usage" }>): void {
    if (ev.total) this.total = ev.usage;
    else this.sum = addUsage(this.sum, ev.usage);
  }

  get value(): Usage {
    return this.total ?? this.sum;
  }
}
