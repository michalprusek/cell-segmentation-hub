/**
 * Editor sidebar/footer panels — parent-re-render cost.
 *
 * `SegmentationEditorLayout` is deliberately NOT memoised, and the editor's
 * `transform` is React state that `handlePan` writes on EVERY mousemove of a pan
 * (`useAdvancedInteractions.tsx:852`) and the wheel zoom writes on a 16 ms
 * throttle. So dragging the canvas re-renders the WHOLE layout continuously, and
 * every list panel in the sidebar re-derived its rows each time even though not
 * one of its props had changed.
 *
 * These tests pin the cost in a deterministic unit — the number of per-row
 * computations the panel performs — rather than wall-clock, which jsdom
 * quantises to 1 ms and cannot measure.
 *
 * Fixture size is the real production maximum, measured over 3000 sampled
 * microtubule frames in the production database on 2026-09-04:
 * 311 polylines / 2299 points on the busiest frame (mean 37.5 / 343).
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { render as renderWithProviders } from '@/test/utils/test-utils';
import MicrotubuleInstancePanel from '../MicrotubuleInstancePanel';
import SpermInstancePanel from '../SpermInstancePanel';
import PolygonListPanel from '../PolygonListPanel';
import { Polygon } from '@/lib/segmentation';
import type { MTTypeLabel } from '@/lib/api';

// Per-row work, spied. Each panel calls `calculatePolylineLength` once per
// listed polyline and `neuronClassStyle` once per closed-polygon row, so the
// call count IS the row-derivation count.
vi.mock('@/pages/segmentation/utils/metricCalculations', () => ({
  calculatePolylineLength: vi.fn(() => 123.4),
}));
vi.mock('@/pages/segmentation/utils/neuronClassStyle', () => ({
  neuronClassStyle: vi.fn(() => undefined),
}));

import { calculatePolylineLength } from '@/pages/segmentation/utils/metricCalculations';
import { neuronClassStyle } from '@/pages/segmentation/utils/neuronClassStyle';

/** Production maximum: 311 polylines totalling 2299 points on one frame. */
const ROWS = 311;
const POINTS_PER_ROW = 7; // 311 * 7 = 2177, the measured per-frame envelope

/** Parent re-renders to drive. A pan produces ~60 of these per second; 20 is a
 *  third of a second, enough to prove the claim without making the failing
 *  (unmemoised) case take two minutes in jsdom. */
const PAN_FRAMES = 20;

function makePolylines(kind: 'mt' | 'sperm'): Polygon[] {
  return Array.from({ length: ROWS }, (_, i) => ({
    id: `poly-${i}`,
    points: Array.from({ length: POINTS_PER_ROW }, (_, j) => ({
      x: j * 3,
      y: i + j,
    })),
    geometry: 'polyline',
    ...(kind === 'mt'
      ? {
          class: 'microtubule',
          trackId: `mt_track_${i}`,
          instanceId: `mt_${i}`,
        }
      : { partClass: 'tail' as const }),
  })) as Polygon[];
}

function makeClosedPolygons(): Polygon[] {
  return Array.from({ length: ROWS }, (_, i) => ({
    id: `poly-${i}`,
    points: Array.from({ length: POINTS_PER_ROW }, (_, j) => ({
      x: j * 3,
      y: i + j,
    })),
    geometry: 'polygon',
    type: 'external',
  })) as Polygon[];
}

/**
 * Renders `panel` under a parent that can be forced to re-render without any
 * of the panel's props changing — exactly what a pan/zoom does to the real
 * layout. Returns a `repaint()` that drives one "frame".
 */
function renderUnderChurningParent(renderPanel: () => React.ReactElement) {
  let bump: (() => void) | undefined;
  const Harness = () => {
    const [tick, setTick] = useState(0);
    bump = () => setTick(t => t + 1);
    // The panel element is created FRESH on every harness render (a hoisted
    // element would let React bail out on element identity alone and prove
    // nothing), but every prop it carries is module-scope constant — so the
    // panel is handed referentially identical props, exactly as a pan does.
    return (
      <div data-tick={tick}>
        {renderPanel()}
        <span>{tick}</span>
      </div>
    );
  };
  const result = renderWithProviders(<Harness />);
  return {
    ...result,
    repaint: (frames: number) => {
      for (let i = 0; i < frames; i++) {
        act(() => {
          bump?.();
        });
      }
    },
  };
}

