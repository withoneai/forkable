// Keys the preview forwards over the channel while it has focus (select mode).
type Fn = (chord: string) => void;
const fns = new Set<Fn>();
export function onKeyFromPreview(fn: Fn): () => void {
  fns.add(fn);
  return () => { fns.delete(fn); };
}
export function emitPreviewKey(chord: string) {
  fns.forEach((f) => f(chord));
}
