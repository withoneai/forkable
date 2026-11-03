import { Dialog } from "./ui/Dialog";
import { Keys } from "./ui/Kbd";
import { KEYMAP, type KeyDef } from "@/lib/keymap";

const GROUPS: KeyDef["group"][] = ["Everywhere", "Editor", "Preview", "Lists", "Code"];

/** Generated from lib/keymap.ts, the same table the bindings use. */
export function Cheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard" size="lg">
      <div className="grid grid-cols-2 gap-x-10 gap-y-5 p-5">
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-col gap-1">
            <p className="label-caps mb-1">{g}</p>
            {KEYMAP.filter((k) => k.group === g).map((k) => (
              <div key={k.id} className="flex h-6 items-center justify-between gap-3 text-13">
                <span className="flex items-center gap-1.5 text-foreground">
                  {k.label}
                </span>
                <Keys combo={k.display} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="border-t border-border bg-faint px-5 py-2.5 text-11 text-muted-foreground">Single letters work when the cursor is not in a text field.</p>
    </Dialog>
  );
}
