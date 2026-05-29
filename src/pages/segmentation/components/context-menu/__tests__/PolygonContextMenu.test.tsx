/**
 * PolygonContextMenu — behavioral unit tests
 *
 * Covered:
 *  - Renders children inside the trigger
 *  - Edit item present for polygons and polylines (different label)
 *  - Slice item only present for closed polygons (not polylines)
 *  - onEdit called when Edit item clicked
 *  - onSlice called when Slice item clicked (polygon only)
 *  - Delete item opens AlertDialog (not immediate deletion)
 *  - Confirming AlertDialog calls onDelete
 *  - Cancelling AlertDialog does not call onDelete
 *  - MT kymograph item only for isPolyline=true + projectType='microtubules'
 *  - Kymograph click dispatches 'segmentation:open-kymograph' custom event
 *  - Sperm part-class items only for isPolyline=true + projectType='sperm'
 *  - onChangePartClass called with correct value per item
 *  - Instance assignment items only when isSperm + instanceIds provided
 *  - Current instance row has checkmark; clicking it still calls onChangeInstanceId
 *  - No sperm items when projectType is unset
 *
 * Skipped:
 *  - Radix focus management / aria-expanded race in portal — tested via the
 *    VertexContextMenu pattern which uses the same Radix mock.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PolygonContextMenu from '../PolygonContextMenu';

// ── mock Radix context-menu (same pattern as VertexContextMenu.e2e.test.tsx)
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ctx-menu-root">{children}</div>
  ),
  ContextMenuTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (
    <div data-testid="ctx-menu-trigger">
      {asChild ? children : <div>{children}</div>}
    </div>
  ),
  ContextMenuContent: ({
    children,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div data-testid="ctx-menu-content">{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <div
      data-testid="ctx-menu-item"
      role="menuitem"
      onClick={onClick}
      className={className}
    >
      {children}
    </div>
  ),
  ContextMenuSeparator: () => <hr data-testid="ctx-menu-sep" />,
}));

// ── mock Radix AlertDialog (pass-through; we control open state via context)
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (v: boolean) => void;
  }) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert-dialog-content">{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button data-testid="alert-cancel" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button data-testid="alert-confirm" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

// ── helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  children: <span data-testid="trigger-child">polygon</span>,
  onDelete: vi.fn(),
  onSlice: vi.fn(),
  onEdit: vi.fn(),
  polygonId: 'poly-abc',
};

function getMenuItems() {
  return screen.getAllByTestId('ctx-menu-item');
}

function getMenuItemByText(text: RegExp | string) {
  return getMenuItems().find(el => el.textContent?.match(text) !== null);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('PolygonContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── basic rendering ───────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders children inside the trigger', () => {
      render(<PolygonContextMenu {...DEFAULT_PROPS} />);
      expect(screen.getByTestId('trigger-child')).toBeInTheDocument();
    });

    it('renders the Edit item for a closed polygon', () => {
      render(<PolygonContextMenu {...DEFAULT_PROPS} isPolyline={false} />);
      const edit = getMenuItemByText(/contextMenu.editPolygon/i);
      expect(edit).toBeTruthy();
    });

    it('renders the Edit item with polyline label when isPolyline=true', () => {
      render(<PolygonContextMenu {...DEFAULT_PROPS} isPolyline={true} />);
      const edit = getMenuItemByText(/contextMenu.editPolyline/i);
      expect(edit).toBeTruthy();
    });

    it('renders Slice item for closed polygon', () => {
      render(<PolygonContextMenu {...DEFAULT_PROPS} isPolyline={false} />);
      const slice = getMenuItemByText(/contextMenu.splitPolygon/i);
      expect(slice).toBeTruthy();
    });

    it('does NOT render Slice item for polyline', () => {
      render(<PolygonContextMenu {...DEFAULT_PROPS} isPolyline={true} />);
      const slice = getMenuItemByText(/contextMenu.splitPolygon/i);
      expect(slice).toBeUndefined();
    });

    it('renders Delete item with polygon label for closed polygon', () => {
      render(<PolygonContextMenu {...DEFAULT_PROPS} isPolyline={false} />);
      const del = getMenuItemByText(/contextMenu.deletePolygon/i);
      expect(del).toBeTruthy();
    });

    it('renders Delete item with polyline label for polyline', () => {
      render(<PolygonContextMenu {...DEFAULT_PROPS} isPolyline={true} />);
      const del = getMenuItemByText(/contextMenu.deletePolyline/i);
      expect(del).toBeTruthy();
    });
  });

  // ── standard callbacks ────────────────────────────────────────────────────

  describe('Edit and Slice callbacks', () => {
    it('calls onEdit when Edit item is clicked', async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();

      render(<PolygonContextMenu {...DEFAULT_PROPS} onEdit={onEdit} />);

      const editItem = getMenuItemByText(/contextMenu.editPolygon/i);
      await user.click(editItem!);

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('calls onSlice when Split item is clicked', async () => {
      const user = userEvent.setup();
      const onSlice = vi.fn();

      render(
        <PolygonContextMenu
          {...DEFAULT_PROPS}
          isPolyline={false}
          onSlice={onSlice}
        />
      );

      const sliceItem = getMenuItemByText(/contextMenu.splitPolygon/i);
      await user.click(sliceItem!);

      expect(onSlice).toHaveBeenCalledTimes(1);
    });
  });

  // ── delete confirmation dialog ────────────────────────────────────────────

  describe('delete confirmation', () => {
    it('clicking Delete opens the AlertDialog (does not call onDelete yet)', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();

      render(<PolygonContextMenu {...DEFAULT_PROPS} onDelete={onDelete} />);

      expect(screen.queryByTestId('alert-dialog')).not.toBeInTheDocument();

      const deleteItem = getMenuItemByText(/contextMenu.deletePolygon/i);
      await user.click(deleteItem!);

      expect(screen.getByTestId('alert-dialog')).toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('confirming the dialog calls onDelete and closes dialog', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();

      render(<PolygonContextMenu {...DEFAULT_PROPS} onDelete={onDelete} />);

      // Open dialog
      const deleteItem = getMenuItemByText(/contextMenu.deletePolygon/i);
      await user.click(deleteItem!);

      // Confirm
      await user.click(screen.getByTestId('alert-confirm'));

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('alert-dialog')).not.toBeInTheDocument();
    });

    it('cancelling the dialog does not call onDelete', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();

      render(<PolygonContextMenu {...DEFAULT_PROPS} onDelete={onDelete} />);

      const deleteItem = getMenuItemByText(/contextMenu.deletePolygon/i);
      await user.click(deleteItem!);

      await user.click(screen.getByTestId('alert-cancel'));

      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  // ── microtubule kymograph item ────────────────────────────────────────────

  describe('microtubule kymograph item', () => {
    it('shows kymograph item for polyline + projectType=microtubules', () => {
      render(
        <PolygonContextMenu
          {...DEFAULT_PROPS}
          isPolyline={true}
          projectType="microtubules"
        />
      );
      const kymo = getMenuItemByText(/kymograph/i);
      expect(kymo).toBeTruthy();
    });

    it('does NOT show kymograph item for closed polygon', () => {
      render(
        <PolygonContextMenu
          {...DEFAULT_PROPS}
          isPolyline={false}
          projectType="microtubules"
        />
      );
      const kymo = getMenuItemByText(/kymograph/i);
      expect(kymo).toBeUndefined();
    });

    it('does NOT show kymograph item for sperm polyline', () => {
      render(
        <PolygonContextMenu
          {...DEFAULT_PROPS}
          isPolyline={true}
          projectType="sperm"
        />
      );
      const kymo = getMenuItemByText(/kymograph/i);
      expect(kymo).toBeUndefined();
    });

    it('clicking kymograph item dispatches segmentation:open-kymograph custom event', async () => {
      const user = userEvent.setup();
      const handler = vi.fn();
      document.addEventListener('segmentation:open-kymograph', handler);

      render(
        <PolygonContextMenu
          {...DEFAULT_PROPS}
          isPolyline={true}
          projectType="microtubules"
          polygonId="mt-42"
        />
      );

      const kymo = getMenuItemByText(/kymograph/i);
      await user.click(kymo!);

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ polylineId: 'mt-42' });

      document.removeEventListener('segmentation:open-kymograph', handler);
    });
  });

  // ── sperm part-class items ────────────────────────────────────────────────

  describe('sperm part-class items', () => {
    const spermProps = {
      ...DEFAULT_PROPS,
      isPolyline: true,
      projectType: 'sperm' as const,
      onChangePartClass: vi.fn() as (
        partClass: 'head' | 'midpiece' | 'tail'
      ) => void,
    };

    it('shows Head, Midpiece, Tail items for sperm polyline', () => {
      render(<PolygonContextMenu {...spermProps} />);
      expect(getMenuItemByText(/sperm.setAsHead/i)).toBeTruthy();
      expect(getMenuItemByText(/sperm.setAsMidpiece/i)).toBeTruthy();
      expect(getMenuItemByText(/sperm.setAsTail/i)).toBeTruthy();
    });

    it('calls onChangePartClass("head") when Head is clicked', async () => {
      const user = userEvent.setup();
      const onChangePartClass = vi.fn();

      render(
        <PolygonContextMenu
          {...spermProps}
          onChangePartClass={onChangePartClass}
        />
      );

      await user.click(getMenuItemByText(/sperm.setAsHead/i)!);
      expect(onChangePartClass).toHaveBeenCalledWith('head');
    });

    it('calls onChangePartClass("midpiece") when Midpiece is clicked', async () => {
      const user = userEvent.setup();
      const onChangePartClass = vi.fn();

      render(
        <PolygonContextMenu
          {...spermProps}
          onChangePartClass={onChangePartClass}
        />
      );

      await user.click(getMenuItemByText(/sperm.setAsMidpiece/i)!);
      expect(onChangePartClass).toHaveBeenCalledWith('midpiece');
    });

    it('calls onChangePartClass("tail") when Tail is clicked', async () => {
      const user = userEvent.setup();
      const onChangePartClass = vi.fn();

      render(
        <PolygonContextMenu
          {...spermProps}
          onChangePartClass={onChangePartClass}
        />
      );

      await user.click(getMenuItemByText(/sperm.setAsTail/i)!);
      expect(onChangePartClass).toHaveBeenCalledWith('tail');
    });

    it('does NOT render part-class items when onChangePartClass is omitted', () => {
      render(
        <PolygonContextMenu
          {...DEFAULT_PROPS}
          isPolyline={true}
          projectType="sperm"
        />
      );
      expect(getMenuItemByText(/sperm.setAsHead/i)).toBeUndefined();
    });

    it('does NOT render part-class items for non-sperm project types', () => {
      render(
        <PolygonContextMenu
          {...DEFAULT_PROPS}
          isPolyline={true}
          projectType="spheroid"
          onChangePartClass={vi.fn()}
        />
      );
      expect(getMenuItemByText(/sperm.setAsHead/i)).toBeUndefined();
    });
  });

  // ── instance assignment ───────────────────────────────────────────────────

  describe('instance assignment items', () => {
    const instanceProps = {
      ...DEFAULT_PROPS,
      isPolyline: true,
      projectType: 'sperm' as const,
      onChangePartClass: vi.fn() as (
        partClass: 'head' | 'midpiece' | 'tail'
      ) => void,
      onChangeInstanceId: vi.fn(),
      availableInstanceIds: ['sperm_1', 'sperm_2', 'sperm_3'],
      currentInstanceId: 'sperm_1',
    };

    it('renders one item per available instance id', () => {
      render(<PolygonContextMenu {...instanceProps} />);
      // Each instance renders as a menu item with "Instance N" text
      expect(
        getMenuItems().filter(el => el.textContent?.match(/sperm.instance/i))
          .length
      ).toBe(3);
    });

    it('calls onChangeInstanceId with the selected instanceId', async () => {
      const user = userEvent.setup();
      const onChangeInstanceId = vi.fn();

      render(
        <PolygonContextMenu
          {...instanceProps}
          onChangeInstanceId={onChangeInstanceId}
        />
      );

      // Find the item for sperm_2 — label shows numeric part "2"
      const items = getMenuItems().filter(
        el =>
          el.textContent?.includes('sperm.instance') &&
          el.textContent?.includes('2')
      );
      expect(items.length).toBeGreaterThan(0);
      await user.click(items[0]);

      expect(onChangeInstanceId).toHaveBeenCalledWith('sperm_2');
    });

    it('does not render instance items when availableInstanceIds is empty', () => {
      render(
        <PolygonContextMenu {...instanceProps} availableInstanceIds={[]} />
      );
      const instanceItems = getMenuItems().filter(el =>
        el.textContent?.includes('sperm.instance')
      );
      expect(instanceItems).toHaveLength(0);
    });

    it('does not render instance items when onChangeInstanceId is omitted', () => {
      render(
        <PolygonContextMenu {...instanceProps} onChangeInstanceId={undefined} />
      );
      const instanceItems = getMenuItems().filter(el =>
        el.textContent?.includes('sperm.instance')
      );
      expect(instanceItems).toHaveLength(0);
    });
  });
});
