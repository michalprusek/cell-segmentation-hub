/**
 * ImageJ ROI stroke-colour derivation.
 *
 * Mirrors the frontend `src/pages/segmentation/utils/instanceColors.ts` so a
 * microtubule exported to a `.roi` gets the SAME colour it shows in the editor.
 * The FE renders `hsl(hue, 70%, 55%)` from a `hash * 31 + charCode` hash of
 * the polyline's colour key (cross-frame trackId first), spread over the wheel
 * by a x137 stride. ImageJ stores a stroke colour as a single ARGB int, so here
 * we reproduce that exact hue arithmetic, convert HSL→RGB, and pack it with an
 * opaque alpha.
 *
 * PARITY IS A CROSS-STACK CLAIM AND NEEDS A CROSS-STACK GUARD. The tests beside
 * this file compare it against a copy of the FE loop written in the test file,
 * which by construction cannot see the FE drift away — and on 2026-09-08 it did
 * not: the FE gained the x137 stride and every exported .roi would have carried
 * the old hue while the editor showed the new one, with all backend tests green.
 * The real guard is `src/pages/segmentation/utils/__tests__/imagejColorParity.test.ts`,
 * on the FRONTEND side, because that is the only suite that can import both
 * files. The backend container bakes `backend/` alone and cannot reach `src/`.
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
  if (p.trackId) {
    return p.trackId;
  }
  if (typeof p.instanceId === 'string' && p.instanceId.startsWith('mt_')) {
    return p.instanceId;
  }
  return p.id ?? '';
}

/**
 * `hash * 31 + charCode` → x137 stride → hue in [0, 359]. Byte-identical to
 * `colorFromInstanceId`'s arithmetic (`hash = ((hash << 5) - hash + charCode) | 0`,
 * then `(Math.abs(hash) * 137) % 360`) so exported hues match the editor.
 *
 * The x137 is not cosmetic and must not be dropped here alone: without it,
 * sequential keys land within a degree of each other, and an export whose
 * stride disagrees with the editor's is worse than either — the same
 * microtubule gets two different colours in two tools.
 */
export function hueFromColorKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) * 137) % 360;
}

/** Standard HSL→RGB. h in [0, 360), s/l in [0, 1] → [r, g, b] as 0–255 ints. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    [r, g, b] = [c, x, 0];
  } else if (h < 120) {
    [r, g, b] = [x, c, 0];
  } else if (h < 180) {
    [r, g, b] = [0, c, x];
  } else if (h < 240) {
    [r, g, b] = [0, x, c];
  } else if (h < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }
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
  if (!m) {
    return imageJStrokeColor('');
  }
  const n = parseInt(m[1], 16);
  return ((0xff << 24) | n) >>> 0;
}
