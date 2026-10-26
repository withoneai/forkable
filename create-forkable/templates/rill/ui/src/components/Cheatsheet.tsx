import { Dialog } from "./ui/Dialog";
import { Keys } from "./ui/Kbd";
import { MOD } from "@/lib/utils";

export const SHORTCUTS: { group: string; items: { keys: string; label: string }[] }[] = [
  { group: "Move", items: [
    { keys: "J", label: "Next thread" }, { keys: "K", label: "Previous thread" }, { keys: "Enter", label: "Open" }, { keys: "Esc", label: "Back to the list" },
  ] },
  { group: "Act", items: [
    { keys: "E", label: "Done" }, { keys: "R", label: "Edit the draft" }, { keys: "H", label: "Snooze" }, { keys: "L", label: "Reply later" }, { keys: "V", label: "Add VIP" }, { keys: "Z", label: "Undo the last action" }, { keys: "W", label: "Compose" },
  ] },
  { group: "Jump", items: [
    { keys: "G V", label: "VIP" }, { keys: "G G", label: "Goals" }, { keys: "G R", label: "Reply" }, { keys: "G O", label: "Other" }, { keys: "G S", label: "Screener" }, { keys: "G B", label: "Brief" }, { keys: "G C", label: "Calendar" }, { keys: "G A", label: "Access" },
  ] },
  { group: "Calendar", items: [
    { keys: "1–7", label: "Week of N days" }, { keys: "D", label: "Day view" }, { keys: "M", label: "Month" }, { keys: "A", label: "Agenda" }, { keys: "T", label: "Today" }, { keys: "C", label: "New event" }, { keys: "Drag", label: "Move or resize your event" },
    { keys: "Y", label: "RSVP yes" }, { keys: "N", label: "RSVP no" }, { keys: "M", label: "RSVP maybe" }, { keys: "\\", label: "Toggle the Today rail" },
  ] },
  { group: "Everything", items: [
    { keys: `${MOD} K`, label: "Command palette" }, { keys: "?", label: "This sheet" },
  ] },
];

export function Cheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard" size="md">
      <div className="grid grid-cols-2 gap-x-10 gap-y-5 p-5">
        {SHORTCUTS.map((g) => (
          <div key={g.group} className="flex flex-col gap-1">
            <p className="label-caps mb-1">{g.group}</p>
            {g.items.map((it) => (
              <div key={it.keys} className="flex h-6 items-center justify-between gap-3 text-13">
                <span className="text-foreground">{it.label}</span>
                <Keys combo={it.keys} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
