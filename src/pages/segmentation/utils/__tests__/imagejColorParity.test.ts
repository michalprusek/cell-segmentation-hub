/**
 * The ImageJ export's colour must be the editor's colour — checked by importing
 * BOTH implementations.
 *
 * WHY THIS FILE EXISTS, and why it is on the frontend side. The backend derives
 * a `.roi` stroke colour in `backend/src/services/export/imagejColor.ts`, which
 * duplicates `colorFromInstanceId`'s arithmetic because a Node service cannot
 * import a React module. Its own suite "enforced parity" against a copy of the
 * frontend loop written INSIDE that test file — so it could only ever catch a
 * change to the backend, never a change to the frontend.
 *
 * On 2026-09-08 that blind spot was demonstrated: `colorFromInstanceId` gained a
 * x137 hue stride (sequential ids were landing one degree apart, four somas on
 * 329/330/331/332), the backend was not touched, and the entire backend suite —
 * 3912 tests — stayed green while every exported `.roi` would have carried the
 * old hue. The same microtubule would have read as one colour in the app and
 * another in ImageJ, silently, forever.
 *
 * The frontend suite runs from the repo root and can reach both files; the
 * backend container bakes `backend/` alone and cannot — which is also why the
 * duplication cannot simply be deleted in favour of the backend importing
 * `instanceColors.ts`: that file would not exist inside the image at run time.
 * So the guard lives here. The single `files: [...]` entry in
 * `tsconfig.test.json` exists for this import and nothing else — `exclude`
 * lists `backend`, and `files` is the one list `exclude` does not filter. If
 * this import ever has to go, that entry goes with it, and so must the
 * duplication it is guarding.
 */
import { describe, it, expect } from 'vitest';
import { colorFromInstanceId } from '../instanceColors';
import {
  hueFromColorKey,
  imageJStrokeColor,
} from '../../../../../backend/src/services/export/imagejColor';

/** The hue the editor actually paints, read back off the rendered string. */
const editorHue = (key: string): number => {
  const css = colorFromInstanceId(key);
  const m = /^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/.exec(css);
  expect(m, `unparseable colour for ${JSON.stringify(key)}: ${css}`).not.toBe(
    null
  );
  return Number(m![1]);
};

/**
 * Sequential ids are the case the stride exists for, `mt_`-prefixed ones are
 * what a real export carries, and the odd shapes are there because the hash is
 * bit arithmetic: a long key overflows int32 and a non-ASCII one has char codes
 * above 255.
 */
const KEYS = [
  'polygon_21',
  'polygon_22',
  'polygon_23',
  'polygon_24',
  'mt_42',
  'mt_0d08f27f',
  'mt_1cea30b3',
  'track_99',
  'a',
  'x'.repeat(50),
  'µ_αβ',
];

describe('ImageJ export colour == editor colour', () => {
  it.each(KEYS)('agrees on the hue for %j', key => {
    expect(hueFromColorKey(key)).toBe(editorHue(key));
  });

  it('agrees on saturation and lightness, which the ARGB also encodes', () => {
    // The export never renders a selected ROI, so it hard-codes the unselected
    // pair. If the editor's unselected constants move, the packed colour is
    // wrong even when the hue still matches.
    const m = /^hsl\(\d+,\s*(\d+)%,\s*(\d+)%\)$/.exec(
      colorFromInstanceId('mt_42')
    );
    expect([m![1], m![2]]).toEqual(['70', '55']);
  });

  it('agrees that an identity-less polygon is neutral gray, not a real colour', () => {
    expect(colorFromInstanceId('')).toBe('hsl(0, 0%, 60%)');
    const argb = imageJStrokeColor('');
    expect([(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff]).toEqual([
      153, 153, 153,
    ]);
  });

  it('keeps sequential ids apart on BOTH sides, not just in the editor', () => {
    // The whole point of the stride. Asserting it here as well as in
    // `instanceColors.test.ts` is what makes "the export lost the stride" a
    // failure rather than a silently duller palette in ImageJ.
    const hues = ['polygon_21', 'polygon_22', 'polygon_23', 'polygon_24']
      .map(hueFromColorKey)
      .sort((a, b) => a - b);
    const gaps = hues.map((h, i) =>
      i + 1 < hues.length ? hues[i + 1] - h : hues[0] + 360 - h
    );
    expect(Math.min(...gaps)).toBeGreaterThan(20);
  });
});
