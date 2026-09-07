/**
 * Writing the neurite -> soma assignment onto a frame's polygons.
 *
 * The decision worth pinning is what happens to a polygon the run did NOT
 * attribute: its `somaId` is cleared, not left alone. The map is a whole-frame
 * answer from one pipeline run, so an absent entry means the pipeline could not
 * attribute that polygon — and keeping a value from an earlier run would show
 * an assignment nothing currently supports.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/config', () => ({
  config: { NODE_ENV: 'test', UPLOAD_DIR: '/app/uploads' },
}));

import { setPolygonsSomaId } from '../segmentationService';

const neurite = (id: string, somaId?: string) => ({
  id,
  partClass: 'neurite',
  ...(somaId ? { somaId } : {}),
});
const soma = (id: string) => ({ id, partClass: 'soma' });

describe('setPolygonsSomaId', () => {
  it('writes the assignment onto a neurite', () => {
    const { polygons, changed } = setPolygonsSomaId(
      [neurite('n1')],
      new Map([['n1', 's1']])
    );
    expect(changed).toBe(1);
    expect(polygons[0]).toMatchObject({ id: 'n1', somaId: 's1' });
  });

  it('CLEARS a neurite the run did not attribute', () => {
    // The whole-frame reasoning above. Leaving the old value would keep an
    // assignment on screen that the current run does not support.
    const { polygons, changed } = setPolygonsSomaId(
      [neurite('n1', 'stale')],
      new Map()
    );
    expect(changed).toBe(1);
    expect(polygons[0]).not.toHaveProperty('somaId');
  });

  it('counts nothing when the assignment is unchanged', () => {
    // The caller skips the DB write on `changed === 0`, so a no-op that
    // reported a change would rewrite every frame on every run.
    const { polygons, changed } = setPolygonsSomaId(
      [neurite('n1', 's1')],
      new Map([['n1', 's1']])
    );
    expect(changed).toBe(0);
    expect(polygons[0]).toBe(polygons[0]);
  });

  it('never touches a soma', () => {
    // A soma is what others are assigned TO. Writing `somaId` onto one would
    // make it colour as its own neurite.
    const input = [soma('s1')];
    const { polygons, changed } = setPolygonsSomaId(
      input,
      new Map([['s1', 's2']])
    );
    expect(changed).toBe(0);
    expect(polygons[0]).toBe(input[0]);
  });

  it("never touches another project type's polygons", () => {
    // A sperm tail or a spheroid has no assignment and must come back byte
    // for byte, not merely equal — a copy would defeat the memo comparators
    // that key on object identity.
    const tail = { id: 't', partClass: 'tail', somaId: 'nonsense' };
    const plain = { id: 'p' };
    const { polygons, changed } = setPolygonsSomaId(
      [tail, plain],
      new Map([['t', 's1']])
    );
    expect(changed).toBe(0);
    expect(polygons[0]).toBe(tail);
    expect(polygons[1]).toBe(plain);
  });

  it('does not mutate its input', () => {
    const input = [neurite('n1')];
    const snapshot = JSON.stringify(input);
    setPolygonsSomaId(input, new Map([['n1', 's1']]));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('returns unchanged polygons by REFERENCE, not as copies', () => {
    // Same reason as above: the editor's memo comparators compare identity,
    // so copying an untouched polygon would repaint the whole canvas on every
    // assignment run.
    const untouched = neurite('n2', 's2');
    const { polygons } = setPolygonsSomaId(
      [neurite('n1'), untouched],
      new Map([
        ['n1', 's1'],
        ['n2', 's2'],
      ])
    );
    expect(polygons[1]).toBe(untouched);
  });

  it('ignores a polygon with no usable id', () => {
    const noId = { partClass: 'neurite' };
    const { polygons, changed } = setPolygonsSomaId(
      [noId],
      new Map([['n1', 's1']])
    );
    expect(changed).toBe(0);
    expect(polygons[0]).toBe(noId);
  });
});
