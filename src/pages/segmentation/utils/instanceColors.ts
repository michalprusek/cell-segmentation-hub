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
 *
 * THE x137 IS LOAD-BEARING, not decoration. djb2 on two strings differing by
 * one in the LAST character produces hashes differing by one, so `% 360` put
 * them one degree apart — and the ids handed to this function are routinely
 * sequential (`polygon_21`, `polygon_22`, …). Measured 2026-09-08 on a real
 * frame: four somas landed on hues 329/330/331/332, i.e. four cells in four
 * indistinguishable magentas, which defeats the entire point of colouring by
 * cell. Random ids were only a little better: six MT trackIds had a minimum
 * gap of 4°.
 *
 * 137 is coprime with 360 (so it is a bijection on the hue wheel and no two
 * distinct hashes collide that did not collide before) and close to the golden
 * angle 137.5°, the standard choice for spreading a sequence maximally. Same
 * measurement after: the somas span 73/124/159/210/296/347 (minimum gap 35°)
 * and the trackIds 18/56/113/159/228/350 (38°).
 *
 * Colours are DERIVED, never stored, so this changes no data — but it does
 * change every existing colour on screen, microtubule tracks included. Per-id
 * stability is unaffected: the same id still yields the same colour on every
 * frame and every reload, which is the property the cross-frame MT palette
 * actually depends on.
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
  const hue = (Math.abs(hash) * 137) % 360;
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
