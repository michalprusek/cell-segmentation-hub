// Neutral gray for malformed / empty IDs so they don't masquerade as
// a valid red microtubule.
const NEUTRAL_COLOR = 'hsl(0, 0%, 60%)';

/**
 * Type predicate: narrows an optional instanceId to a microtubule-style
 * string (prefix `mt_`). After the check, the value is provably a string,
 * so callers can drop `as string` casts.
 */
export function isMicrotubuleInstance(
  instanceId: string | undefined | null
): instanceId is string {
  return typeof instanceId === 'string' && instanceId.startsWith('mt_');
}

/**
 * Maps an instanceId / trackId to a deterministic CSS `hsl(...)` color.
 *
 * djb2-style hash → hue in [0, 359]. Saturation and lightness shift on
 * selection so the same color reads distinctly when picked. Empty input
 * returns a neutral gray instead of red so malformed IDs are obvious.
 */
export function colorFromInstanceId(
  instanceId: string,
  { selected = false }: { selected?: boolean } = {}
): string {
  if (!instanceId) return NEUTRAL_COLOR;
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) {
    hash = ((hash << 5) - hash + instanceId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const sat = selected ? 80 : 70;
  const light = selected ? 45 : 55;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