// Every value below is module-scope constant, so the harness re-renders pass
// referentially identical props — the situation a pan creates. The panels are
// given the FULL set of props `SegmentationEditorLayout` passes, not a minimal
// subset: the claim being pinned is that the memo hits against the real call
// site, so a prop that later stops being reference-stable (a fresh
// `mtTypeLabels` array, say) has to be able to break this test.
const NOOP = vi.fn();
const EMPTY_SET = new Set<string>();
const MT_LABELS: MTTypeLabel[] = [
  { id: 'lbl-1', name: 'Tubulin A', color: '#aa3366' },
];
const MT_LABEL_BY_ID = new Map(MT_LABELS.map(l => [l.id, l]));
const ASYNC_LABEL = vi.fn(async () => MT_LABELS[0]);
const ASYNC_VOID = vi.fn(async () => {});

describe('editor sidebar panels do not re-derive rows on an unrelated parent re-render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('MicrotubuleInstancePanel: one row pass, not one per pan frame', () => {
    const polygons = makePolylines('mt');
    const { repaint } = renderUnderChurningParent(() => (
      <MicrotubuleInstancePanel
        polygons={polygons}
        selectedPolygonId={null}
        onSelectPolygon={NOOP}
        hiddenPolygonIds={EMPTY_SET}
        onToggleVisibility={NOOP}
        selectedPolygonIds={EMPTY_SET}
        onToggleSelected={NOOP}
        onSelectAll={NOOP}
        onClearSelection={NOOP}
        onDeletePolygon={NOOP}
        onRenamePolygon={NOOP}
        mtTypeLabels={MT_LABELS}
        mtLabelById={MT_LABEL_BY_ID}
        colorMode="instance"
        onSetColorMode={NOOP}
        onCreateLabel={ASYNC_LABEL}
        onRenameLabel={ASYNC_VOID}
        onDeleteLabel={ASYNC_VOID}
      />
    ));

    const afterMount = (calculatePolylineLength as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    expect(afterMount).toBe(ROWS);

    repaint(PAN_FRAMES);

    // Measured without memoisation at PAN_FRAMES=60: 18 971 calls (311 x 61).
    expect(
      (calculatePolylineLength as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBe(ROWS);
  });

  it('SpermInstancePanel: one row pass, not one per pan frame', () => {
    const polygons = makePolylines('sperm');
    const { repaint } = renderUnderChurningParent(() => (
      <SpermInstancePanel
        polygons={polygons}
        selectedPolygonId={null}
        onSelectPolygon={NOOP}
        activePartClass="head"
        onPartClassChange={NOOP}
        activeInstanceId="sperm_0"
        onInstanceIdChange={NOOP}
      />
    ));

    const afterMount = (calculatePolylineLength as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    repaint(PAN_FRAMES);

    expect(
      (calculatePolylineLength as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBe(afterMount);
  });

  it('PolygonListPanel: one row pass, not one per pan frame', () => {
    const polygons = makeClosedPolygons();
    const { repaint } = renderUnderChurningParent(() => (
      <PolygonListPanel
        loading={false}
        polygons={polygons}
        selectedPolygonId={null}
        onSelectPolygon={NOOP}
        hiddenPolygonIds={EMPTY_SET}
        onTogglePolygonVisibility={NOOP}
        onRenamePolygon={NOOP}
        onDeletePolygon={NOOP}
        selectedPolygonIds={EMPTY_SET}
        onToggleSelected={NOOP}
        onSelectAll={NOOP}
        onClearSelection={NOOP}
      />
    ));

    const afterMount = (neuronClassStyle as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(afterMount).toBeGreaterThan(0);

    repaint(PAN_FRAMES);

    expect(
      (neuronClassStyle as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBe(afterMount);
  });
});
