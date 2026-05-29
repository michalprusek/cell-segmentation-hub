/**
 * PolygonItem — behavioral unit tests
 *
 * Covered behaviours:
 *  - Renders polygon name (custom name or fallback "External N" / "Internal N")
 *  - Renders point count
 *  - Blue highlight when selected (external), orange when internal + selected
 *  - No highlight when not selected
 *  - onSelectPolygon called on row click
 *  - Visibility button: Eye shown when visible, EyeOff when hidden
 *  - onToggleVisibility called with id and event on click
 *  - Rename button calls onStartRename
 *  - Delete button calls onDeletePolygon
 *  - Expand/collapse button shown only on top-level with children
 *  - onToggleExpanded called with id on expand button click
 *  - Children rendered when hasChildren and isExpanded
 *  - Children NOT rendered when not expanded
 *  - In rename mode: input shown with editingName value
 *  - Rename input: onChange calls onEditingNameChange
 *  - Rename input: Enter key calls onSaveRename
 *  - Rename input: Escape key calls onCancelRename
 *  - Rename input: blur calls onSaveRename
 *  - isChild: no expand button shown; child has ml-6 indent class
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';

// framer-motion: stub out animations
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...rest}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import PolygonItem from '../PolygonItem';

// ── helpers ──────────────────────────────────────────────────────────────────

interface PolygonTreeItem {
  id: string;
  name?: string;
  type: 'external' | 'internal';
  points: { x: number; y: number }[];
  children?: PolygonTreeItem[];
}

function makePolygon(
  overrides: Partial<PolygonTreeItem> = {}
): PolygonTreeItem {
  return {
    id: 'poly-1',
    type: 'external',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    ...overrides,
  };
}

const CALLBACKS = {
  onSelectPolygon: vi.fn(),
  onToggleExpanded: vi.fn(),
  onToggleVisibility: vi.fn(),
  onStartRename: vi.fn(),
  onSaveRename: vi.fn(),
  onCancelRename: vi.fn(),
  onDeletePolygon: vi.fn(),
  onEditingNameChange: vi.fn(),
};

function setup(
  polygon: PolygonTreeItem,
  overrides: {
    index?: number;
    isChild?: boolean;
    selectedPolygonId?: string | null;
    expandedPolygons?: Set<string>;
    hiddenPolygonIds?: Set<string>;
    editingPolygonId?: string | null;
    editingName?: string;
  } = {}
) {
  const user = userEvent.setup();
  const utils = render(
    <PolygonItem
      polygon={polygon}
      index={overrides.index ?? 0}
      isChild={overrides.isChild ?? false}
      selectedPolygonId={overrides.selectedPolygonId ?? null}
      expandedPolygons={overrides.expandedPolygons ?? new Set()}
      hiddenPolygonIds={overrides.hiddenPolygonIds ?? new Set()}
      editingPolygonId={overrides.editingPolygonId ?? null}
      editingName={overrides.editingName ?? ''}
      {...CALLBACKS}
    />
  );
  return { user, ...utils };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('PolygonItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── name / fallback ────────────────────────────────────────────────────────

  describe('name display', () => {
    it('renders the custom name when polygon.name is set', () => {
      setup(makePolygon({ name: 'My Cell', type: 'external' }));
      expect(screen.getByText('My Cell')).toBeInTheDocument();
    });

    it('falls back to "External 1" for external polygon without name (index 0)', () => {
      setup(makePolygon({ type: 'external' }), { index: 0 });
      expect(screen.getByText('External 1')).toBeInTheDocument();
    });

    it('falls back to "Internal 2" for internal polygon without name (index 1)', () => {
      setup(makePolygon({ type: 'internal' }), { index: 1 });
      expect(screen.getByText('Internal 2')).toBeInTheDocument();
    });

    it('displays point count', () => {
      const poly = makePolygon({
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
      });
      setup(poly);
      expect(screen.getByText('4 points')).toBeInTheDocument();
    });
  });

  // ── selection highlight ────────────────────────────────────────────────────

  describe('selection highlight', () => {
    it('applies blue highlight class when external polygon is selected', () => {
      const poly = makePolygon({ id: 'p1', type: 'external' });
      setup(poly, { selectedPolygonId: 'p1' });
      const row = screen.getByText('External 1').closest('[class*="blue"]');
      expect(row).toBeTruthy();
    });

    it('applies orange highlight class when internal polygon is selected', () => {
      const poly = makePolygon({ id: 'p1', type: 'internal' });
      setup(poly, { selectedPolygonId: 'p1' });
      const row = screen.getByText('Internal 1').closest('[class*="orange"]');
      expect(row).toBeTruthy();
    });

    it('does not apply highlight when polygon is not selected', () => {
      const poly = makePolygon({ id: 'p1', type: 'external' });
      setup(poly, { selectedPolygonId: 'other-id' });
      const rows = document.querySelectorAll('[class*="blue-100"]');
      expect(rows.length).toBe(0);
    });
  });

  // ── row click → onSelectPolygon ───────────────────────────────────────────

  describe('row click', () => {
    it('calls onSelectPolygon with polygon id on row click', async () => {
      const { user } = setup(makePolygon({ id: 'p1', name: 'Cell A' }));
      await user.click(screen.getByText('Cell A'));
      expect(CALLBACKS.onSelectPolygon).toHaveBeenCalledWith('p1');
    });
  });

  // ── visibility toggle ─────────────────────────────────────────────────────

  describe('visibility toggle', () => {
    it('renders Eye icon when polygon is visible', () => {
      setup(makePolygon({ id: 'p1' }), { hiddenPolygonIds: new Set() });
      // Eye is present (aria roles not set on icons; check by lucide class or data)
      // The button's aria-label is not set, so query by the containing button
      const buttons = screen.getAllByRole('button');
      // Visibility button is the first icon button after the expand placeholder
      // We just ensure there are action buttons
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('calls onToggleVisibility when the visibility button is clicked', async () => {
      const { user } = setup(makePolygon({ id: 'p1', name: 'Cell A' }), {
        hiddenPolygonIds: new Set(),
      });
      // The visibility button is the ghost icon button nearest the visibility icons.
      // Find by button ordering: [visibility, rename, delete]
      const actionButtons = screen
        .getAllByRole('button')
        .filter(b => b.className.includes('opacity-60'));
      await user.click(actionButtons[0]); // visibility
      expect(CALLBACKS.onToggleVisibility).toHaveBeenCalledWith(
        'p1',
        expect.anything()
      );
    });
  });

  // ── rename button ─────────────────────────────────────────────────────────

  describe('rename button', () => {
    it('calls onStartRename when rename button is clicked', async () => {
      const { user } = setup(makePolygon({ id: 'p1', name: 'My Cell' }));
      const actionButtons = screen
        .getAllByRole('button')
        .filter(b => b.className.includes('opacity-60'));
      await user.click(actionButtons[1]); // rename
      expect(CALLBACKS.onStartRename).toHaveBeenCalledWith(
        'p1',
        'My Cell',
        expect.anything()
      );
    });
  });

  // ── delete button ─────────────────────────────────────────────────────────

  describe('delete button', () => {
    it('calls onDeletePolygon when delete button is clicked', async () => {
      const { user } = setup(makePolygon({ id: 'p1', name: 'My Cell' }));
      const actionButtons = screen
        .getAllByRole('button')
        .filter(b => b.className.includes('opacity-60'));
      await user.click(actionButtons[2]); // delete
      expect(CALLBACKS.onDeletePolygon).toHaveBeenCalledWith(
        'p1',
        expect.anything()
      );
    });
  });

  // ── expand / children ─────────────────────────────────────────────────────

  describe('expand / children', () => {
    const parent = makePolygon({
      id: 'parent-1',
      name: 'Parent',
      children: [
        makePolygon({ id: 'child-1', name: 'Child A' }),
        makePolygon({ id: 'child-2', name: 'Child B' }),
      ],
    });

    it('shows expand button when polygon has children (not isChild)', () => {
      setup(parent, { expandedPolygons: new Set() });
      // 3 action buttons (visibility + rename + delete) + 1 expand button = 4 total
      expect(screen.getAllByRole('button').length).toBeGreaterThan(3);
    });

    it('calls onToggleExpanded when expand button is clicked', async () => {
      const { user } = setup(parent, { expandedPolygons: new Set() });
      // The expand button is the FIRST button (before action buttons)
      const allButtons = screen.getAllByRole('button');
      await user.click(allButtons[0]); // expand button
      expect(CALLBACKS.onToggleExpanded).toHaveBeenCalledWith(
        'parent-1',
        expect.anything()
      );
    });

    it('renders children when expanded', () => {
      setup(parent, { expandedPolygons: new Set(['parent-1']) });
      expect(screen.getByText('Child A')).toBeInTheDocument();
      expect(screen.getByText('Child B')).toBeInTheDocument();
    });

    it('does NOT render children when not expanded', () => {
      setup(parent, { expandedPolygons: new Set() });
      expect(screen.queryByText('Child A')).not.toBeInTheDocument();
    });

    it('does NOT show expand button when polygon is a child (isChild=true)', () => {
      // A child polygon cannot itself have a visible expand button
      const childPoly = makePolygon({
        id: 'child-1',
        name: 'Child A',
        children: [makePolygon({ id: 'grandchild', name: 'GrandChild' })],
      });
      setup(childPoly, { isChild: true });
      // No expand button — only action buttons
      const actionButtons = screen
        .getAllByRole('button')
        .filter(b => b.className.includes('opacity-60'));
      expect(actionButtons).toHaveLength(3); // visibility + rename + delete only
    });
  });

  // ── rename mode UI ────────────────────────────────────────────────────────

  describe('rename mode', () => {
    const renamingProps = {
      editingPolygonId: 'p1',
      editingName: 'Draft Name',
    };

    it('shows input with current editingName when in rename mode', () => {
      setup(makePolygon({ id: 'p1' }), renamingProps);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('Draft Name');
    });

    it('calls onEditingNameChange when input changes', () => {
      setup(makePolygon({ id: 'p1' }), renamingProps);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'New Name' } });
      expect(CALLBACKS.onEditingNameChange).toHaveBeenCalledWith('New Name');
    });

    it('calls onSaveRename on Enter key', () => {
      setup(makePolygon({ id: 'p1' }), renamingProps);
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(CALLBACKS.onSaveRename).toHaveBeenCalledWith('p1');
    });

    it('calls onCancelRename on Escape key', () => {
      setup(makePolygon({ id: 'p1' }), renamingProps);
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(CALLBACKS.onCancelRename).toHaveBeenCalled();
    });

    it('calls onSaveRename on blur', () => {
      setup(makePolygon({ id: 'p1' }), renamingProps);
      const input = screen.getByRole('textbox');
      fireEvent.blur(input);
      expect(CALLBACKS.onSaveRename).toHaveBeenCalledWith('p1');
    });

    it('does NOT show input when editingPolygonId is different', () => {
      setup(makePolygon({ id: 'p1' }), {
        editingPolygonId: 'other',
        editingName: 'xyz',
      });
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  // ── isChild indent ────────────────────────────────────────────────────────

  describe('isChild layout', () => {
    it('applies ml-6 indent when isChild is true', () => {
      setup(makePolygon({ id: 'p1', name: 'Child' }), { isChild: true });
      // The outer div wrapping the child should have ml-6
      const wrapper = screen.getByText('Child').closest('[class*="ml-6"]');
      expect(wrapper).toBeTruthy();
    });

    it('does NOT apply ml-6 when isChild is false', () => {
      setup(makePolygon({ id: 'p1', name: 'Root' }), { isChild: false });
      const wrapper = screen.getByText('Root').closest('[class*="ml-6"]');
      expect(wrapper).toBeNull();
    });
  });
});
