import { KEYMAP } from "@/contract/keymap";
import { MOD } from "@/lib/utils";
import { Dialog } from "./ui/Dialog";
import { Keys } from "./ui/Kbd";

const show = (k: string) => k.replace(/⌘/g, MOD);

/**
 * Typed filters. The box reads plain sentences ("emails from Priya last week"), so
 * these live here, not on the main surface. A typed filter always wins over a
 * sentence, and quotes keep words as words.
 */
const FILTERS: [string, string][] = [
  ["from:priya", "From a person (to:, with: work the same; me is you)"],
  ["with:globex.com", "With a person or company, by name, address or domain"],
  ["in:slack", "In one tool (in:gmail,notion for two)"],
  ["container:deals", "In one channel, folder or project"],
  ["type:deal", "One kind: mail, meeting, event, doc, issue, message, deal, note, person, company"],
  ["is:unread", "unread, open, mine, upcoming, past, needs-you, waiting, vip"],
  ["has:attachment", "attachment, link, joinurl, transcript"],
  ["after:30d before:2026-10-01", "Dates: today, yesterday, this-week, last-month, 7d, a day or a month"],
  ["during:this-week", "Meetings and events that overlap a time"],
  ["lane:needs-you", "A priority lane: vip, needs-you, waiting, fyi, low"],
  ["stage:\"contract sent\" amount:>=50000", "Deal stage and amount"],
  ["-in:slack", "A minus leaves something out"],
  ["\"from scratch\"", "Quotes search the exact words, never a filter"],
];

/** The ? sheet. Renders straight from the keymap table, so it never drifts from the handlers. */
export function Cheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard" size="lg" className="max-w-[1040px]">
      {/* three columns from 1100px so the whole sheet fits a laptop screen without scrolling */}
      <div className="grid max-h-[78vh] grid-cols-2 gap-x-10 gap-y-5 overflow-y-auto p-5 min-[1100px]:grid-cols-3 [mask-image:linear-gradient(to_bottom,black_calc(100%-16px),transparent)]" data-testid="cheatsheet">
        {KEYMAP.map((g) => (
          <div key={g.group} className="flex flex-col gap-1">
            <p className="label-caps mb-1">{g.group}</p>
            {g.items.map((it) => (
              <div key={it.id} className="flex h-6 items-center justify-between gap-3 text-13">
                <span className="truncate text-foreground">{it.label}</span>
                <Keys combo={show(it.keys)} />
              </div>
            ))}
          </div>
        ))}
        <div className="col-span-full flex flex-col gap-1 border-t border-border pt-4" data-testid="cheatsheet-filters">
          <p className="label-caps mb-1">Filters you can type</p>
          <p className="mb-1 text-xs text-muted-foreground">Plain sentences work in the box. For exact control, type a filter; it always wins over the sentence.</p>
          <div className="grid grid-cols-1 gap-x-10 gap-y-1 min-[1100px]:grid-cols-2">
            {FILTERS.map(([f, what]) => (
              <div key={f} className="flex min-h-6 items-baseline gap-3 text-13">
                <code className="shrink-0 rounded-sm bg-muted px-1 font-mono text-xs text-foreground">{f}</code>
                <span className="min-w-0 text-muted-foreground">{what}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
