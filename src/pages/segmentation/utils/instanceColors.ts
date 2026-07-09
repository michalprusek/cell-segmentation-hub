// Neutral gray for malformed / empty IDs so they don't masquerade as
// a valid red microtubule. Also used for untyped microtubules in the
// semantic (by-label) colour mode.
export const NEUTRAL_COLOR = 'hsl(0, 0%, 60%)';

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

/** Darken a `#RRGGBB` hex by `amount` (0..1) for the selected state. Returns the
 *  input unchanged if it isn't a 6-digit hex. */
export function darkenHex(hex: string, amount = 0.18): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Semantic (by-label) colour for a microtubule. Resolves the polyline's
 * `mtType` label id to its palette colour; an untyped MT or an unknown id
 * returns {@link NEUTRAL_COLOR} so unclassified microtubules read as "not yet
 * labelled". Darkens on selection to mirror the instance-colour behaviour.
 */
export function resolveMtColor(
  mtType: string | undefined | null,
  palette: Map<string, string>,
  { selected = false }: { selected?: boolean } = {}
): string {
  const color = mtType ? palette.get(mtType) : undefined;
  if (!color) return NEUTRAL_COLOR;
  return selected ? darkenHex(color) : color;
}
