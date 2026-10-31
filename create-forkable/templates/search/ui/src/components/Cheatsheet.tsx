import { KEYMAP } from "@/contract/keymap";
import { MOD } from "@/lib/utils";
import { Dialog } from "./ui/Dialog";
import { Keys } from "./ui/Kbd";

const show = (k: string) => k.replace(/⌘/g, MOD);

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
      </div>
    </Dialog>
  );
}
