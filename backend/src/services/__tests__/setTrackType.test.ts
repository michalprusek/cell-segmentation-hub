import { describe, it, expect } from 'vitest';
import { setPolygonsTrackType } from '../segmentationService';

type P = Record<string, unknown>;
const polys = (): P[] => [
  { id: 'a', trackId: 't1', geometry: 'polyline', points: [] },
  { id: 'b', trackId: 't2', geometry: 'polyline', points: [] },
  { id: 'c', geometry: 'polyline', points: [] }, // no trackId
];

describe('setPolygonsTrackType', () => {
  it('sets mtType on polygons whose trackId is selected', () => {
    const { polygons, changed } = setPolygonsTrackType(
      polys(),
      new Set(['t1']),
      'mt_type_x'
    );
    expect(changed).toBe(1);
    expect((polygons[0] as P).mtType).toBe('mt_type_x');
    expect((polygons[1] as P).mtType).toBeUndefined();
    expect((polygons[2] as P).mtType).toBeUndefined();
  });

  it('applies to multiple selected tracks at once', () => {
    const { changed } = setPolygonsTrackType(
      polys(),
      new Set(['t1', 't2']),
      'mt_type_x'
    );
    expect(changed).toBe(2);
  });

  it('clears mtType when passed null', () => {
    const input = polys().map(p =>
      p.id === 'a' ? { ...p, mtType: 'mt_type_x' } : p
    );
    const { polygons, changed } = setPolygonsTrackType(
      input,
      new Set(['t1']),
      null
    );
    expect(changed).toBe(1);
    expect((polygons[0] as P).mtType).toBeUndefined();
  });

  it('does not count a no-op (already that value)', () => {
    const input = polys().map(p =>
      p.id === 'a' ? { ...p, mtType: 'mt_type_x' } : p
    );
    const { changed } = setPolygonsTrackType(
      input,
      new Set(['t1']),
      'mt_type_x'
    );
    expect(changed).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = polys();
    setPolygonsTrackType(input, new Set(['t1']), 'mt_type_x');
    expect((input[0] as P).mtType).toBeUndefined();
  });
});
