/** Types for `cases.mjs`, which stays plain JavaScript so the oracle runner can
 *  import it without a TypeScript toolchain. */

export interface HistogramCase {
  name: string;
  bitDepth: 8 | 16;
  width: number;
  height: number;
  seed: number;
  sample: (next: () => number) => number;
  axes: (min: number, max: number) => [number, number][];
}

export const CASES: HistogramCase[];

export const AUTO_CLICKS: number;

export function generateSamples(testCase: HistogramCase): {
  data: Uint16Array | Uint8Array;
  min: number;
  max: number;
};
