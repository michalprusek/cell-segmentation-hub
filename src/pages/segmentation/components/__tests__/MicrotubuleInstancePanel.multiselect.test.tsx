/**
 * MicrotubuleInstancePanel — multi-select checkbox column
 *
 * Mirrors the PolygonListPanel checkbox behaviour: a row is checked when it is
 * the single selection OR a member of the Shift+click multi-select set;
 * toggling a checkbox calls onToggleSelected(id); the header select-all
 * checkbox calls onSelectAll(ids) / onClearSelection; and the column is hidden
 * when onToggleSelected is omitted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render as renderWithProviders } from '@/test/utils/test-utils';
import MicrotubuleInstancePanel from '../MicrotubuleInstancePanel';
import { Polygon } from '@/lib/segmentation';

vi.mock('@/pages/segmentation/utils/metricCalculations', () => ({
  calculatePolylineLength: vi.fn(() => 123.4),
}));

vi.mock('@/pages/segmentation/utils/instanceColors', () => ({
  colorFromInstanceId: vi.fn(() => '#00FF00'),
  isMicrotubuleInstance: vi.fn(
    (id?: string) => typeof id === 'string' && id.startsWith('mt_')
  ),
}));

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

// Sorted by trackId → "Microtubule 1/2/3" in this order.
const MTS = [
  makeMT({ id: 'mtA', trackId: 'mt_track_1' }),
  makeMT({ id: 'mtB', trackId: 'mt_track_2' }),
  makeMT({ id: 'mtC', trackId: 'mt_track_3' }),
];

function renderPanel(
  props: Partial<React.ComponentProps<typeof MicrotubuleInstancePanel>> = {}
) {
  const onToggleSelected = vi.fn();
  const onSelectAll = vi.fn();
  const onClearSelection = vi.fn();
  const onSelectPolygon = vi.fn();
  const utils = renderWithProviders(
    <MicrotubuleInstancePanel
      polygons={MTS}
      selectedPolygonId={null}
      onSelectPolygon={onSelectPolygon}
      selectedPolygonIds={new Set<string>()}
      onToggleSelected={onToggleSelected}
      onSelectAll={onSelectAll}
      onClearSelection={onClearSelection}
      {...props}
    />
  );
  return {
    onToggleSelected,
    onSelectAll,
    onClearSelection,
    onSelectPolygon,
    ...utils,
  };
}

describe('MicrotubuleInstancePanel — multi-select checkboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the checkbox column when onToggleSelected is omitted', () => {
    renderWithProviders(
      <MicrotubuleInstancePanel
        polygons={MTS}
        selectedPolygonId={null}
        onSelectPolygon={vi.fn()}
      />
    );
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('renders one checkbox per MT row plus a header select-all checkbox', () => {
    renderPanel();
    expect(screen.getAllByRole('checkbox')).toHaveLength(MTS.length + 1);
    expect(
      screen.getByRole('checkbox', { name: /select all/i })
    ).toBeInTheDocument();
  });

  it('checks the single-selected row and multi-selected rows', () => {
    renderPanel({
      selectedPolygonId: 'mtA',
      selectedPolygonIds: new Set(['mtC']),
    });
    expect(
      screen.getByRole('checkbox', { name: 'Microtubule 1' })
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Microtubule 3' })
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Microtubule 2' })
    ).not.toBeChecked();
  });

  it('toggling a row checkbox calls onToggleSelected with that MT id', () => {
    const { onToggleSelected, onSelectPolygon } = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Microtubule 2' }));
    expect(onToggleSelected).toHaveBeenCalledWith('mtB');
    expect(onSelectPolygon).not.toHaveBeenCalled();
  });

  it('header select-all calls onSelectAll with every MT id when none selected', () => {
    const { onSelectAll } = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    expect(onSelectAll).toHaveBeenCalledWith(['mtA', 'mtB', 'mtC']);
  });

  it('header select-all calls onClearSelection when all are selected', () => {
    const { onClearSelection } = renderPanel({
      selectedPolygonIds: new Set(['mtA', 'mtB', 'mtC']),
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /deselect all/i }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  // Delete lives in this panel now that the generic Polygon List is hidden for
  // MT projects.
  it('renders a delete button per row and calls onDeletePolygon with the MT id', () => {
    const onDeletePolygon = vi.fn();
    renderWithProviders(
      <MicrotubuleInstancePanel
        polygons={MTS}
        selectedPolygonId={null}
        onSelectPolygon={vi.fn()}
        onDeletePolygon={onDeletePolygon}
      />
    );
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteButtons).toHaveLength(MTS.length);
    fireEvent.click(deleteButtons[0]);
    expect(onDeletePolygon).toHaveBeenCalledWith('mtA');
  });

  it('hides the delete button when onDeletePolygon is omitted', () => {
    renderWithProviders(
      <MicrotubuleInstancePanel
        polygons={MTS}
        selectedPolygonId={null}
        onSelectPolygon={vi.fn()}
      />
    );
    expect(screen.queryAllByRole('button', { name: /delete/i })).toHaveLength(
      0
    );
  });
});
