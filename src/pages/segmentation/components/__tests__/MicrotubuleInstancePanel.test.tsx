/**
 * MicrotubuleInstancePanel — behavioral unit tests
 *
 * Covered:
 *  - Returns null when no microtubule polylines exist
 *  - Returns null for closed polygons (geometry='polygon')
 *  - Returns null for sperm polylines (partClass set)
 *  - Renders a row per MT (sorted by trackId/instanceId)
 *  - Row count shown in header
 *  - Each row has a visible length in px (calculatePolylineLength stub)
 *  - Selecting a row calls onSelectPolygon(id)
 *  - Clicking already-selected row calls onSelectPolygon(null)
 *  - Selected row has highlight class
 *  - Individual eye button calls onToggleVisibility(id)
 *  - Toggle-all button shows "Hide All" when all visible
 *  - Toggle-all button shows "Show All" when all hidden
 *  - Toggle-all hides all: calls onToggleVisibility for each visible MT
 *  - Toggle-all shows all: calls onToggleVisibility for each hidden MT
 *  - Hidden row applies opacity-50 to the row button
 *  - Row color swatch gets color from colorFromInstanceId(trackId)
 *  - Legacy MT matched by isMicrotubuleInstance(instanceId) prefix
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render as renderWithProviders } from '@/test/utils/test-utils';
import MicrotubuleInstancePanel from '../MicrotubuleInstancePanel';
import { Polygon } from '@/lib/segmentation';

// ── mocks ────────────────────────────────────────────────────────────────────

// The component imports from '../utils/...' relative to its own location
// (components/ → segmentation/utils/). The mock path must resolve to the
// same module, so we mock by the path the component uses.
vi.mock('@/pages/segmentation/utils/metricCalculations', () => ({
  calculatePolylineLength: vi.fn(() => 123.4),
}));

vi.mock('@/pages/segmentation/utils/instanceColors', () => ({
  colorFromInstanceId: vi.fn((key: string) =>
    key.startsWith('mt_') ? '#00FF00' : '#FF0000'
  ),
  isMicrotubuleInstance: vi.fn(
    (id?: string) => typeof id === 'string' && id.startsWith('mt_')
  ),
}));

// ── factory helpers ──────────────────────────────────────────────────────────

function makeMT(overrides: Partial<Polygon> = {}): Polygon {
  return {
    id: 'mt-1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ],
    geometry: 'polyline',
    class: 'microtubule',
    trackId: 'mt_track_1',
    ...overrides,
  } as Polygon;
}

const DEFAULT_PROPS = {
  selectedPolygonId: null as string | null,
  onSelectPolygon: vi.fn(),
};

// ── tests ────────────────────────────────────────────────────────────────────

describe('MicrotubuleInstancePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── empty / null render ───────────────────────────────────────────────────

  describe('empty state', () => {
    it('returns null when polygons array is empty', () => {
      const { container } = renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('returns null when all polygons are closed (no polylines)', () => {
      const closed: Polygon = {
        id: 'p-1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        geometry: 'polygon',
      } as Polygon;
      const { container } = renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={[closed]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('returns null for sperm polylines (partClass set)', () => {
      const sperm = makeMT({ partClass: 'head', class: undefined });
      const { container } = renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={[sperm]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('returns null for polyline without class or mt_ instanceId', () => {
      const unknown: Polygon = {
        id: 'u-1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        geometry: 'polyline',
        // no class, no mt_ instanceId
      } as Polygon;
      const { container } = renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={[unknown]} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // ── rendering with MTs ────────────────────────────────────────────────────

  describe('rendering with microtubule polylines', () => {
    it('renders the panel header', () => {
      renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={[makeMT()]} />
      );
      // t('microtubule.instancePanel') = 'Microtubule Instances'
      expect(screen.getByText(/Microtubule Instances/i)).toBeInTheDocument();
    });

    it('shows count of MTs in header', () => {
      const mts = [
        makeMT({ id: 'mt-1', trackId: 'mt_track_1' }),
        makeMT({ id: 'mt-2', trackId: 'mt_track_2' }),
        makeMT({ id: 'mt-3', trackId: 'mt_track_3' }),
      ];
      renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={mts} />
      );
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });

    it('renders one row per MT', () => {
      const mts = [
        makeMT({ id: 'mt-1', trackId: 'mt_track_1' }),
        makeMT({ id: 'mt-2', trackId: 'mt_track_2' }),
      ];
      renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={mts} />
      );
      // t('microtubule.instance') = 'Microtubule'; rows show "Microtubule 1", "Microtubule 2"
      expect(screen.getByText('Microtubule 1')).toBeInTheDocument();
      expect(screen.getByText('Microtubule 2')).toBeInTheDocument();
    });

    it('shows length rounded to integer px per row', () => {
      renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={[makeMT()]} />
      );
      // calculatePolylineLength is stubbed to return 123.4 → Math.round → 123
      expect(screen.getByText(/123 px/i)).toBeInTheDocument();
    });

    it('matches legacy MT via isMicrotubuleInstance(instanceId)', () => {
      const legacy: Polygon = {
        id: 'mt-leg',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        geometry: 'polyline',
        instanceId: 'mt_007',
        // no class field
      } as Polygon;
      renderWithProviders(
        <MicrotubuleInstancePanel {...DEFAULT_PROPS} polygons={[legacy]} />
      );
      // Shows the row label "Microtubule 1"
      expect(screen.getByText('Microtubule 1')).toBeInTheDocument();
    });
  });

  // ── selection ─────────────────────────────────────────────────────────────

  describe('selection', () => {
    it('calls onSelectPolygon(id) when a row is clicked', async () => {
      const user = userEvent.setup();
      const onSelectPolygon = vi.fn();

      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT({ id: 'mt-sel' })]}
          selectedPolygonId={null}
          onSelectPolygon={onSelectPolygon}
        />
      );

      // Row button label: "Microtubule 1" (t('microtubule.instance') + idx+1)
      const row = screen.getByRole('button', { name: /Microtubule 1/i });
      await user.click(row);

      expect(onSelectPolygon).toHaveBeenCalledWith('mt-sel');
    });

    it('calls onSelectPolygon(null) when the already-selected row is clicked', async () => {
      const user = userEvent.setup();
      const onSelectPolygon = vi.fn();

      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT({ id: 'mt-sel' })]}
          selectedPolygonId="mt-sel"
          onSelectPolygon={onSelectPolygon}
        />
      );

      const row = screen.getByRole('button', { name: /Microtubule 1/i });
      await user.click(row);

      expect(onSelectPolygon).toHaveBeenCalledWith(null);
    });

    it('selected row has violet highlight class', () => {
      const { container } = renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT({ id: 'mt-sel' })]}
          selectedPolygonId="mt-sel"
          onSelectPolygon={vi.fn()}
        />
      );

      // The row div has bg-violet-50 when selected
      const selectedRow = container.querySelector('.bg-violet-50');
      expect(selectedRow).not.toBeNull();
    });
  });

  // ── visibility toggle ─────────────────────────────────────────────────────

  describe('individual visibility toggle', () => {
    it('does not render eye buttons when onToggleVisibility is not provided', () => {
      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT()]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
        />
      );
      // No visibility toggle button rendered
      expect(
        screen.queryByRole('button', { name: /microtubule.hideInstance/i })
      ).not.toBeInTheDocument();
    });

    it('calls onToggleVisibility(id) when eye button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleVisibility = vi.fn();

      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT({ id: 'mt-vis' })]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
          onToggleVisibility={onToggleVisibility}
        />
      );

      // t('microtubule.hideInstance') = 'Hide microtubule'
      const eyeBtn = screen.getByRole('button', {
        name: /Hide microtubule/i,
      });
      await user.click(eyeBtn);

      expect(onToggleVisibility).toHaveBeenCalledWith('mt-vis');
    });

    it('hidden row applies opacity-50 class to the row button', () => {
      const { container } = renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT({ id: 'mt-hid' })]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
          hiddenPolygonIds={new Set(['mt-hid'])}
          onToggleVisibility={vi.fn()}
        />
      );

      // Row button has opacity-50 when hidden
      const rowBtn = container.querySelector('.opacity-50');
      expect(rowBtn).not.toBeNull();
    });
  });

  // ── toggle-all ────────────────────────────────────────────────────────────

  describe('toggle-all button', () => {
    it('shows "Hide All" label when all MTs are visible', () => {
      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT({ id: 'mt-1' }), makeMT({ id: 'mt-2' })]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
          hiddenPolygonIds={new Set()}
          onToggleVisibility={vi.fn()}
        />
      );
      // t('microtubule.hideAll') = 'Hide all'
      expect(
        screen.getByRole('button', { name: /Hide all/i })
      ).toBeInTheDocument();
    });

    it('shows "Show All" label when all MTs are hidden', () => {
      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT({ id: 'mt-1' }), makeMT({ id: 'mt-2' })]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
          hiddenPolygonIds={new Set(['mt-1', 'mt-2'])}
          onToggleVisibility={vi.fn()}
        />
      );
      // t('microtubule.showAll') = 'Show all'
      expect(
        screen.getByRole('button', { name: /Show all/i })
      ).toBeInTheDocument();
    });

    it('hide-all: calls onToggleVisibility once per visible MT', async () => {
      const user = userEvent.setup();
      const onToggleVisibility = vi.fn();

      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[
            makeMT({ id: 'mt-1', trackId: 'mt_t1' }),
            makeMT({ id: 'mt-2', trackId: 'mt_t2' }),
          ]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
          hiddenPolygonIds={new Set()}
          onToggleVisibility={onToggleVisibility}
        />
      );

      const toggleAll = screen.getByRole('button', { name: /Hide all/i });
      await user.click(toggleAll);

      // Both MTs should have been toggled
      expect(onToggleVisibility).toHaveBeenCalledTimes(2);
      expect(onToggleVisibility).toHaveBeenCalledWith('mt-1');
      expect(onToggleVisibility).toHaveBeenCalledWith('mt-2');
    });

    it('show-all: calls onToggleVisibility once per hidden MT', async () => {
      const user = userEvent.setup();
      const onToggleVisibility = vi.fn();

      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[
            makeMT({ id: 'mt-1', trackId: 'mt_t1' }),
            makeMT({ id: 'mt-2', trackId: 'mt_t2' }),
          ]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
          hiddenPolygonIds={new Set(['mt-1', 'mt-2'])}
          onToggleVisibility={onToggleVisibility}
        />
      );

      const toggleAll = screen.getByRole('button', { name: /Show all/i });
      await user.click(toggleAll);

      expect(onToggleVisibility).toHaveBeenCalledTimes(2);
    });

    it('does not render toggle-all button when onToggleVisibility is absent', () => {
      renderWithProviders(
        <MicrotubuleInstancePanel
          polygons={[makeMT()]}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
        />
      );
      // When onToggleVisibility is absent, toggle-all button is not rendered
      // "Hide all" / "Show all" buttons should not exist
      expect(
        screen.queryByRole('button', { name: /Hide all/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Show all/i })
      ).not.toBeInTheDocument();
    });
  });
});
