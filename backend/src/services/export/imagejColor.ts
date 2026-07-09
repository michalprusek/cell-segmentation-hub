/**
 * ImageJ ROI stroke-colour derivation.
 *
 * Mirrors the frontend `src/pages/segmentation/utils/instanceColors.ts` so a
 * microtubule exported to a `.roi` gets the SAME colour it shows in the editor.
 * The FE renders `hsl(hue, 70%, 55%)` from a djb2-style hash of the polyline's
 * colour key (cross-frame trackId first). ImageJ stores a stroke colour as a
 * single ARGB int, so here we reproduce that exact hue hash, convert HSL→RGB,
 * and pack it with an opaque alpha.
 *
 * Parity is enforced by `__tests__/imagejColor.test.ts`: the integer hue math
 * is byte-identical to the FE loop, so a drift fails loudly rather than shipping
 * mismatched export colours.
 */

/** Minimal shape needed to pick a colour key — a subset of the polygon row. */
export interface RoiColorInput {
  trackId?: string | null;
  instanceId?: string | null;
  id?: string | null;
}

// Fixed saturation / lightness for the unselected editor state. The export
// never renders a "selected" ROI, so the +selection shift is not reproduced.
const SAT = 0.7;
const LIGHT = 0.55;

// Neutral gray for empty keys — matches the FE NEUTRAL_COLOR `hsl(0, 0%, 60%)`
// so a malformed / identity-less polyline doesn't masquerade as a real colour.
const NEUTRAL_GRAY = Math.round(0.6 * 255); // 153

/**
 * Colour-key precedence identical to `CanvasPolygon.tsx`: cross-frame trackId,
 * then an `mt_`-prefixed instanceId, then the per-polygon id. Guarantees a
 * distinct-but-stable colour per microtubule across every frame.
 */
export function colorKeyForRoi(p: RoiColorInput): string {
  if (p.trackId) return p.trackId;
  if (typeof p.instanceId === 'string' && p.instanceId.startsWith('mt_')) {
    return p.instanceId;
  }
  return p.id ?? '';
}

/**
 * djb2-style hash → hue in [0, 359]. Byte-identical to the FE hash loop
 * (`hash = ((hash << 5) - hash + charCode) | 0`) so exported hues match.
 */
export function hueFromColorKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** Standard HSL→RGB. h in [0, 360), s/l in [0, 1] → [r, g, b] as 0–255 ints. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * ImageJ stroke colour as an ARGB int (alpha in the high byte) for a polyline's
 * colour key. Alpha is forced opaque (`0xFF`) because ImageJ's RoiDecoder reads
 * a value whose bytes are all zero as "no stroke colour set". The returned int
 * is unsigned; write it with `Buffer.writeUInt32BE` at the STROKE_COLOR offset.
 */
export function imageJStrokeColor(colorKey: string): number {
  if (!colorKey) {
    return (
      ((0xff << 24) |
        (NEUTRAL_GRAY << 16) |
        (NEUTRAL_GRAY << 8) |
        NEUTRAL_GRAY) >>>
      0
    );
  }
  const hue = hueFromColorKey(colorKey);
  const [r, g, b] = hslToRgb(hue, SAT, LIGHT);
  return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

/**
 * ImageJ ARGB stroke colour (opaque) from a `#RRGGBB` type-label colour. Used
 * when a microtubule carries a user-assigned type label so the exported ROI is
 * drawn in the label's colour — the ROI's colour then IS its class. Falls back
 * to the neutral-gray "no key" colour when the hex is malformed. Alpha is forced
 * `0xFF` so ImageJ treats it as "colour set" (an all-zero value reads as unset).
 */
export function imageJColorFromHex(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return imageJStrokeColor('');
  const n = parseInt(m[1], 16);
  return ((0xff << 24) | n) >>> 0;
}
