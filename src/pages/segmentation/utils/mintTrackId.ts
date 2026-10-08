/**
 * A track id for a microtubule that has none, in the shape the server mints
 * (`mt_<8 hex>`, see `propagateTracksGeometryForward`) so nothing downstream
 * can tell where it was made.
 *
 * `crypto.randomUUID` needs a secure context; the fallback covers a plain
 * http dev host and keeps the same shape.
 */
export function mintTrackId(): string {
  const hex =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Array.from({ length: 8 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join('');
  return `mt_${hex.slice(0, 8)}`;
}
