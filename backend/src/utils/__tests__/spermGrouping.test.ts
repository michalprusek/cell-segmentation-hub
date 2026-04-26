import { describe, it, expect } from 'vitest';
import {
  groupPolylinesByInstanceId,
  findPart,
  type SpermPolylinePart,
} from '../spermGrouping';

const makePart = (
  instanceId: string | undefined,
  partClass: SpermPolylinePart['partClass']
): SpermPolylinePart => ({
  instanceId,
  partClass,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
});

describe('groupPolylinesByInstanceId', () => {
  it('returns empty result for empty input', () => {
    expect(groupPolylinesByInstanceId([])).toEqual({
      groups: [],
      orphanCount: 0,
    });
  });

  it('groups multiple parts under one instanceId', () => {
    const result = groupPolylinesByInstanceId([
      makePart('s1', 'head'),
      makePart('s1', 'midpiece'),
      makePart('s1', 'tail'),
    ]);

    expect(result.orphanCount).toBe(0);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.instanceId).toBe('s1');
    expect(result.groups[0]?.parts).toHaveLength(3);
  });

  it('keeps multiple instances separate (no collapse-by-partClass)', () => {
    const result = groupPolylinesByInstanceId([
      makePart('s1', 'head'),
      makePart('s2', 'head'),
      makePart('s1', 'tail'),
      makePart('s2', 'midpiece'),
    ]);

    expect(result.groups).toHaveLength(2);
    const s1 = result.groups.find(g => g.instanceId === 's1');
    const s2 = result.groups.find(g => g.instanceId === 's2');
    expect(s1?.parts.map(p => p.partClass).sort()).toEqual(['head', 'tail']);
    expect(s2?.parts.map(p => p.partClass).sort()).toEqual([
      'head',
      'midpiece',
    ]);
  });

  it('counts polylines without instanceId as orphans', () => {
    const result = groupPolylinesByInstanceId([
      makePart(undefined, 'head'),
      makePart('s1', 'midpiece'),
      makePart(undefined, 'tail'),
    ]);

    expect(result.orphanCount).toBe(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.instanceId).toBe('s1');
  });

  it('preserves grouped parts in insertion order', () => {
    const head = makePart('s1', 'head');
    const tail = makePart('s1', 'tail');
    const mid = makePart('s1', 'midpiece');

    const { groups } = groupPolylinesByInstanceId([head, tail, mid]);

    expect(groups[0]?.parts).toEqual([head, tail, mid]);
  });
});

describe('findPart', () => {
  it('returns the matching part by partClass', () => {
    const head = makePart('s1', 'head');
    const tail = makePart('s1', 'tail');
    expect(findPart([head, tail], 'tail')).toBe(tail);
  });

  it('returns undefined when no part matches', () => {
    const head = makePart('s1', 'head');
    expect(findPart([head], 'midpiece')).toBeUndefined();
  });

  it('returns the first match when duplicates exist', () => {
    const a = makePart('s1', 'head');
    const b = makePart('s1', 'head');
    expect(findPart([a, b], 'head')).toBe(a);
  });
});
