/**
 * PolygonListPanel — multi-select checkbox column
 *
 * The checkbox column is bidirectionally synced with the canvas selection:
 *  - A row is checked when it is the single selection (`selectedPolygonId`) OR
 *    a member of the Shift+click multi-select set (`selectedPolygonIds`).
 *  - Toggling a row checkbox calls `onToggleSelected(id)` and must NOT also
 *    trigger the row's single-select `onSelectPolygon` (stopPropagation).
 *  - The header "select all" checkbox calls `onSelectAll(ids)` / `onClearSelection`.
 *  - The whole column is hidden when `onToggleSelected` is omitted.
 */

import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/utils/test-utils';
import PolygonListPanel from '../PolygonListPanel';
import { Polygon } from '@/lib/segmentation';

// framer-motion animate calls requestAnimationFrame; stub to avoid flakiness
// and to keep the row-level onClick handler intact for propagation tests.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...rest}>{children}</div>,
  },
}));

function makePolygon(overrides: Partial<Polygon> = {}): Polygon {
  return {
    id: 'poly-1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    name: 'Test Polygon',
    geometry: 'polygon',
    ...overrides,
  } as Polygon;
}

const POLYS = [
  makePolygon({ id: 'p1', name: 'Alpha' }),
  makePolygon({ id: 'p2', name: 'Beta' }),
  makePolygon({ id: 'p3', name: 'Gamma' }),
];

function renderPanel(
  props: Partial<React.ComponentProps<typeof PolygonListPanel>> = {}
) {
  const onToggleSelected = vi.fn();
  const onSelectAll = vi.fn();
  const onClearSelection = vi.fn();
  const onSelectPolygon = vi.fn();
  const utils = render(
    <PolygonListPanel
      loading={false}
      polygons={POLYS}
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

describe('PolygonListPanel — multi-select checkboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the checkbox column when onToggleSelected is omitted', () => {
    render(
      <PolygonListPanel
        loading={false}
        polygons={POLYS}
        selectedPolygonId={null}
        onSelectPolygon={vi.fn()}
      />
    );
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('renders one checkbox per row plus a header select-all checkbox', () => {
    renderPanel();
    // 3 rows + 1 header select-all
    expect(screen.getAllByRole('checkbox')).toHaveLength(POLYS.length + 1);
    expect(
      screen.getByRole('checkbox', { name: /select all/i })
    ).toBeInTheDocument();
  });

  it('checks a row that is the single selection (selectedPolygonId)', () => {
    renderPanel({ selectedPolygonId: 'p2' });
    expect(screen.getByRole('checkbox', { name: 'Beta' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Alpha' })).not.toBeChecked();
  });

  it('checks a row that is in the multi-select set (selectedPolygonIds)', () => {
    renderPanel({ selectedPolygonIds: new Set(['p1', 'p3']) });
    expect(screen.getByRole('checkbox', { name: 'Alpha' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Gamma' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beta' })).not.toBeChecked();
  });

  it('toggling a row checkbox calls onToggleSelected and NOT onSelectPolygon', () => {
    const { onToggleSelected, onSelectPolygon } = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
    expect(onToggleSelected).toHaveBeenCalledWith('p2');
    // stopPropagation must keep the row's single-select from firing.
    expect(onSelectPolygon).not.toHaveBeenCalled();
  });

  it('header select-all calls onSelectAll with every row id when none selected', () => {
    const { onSelectAll } = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    expect(onSelectAll).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
  });

  it('header checkbox calls onClearSelection when everything is already selected', () => {
    const { onClearSelection, onSelectAll } = renderPanel({
      selectedPolygonIds: new Set(['p1', 'p2', 'p3']),
    });
    // All rows selected → the header label shows the count and its checkbox is
    // checked; clicking it clears the whole selection instead of re-selecting.
    const header = screen.getByRole('checkbox', { name: /3 selected/i });
    expect(header).toBeChecked();
    fireEvent.click(header);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(onSelectAll).not.toHaveBeenCalled();
  });

  it('header label shows the selected count when a subset is selected', () => {
    renderPanel({ selectedPolygonIds: new Set(['p1']) });
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
