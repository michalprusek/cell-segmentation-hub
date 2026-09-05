/**
 * The cross-channel competition columns in the WIDE microtubule sheet.
 *
 * The property that matters is conditional: these columns exist ONLY when the
 * container carried two or more FLUORESCENT channels. A single-label export —
 * and, importantly, an IRM + one-fluorescent export, which is the common shape
 * in this project — must produce byte-identical output to before, because a
 * label-free channel carries no protein and cannot compete with one.
 *
 * Values are deliberately checked for the null-vs-zero distinction: a pair that
 * could not be measured is BLANK, never 0, since 0 asserts the two proteins are
 * distributed identically.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    SEGMENTATION_SERVICE_URL: 'http://ml-mock:8000',
    UPLOAD_DIR: '/app/uploads',
  },
}));

import {
  competitionColumn,
  competitionPairs,
  pivotMTMetricsWide,
  type MTMetricsRow,
} from '../mtMetricsExporter';

function row(channel: string, overrides: Partial<MTMetricsRow> = {}): MTMetricsRow {
  return {
    frameIndex: 0,
    imageName: 'frame_0000',
    label: '',
    mtType: '',
    instanceId: 'mt_1',
    trackId: 't1',
    channel,
    lengthPx: 100,
    lengthUm: null,
    areaPx: 500,
    areaUm2: null,
    pixelCount: 500,
    sumIntensity: 1000,
    meanIntensity: 2,
    medianIntensity: 2,
    stdIntensity: 0.5,
    medianBackground: 1,
    meanBackground: 1,
    signalMinusBackground: 1,
    sourceFrameIndex: 0,
  } as MTMetricsRow;
}

/** The identity key `pivotMTMetricsWide` joins on: imageName, frameIndex
 *  and instanceId separated by NUL. Built the way the exporter builds it. */
const IDENTITY = ['frame_0000', 0, 'mt_1'].join('\u0000');

describe('competitionPairs', () => {
  it('enumerates unordered pairs in the given order', () => {
    expect(competitionPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('produces nothing for fewer than two channels', () => {
    expect(competitionPairs([])).toEqual([]);
    expect(competitionPairs(['only'])).toEqual([]);
  });
});

describe('competition columns in the wide pivot', () => {
  it('adds no competition data when no fluorescent pair exists', () => {
    // The common shape in this project: IRM + one fluorescent channel. IRM is
    // label-free, so there is nothing to compete.
    const wide = pivotMTMetricsWide([row('IRM'), row('TIRF_488')]);
    expect(wide.fluorescent).toEqual([]);
    expect(wide.rows).toHaveLength(1);
    expect(Object.keys(wide.rows[0].competition)).toEqual([]);
  });

  it('attaches pair values to the matching microtubule', () => {
    const comp = new Map<string, Record<string, number | null>>([
      [
        IDENTITY,
        {
          [competitionColumn('competition', 'c488', 'c640')]: 0.75,
          [competitionColumn('anticorrelation', 'c488', 'c640')]: -0.9,
        },
      ],
    ]);
    const wide = pivotMTMetricsWide(
      [row('c488'), row('c640')],
      comp,
      ['c488', 'c640']
    );
    expect(wide.fluorescent).toEqual(['c488', 'c640']);
    expect(wide.rows[0].competition['competition_c488_c640']).toBe(0.75);
    expect(wide.rows[0].competition['anticorrelation_c488_c640']).toBe(-0.9);
  });

  it('leaves a microtubule with no entry blank rather than zero', () => {
    // A pair the ML could not measure must not read as "distributed
    // identically" — that is a claim, and the absence of one is not it.
    const wide = pivotMTMetricsWide(
      [row('c488'), row('c640')],
      new Map(),
      ['c488', 'c640']
    );
    expect(wide.rows[0].competition['competition_c488_c640']).toBeUndefined();
    expect(wide.rows[0].competition['competition_c488_c640'] ?? null).toBeNull();
  });

  it('does not confuse two microtubules on the same frame', () => {
    const other = { ...row('c488'), instanceId: 'mt_2' };
    const comp = new Map<string, Record<string, number | null>>([
      [IDENTITY, { competition_c488_c640: 0.4 }],
    ]);
    const wide = pivotMTMetricsWide(
      [row('c488'), row('c640'), other, { ...other, channel: 'c640' }],
      comp,
      ['c488', 'c640']
    );
    const mt1 = wide.rows.find(r => r.instanceId === 'mt_1');
    const mt2 = wide.rows.find(r => r.instanceId === 'mt_2');
    expect(mt1?.competition['competition_c488_c640']).toBe(0.4);
    expect(mt2?.competition['competition_c488_c640']).toBeUndefined();
  });

  it('keys the competition map with a null prototype', () => {
    // Same reasoning as `channels`: the keys embed channel names that came from
    // file metadata, and on a plain object `__proto__` would set the prototype.
    const wide = pivotMTMetricsWide([row('c488')]);
    expect(Object.getPrototypeOf(wide.rows[0].competition)).toBeNull();
  });
});
