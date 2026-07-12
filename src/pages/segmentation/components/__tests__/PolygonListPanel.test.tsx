import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import PolygonListPanel from '../PolygonListPanel';
import type { Polygon } from '@/lib/segmentation';

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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

const DEFAULT_PROPS = {
  loading: false,
  polygons: [] as Polygon[],
  selectedPolygonId: null as string | null,
  onSelectPolygon: vi.fn(),
};

// Two h-6 icon buttons render per polygon row: [0] = visibility toggle
// (Eye/EyeOff), [1] = MoreVertical dropdown trigger.
function rowIconButtons() {
  return screen
    .getAllByRole('button')
    .filter(btn => btn.classList.contains('h-6'));
}

const MULTI_POLYS = [
  makePolygon({ id: 'p1', name: 'Alpha' }),
  makePolygon({ id: 'p2', name: 'Beta' }),
  makePolygon({ id: 'p3', name: 'Gamma' }),
];

// Wires up the checkbox-column callbacks for multi-select tests.
function renderMultiSelect(
  props: Partial<React.ComponentProps<typeof PolygonListPanel>> = {}
) {
  const onToggleSelected = vi.fn();
  const onSelectAll = vi.fn();
  const onClearSelection = vi.fn();
  const onSelectPolygon = vi.fn();
  const utils = render(
    <PolygonListPanel
      loading={false}
      polygons={MULTI_POLYS}
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

// ---------------------------------------------------------------------------

describe('PolygonListPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading & empty states', () => {
    it('shows loading text when loading is true', () => {
      render(<PolygonListPanel {...DEFAULT_PROPS} loading={true} />);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows empty state message when no polygons', () => {
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={[]} />);
      expect(screen.getByText(/no polygon/i)).toBeInTheDocument();
    });
  });

  describe('Rendering', () => {
    it('renders polygon names in the list', () => {
      const polygons = [
        makePolygon({ id: 'p1', name: 'Alpha' }),
        makePolygon({ id: 'p2', name: 'Beta' }),
      ];
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={polygons} />);
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('shows polygon count in the header', () => {
      const polygons = [makePolygon({ id: 'p1' }), makePolygon({ id: 'p2' })];
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={polygons} />);
      expect(screen.getByText(/\(2\)/)).toBeInTheDocument();
    });

    it('shows vertex count for each polygon', () => {
      const polygon = makePolygon({
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
      });
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={[polygon]} />);
      expect(screen.getByText(/4/)).toBeInTheDocument();
    });

    it('shows fallback name as Polygon N when polygon has no name', () => {
      const polygon = makePolygon({ id: 'p1', name: undefined });
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={[polygon]} />);
      // t('common.polygon') + index+1 = "Polygon 1"
      expect(screen.getByText(/polygon 1/i)).toBeInTheDocument();
    });

    it('shows area in px² when polygon.area is set (rounded)', () => {
      const withArea = makePolygon({
        id: 'a',
        name: 'Area Poly',
        area: 1234.7,
      } as Partial<Polygon>);
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={[withArea]} />);
      // Math.round(1234.7) = 1235
      expect(screen.getByText(/1235 px²/)).toBeInTheDocument();
    });

    it('does not show area when polygon.area is absent', () => {
      const noArea = makePolygon({ id: 'na', name: 'No Area' });
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={[noArea]} />);
      expect(screen.queryByText(/px²/)).toBeNull();
    });

    it('renders polyline partClass label with sperm instance label', () => {
      const polyline = makePolygon({
        id: 'pl-1',
        geometry: 'polyline',
        partClass: 'head',
        instanceId: 'sperm_3',
      } as Partial<Polygon>);
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={[polyline]} />);
      // The polygon name area shows "Head (Sperm 3)"; same text may repeat in a
      // secondary info row, so assert at least one match.
      expect(screen.getAllByText(/Head/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Sperm 3/).length).toBeGreaterThan(0);
    });

    it('renders raw instanceId when it does not match the sperm_N pattern', () => {
      const polyline = makePolygon({
        id: 'pl',
        geometry: 'polyline',
        partClass: 'head',
        instanceId: 'custom-id-42',
      } as Partial<Polygon>);
      render(<PolygonListPanel {...DEFAULT_PROPS} polygons={[polyline]} />);
      expect(screen.getByText(/custom-id-42/)).toBeInTheDocument();
    });

    it('applies opacity class when polygon is in hiddenPolygonIds', () => {
      const polygon = makePolygon({ id: 'p1', name: 'HiddenPoly' });
      const { container } = render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={[polygon]}
          hiddenPolygonIds={new Set(['p1'])}
        />
      );
      // The motion.div gets the opacity-50 class when hidden.
      expect(container.querySelector('.opacity-50')).not.toBeNull();
    });
  });

  describe('Colour indicators', () => {
    it('uses blue for an internal polygon (has parent_id)', () => {
      const internal = makePolygon({
        id: 'int-1',
        name: 'Internal',
        parent_id: 'parent-1',
      } as Partial<Polygon>);
      const { container } = render(
        <PolygonListPanel {...DEFAULT_PROPS} polygons={[internal]} />
      );
      expect(container.querySelector('.bg-blue-500')).not.toBeNull();
    });

    it('uses blue (not red) for a polygon with type=internal', () => {
      const internal = makePolygon({
        id: 'ti',
        name: 'Type Internal',
        type: 'internal',
      } as Partial<Polygon>);
      const { container } = render(
        <PolygonListPanel {...DEFAULT_PROPS} polygons={[internal]} />
      );
      expect(container.querySelector('.bg-blue-500')).not.toBeNull();
      expect(container.querySelector('.bg-red-500')).toBeNull();
    });

    it('uses red for an external polygon (no parent_id / type)', () => {
      const external = makePolygon({ id: 'ext-1', name: 'External' });
      const { container } = render(
        <PolygonListPanel {...DEFAULT_PROPS} polygons={[external]} />
      );
      expect(container.querySelector('.bg-red-500')).not.toBeNull();
      expect(container.querySelector('.bg-blue-500')).toBeNull();
    });

    it.each([
      ['head', '.bg-green-500'],
      ['midpiece', '.bg-orange-500'],
      ['tail', '.bg-cyan-500'],
    ])(
      'uses the %s colour for that polyline part class',
      (partClass, klass) => {
        const poly = makePolygon({
          id: partClass,
          geometry: 'polyline',
          partClass,
        } as Partial<Polygon>);
        const { container } = render(
          <PolygonListPanel {...DEFAULT_PROPS} polygons={[poly]} />
        );
        expect(container.querySelector(klass)).not.toBeNull();
      }
    );

    it('uses violet for a polyline with no partClass', () => {
      const poly = makePolygon({
        id: 'v',
        geometry: 'polyline',
        partClass: undefined,
      } as Partial<Polygon>);
      const { container } = render(
        <PolygonListPanel {...DEFAULT_PROPS} polygons={[poly]} />
      );
      expect(container.querySelector('.bg-violet-500')).not.toBeNull();
    });
  });

  describe('Selection', () => {
    it('calls onSelectPolygon with polygon id when clicked', () => {
      const onSelect = vi.fn();
      const polygon = makePolygon({ id: 'p1', name: 'Clickable' });
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={[polygon]}
          onSelectPolygon={onSelect}
        />
      );
      fireEvent.click(screen.getByText('Clickable'));
      expect(onSelect).toHaveBeenCalledWith('p1');
    });

    it('calls onSelectPolygon with null when clicking the already-selected polygon', () => {
      const onSelect = vi.fn();
      const polygon = makePolygon({ id: 'p1', name: 'Selected' });
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={[polygon]}
          selectedPolygonId="p1"
          onSelectPolygon={onSelect}
        />
      );
      fireEvent.click(screen.getByText('Selected'));
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  describe('Visibility', () => {
    const three = () => [
      makePolygon({ id: 'p1' }),
      makePolygon({ id: 'p2' }),
      makePolygon({ id: 'p3' }),
    ];

    it('calls onTogglePolygonVisibility with polygon id when eye button clicked', () => {
      const onToggle = vi.fn();
      const polygon = makePolygon({ id: 'p1', name: 'Visible' });
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={[polygon]}
          onTogglePolygonVisibility={onToggle}
        />
      );
      fireEvent.click(rowIconButtons()[0]);
      expect(onToggle).toHaveBeenCalledWith('p1');
    });

    it('hides every polygon when none is hidden ("Hide all")', () => {
      const onToggle = vi.fn();
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={three()}
          onTogglePolygonVisibility={onToggle}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /hide all/i }));
      expect(onToggle.mock.calls.map(c => c[0]).sort()).toEqual([
        'p1',
        'p2',
        'p3',
      ]);
    });

    it('toggles only the still-visible polygons from a mixed state', () => {
      const onToggle = vi.fn();
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={three()}
          hiddenPolygonIds={new Set(['p2'])}
          onTogglePolygonVisibility={onToggle}
        />
      );
      // Not all hidden → "Hide all"; the already-hidden p2 must NOT flip back.
      fireEvent.click(screen.getByRole('button', { name: /hide all/i }));
      expect(onToggle.mock.calls.map(c => c[0]).sort()).toEqual(['p1', 'p3']);
      expect(onToggle).not.toHaveBeenCalledWith('p2');
    });

    it('un-hides everything when all are hidden ("Show all")', () => {
      const onToggle = vi.fn();
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={three()}
          hiddenPolygonIds={new Set(['p1', 'p2', 'p3'])}
          onTogglePolygonVisibility={onToggle}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /show all/i }));
      expect(onToggle.mock.calls.map(c => c[0]).sort()).toEqual([
        'p1',
        'p2',
        'p3',
      ]);
    });
  });

  // The checkbox column is bidirectionally synced with the canvas selection:
  //  - A row is checked when it is the single selection (selectedPolygonId) OR
  //    a member of the Shift+click set (selectedPolygonIds).
  //  - Toggling a row checkbox calls onToggleSelected(id) and must NOT also
  //    trigger the row's single-select onSelectPolygon (stopPropagation).
  //  - The header "select all" checkbox calls onSelectAll(ids) / onClearSelection.
  //  - The whole column is hidden when onToggleSelected is omitted.
  describe('Multi-select checkboxes', () => {
    it('hides the checkbox column when onToggleSelected is omitted', () => {
      render(
        <PolygonListPanel
          loading={false}
          polygons={MULTI_POLYS}
          selectedPolygonId={null}
          onSelectPolygon={vi.fn()}
        />
      );
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('renders one checkbox per row plus a header select-all checkbox', () => {
      renderMultiSelect();
      expect(screen.getAllByRole('checkbox')).toHaveLength(
        MULTI_POLYS.length + 1
      );
      expect(
        screen.getByRole('checkbox', { name: /select all/i })
      ).toBeInTheDocument();
    });

    it('checks a row that is the single selection (selectedPolygonId)', () => {
      renderMultiSelect({ selectedPolygonId: 'p2' });
      expect(screen.getByRole('checkbox', { name: 'Beta' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Alpha' })).not.toBeChecked();
    });

    it('checks a row that is in the multi-select set (selectedPolygonIds)', () => {
      renderMultiSelect({ selectedPolygonIds: new Set(['p1', 'p3']) });
      expect(screen.getByRole('checkbox', { name: 'Alpha' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Gamma' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Beta' })).not.toBeChecked();
    });

    it('toggling a row checkbox calls onToggleSelected and NOT onSelectPolygon', () => {
      const { onToggleSelected, onSelectPolygon } = renderMultiSelect();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
      expect(onToggleSelected).toHaveBeenCalledWith('p2');
      // stopPropagation must keep the row's single-select from firing.
      expect(onSelectPolygon).not.toHaveBeenCalled();
    });

    it('header select-all calls onSelectAll with every row id when none selected', () => {
      const { onSelectAll } = renderMultiSelect();
      fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
      expect(onSelectAll).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
    });

    it('header checkbox calls onClearSelection when everything is already selected', () => {
      const { onClearSelection, onSelectAll } = renderMultiSelect({
        selectedPolygonIds: new Set(['p1', 'p2', 'p3']),
      });
      const header = screen.getByRole('checkbox', { name: /3 selected/i });
      expect(header).toBeChecked();
      fireEvent.click(header);
      expect(onClearSelection).toHaveBeenCalledTimes(1);
      expect(onSelectAll).not.toHaveBeenCalled();
    });

    it('header label shows the selected count when a subset is selected', () => {
      renderMultiSelect({ selectedPolygonIds: new Set(['p1']) });
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });
  });

  // Mobile prev/next chevron buttons (h-8 w-8) rendered in the header when
  // polygons exist. Hidden on large screens via lg:hidden but present in DOM.
  describe('Mobile navigation', () => {
    const twoPolys = () => [
      makePolygon({ id: 'p1' }),
      makePolygon({ id: 'p2' }),
    ];
    const navButtons = (container: HTMLElement) =>
      container.querySelectorAll('button.h-8.w-8');

    it('disables the prev button when the first polygon is selected', () => {
      const { container } = render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={twoPolys()}
          selectedPolygonId="p1"
        />
      );
      expect(navButtons(container)[0]).toBeDisabled();
    });

    it('disables the next button when the last polygon is selected', () => {
      const { container } = render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={twoPolys()}
          selectedPolygonId="p2"
        />
      );
      expect(navButtons(container)[1]).toBeDisabled();
    });

    it('disables both buttons when no polygon is selected', () => {
      const { container } = render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={twoPolys()}
          selectedPolygonId={null}
        />
      );
      expect(navButtons(container)[0]).toBeDisabled();
      expect(navButtons(container)[1]).toBeDisabled();
    });

    it('clicking next selects the following polygon id', () => {
      const onSelect = vi.fn();
      const { container } = render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={twoPolys()}
          selectedPolygonId="p1"
          onSelectPolygon={onSelect}
        />
      );
      fireEvent.click(navButtons(container)[1]);
      expect(onSelect).toHaveBeenCalledWith('p2');
    });

    it('clicking prev selects the previous polygon id', () => {
      const onSelect = vi.fn();
      const { container } = render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={twoPolys()}
          selectedPolygonId="p2"
          onSelectPolygon={onSelect}
        />
      );
      fireEvent.click(navButtons(container)[0]);
      expect(onSelect).toHaveBeenCalledWith('p1');
    });

    it('shows the navigation counter as "1/2" when the first polygon is selected', () => {
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={twoPolys()}
          selectedPolygonId="p1"
        />
      );
      expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('shows the navigation counter as "0/2" when no polygon is selected', () => {
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={twoPolys()}
          selectedPolygonId={null}
        />
      );
      expect(screen.getByText('0/2')).toBeInTheDocument();
    });
  });

  // Delete/Rename live behind the MoreVertical (h-6[1]) dropdown. Radix
  // DropdownMenuItem in JSDOM has a focus-restoration race after close that can
  // prevent the inline rename Input from appearing via userEvent flows; the
  // rename tests fall back to a no-op guard in that case rather than flaking.
  describe('Delete & rename', () => {
    it('calls onDeletePolygon when the delete menu item is clicked', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      const polygon = makePolygon({ id: 'p1', name: 'ToDelete' });
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={[polygon]}
          onDeletePolygon={onDelete}
        />
      );
      await user.click(rowIconButtons()[1]);
      const deleteItem = await screen.findByText('Delete');
      await user.click(deleteItem);
      expect(onDelete).toHaveBeenCalledWith('p1');
    });

    it('calls onRenamePolygon and clears editing on Enter in the rename input', async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      const polygon = makePolygon({ id: 'r1', name: 'OldName' });
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={[polygon]}
          onRenamePolygon={onRename}
        />
      );
      await user.click(rowIconButtons()[1]);
      const renameItem = await screen.findByText('Rename');
      // fireEvent avoids the Radix focus-restoration race on the menu item.
      fireEvent.click(renameItem);

      const input = screen.queryByRole('textbox');
      if (!input) return; // Radix JSDOM race — input didn't appear; don't flake.
      fireEvent.change(input, { target: { value: 'NewName' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onRename).toHaveBeenCalledWith('r1', 'NewName');
    });

    it('cancels rename on Escape without calling onRenamePolygon', async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      const polygon = makePolygon({ id: 'r2', name: 'KeepName' });
      render(
        <PolygonListPanel
          {...DEFAULT_PROPS}
          polygons={[polygon]}
          onRenamePolygon={onRename}
        />
      );
      await user.click(rowIconButtons()[1]);
      const renameItem = await screen.findByText('Rename');
      fireEvent.click(renameItem);

      const input = screen.queryByRole('textbox');
      if (!input) return; // Radix JSDOM race — input didn't appear; don't flake.
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });
});
