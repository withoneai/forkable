// The sheet is a modal, so its key bindings register with whileTyping and
// step aside themselves when focus is in a field or on a control.
export function inField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}
export function onControl(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return inField(e) || t.tagName === "BUTTON" || t.tagName === "A" || t.getAttribute("role") === "menu" || !!t.closest('[role="menu"]');
}
