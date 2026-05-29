/**
 * Tests for ModeLegend component.
 *
 * Covers: renders nothing when no mode is active, shows the correct label
 * for each of the four modes (editMode / slicingMode / pointAddingMode /
 * deleteMode), and ensures only one legend label appears at a time.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import ModeLegend from '../ModeLegend';

// framer-motion: swap out animated wrappers to plain HTML so we don't
// depend on rAF timing in tests.
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

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const ALL_OFF = {
  editMode: false,
  slicingMode: false,
  pointAddingMode: false,
  deleteMode: false,
};

describe('ModeLegend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // No active mode → renders nothing
  // -----------------------------------------------------------------------

  describe('No active mode', () => {
    it('renders nothing when all modes are false', () => {
      const { container } = render(<ModeLegend {...ALL_OFF} />);
      // AnimatePresence renders null children → container should be empty
      expect(container.firstChild).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // editMode → Create Polygon
  // -----------------------------------------------------------------------

  describe('editMode', () => {
    it('shows "Create Polygon" label', () => {
      render(<ModeLegend {...ALL_OFF} editMode={true} />);
      expect(screen.getByText('Create Polygon')).toBeInTheDocument();
    });

    it('does not show labels for other modes', () => {
      render(<ModeLegend {...ALL_OFF} editMode={true} />);
      expect(screen.queryByText('Slice Polygon')).not.toBeInTheDocument();
      expect(screen.queryByText('Add Points')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete Polygon')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // slicingMode → Slice Polygon
  // -----------------------------------------------------------------------

  describe('slicingMode', () => {
    it('shows "Slice Polygon" label', () => {
      render(<ModeLegend {...ALL_OFF} slicingMode={true} />);
      expect(screen.getByText('Slice Polygon')).toBeInTheDocument();
    });

    it('does not show other mode labels', () => {
      render(<ModeLegend {...ALL_OFF} slicingMode={true} />);
      expect(screen.queryByText('Create Polygon')).not.toBeInTheDocument();
      expect(screen.queryByText('Add Points')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete Polygon')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // pointAddingMode → Add Points
  // -----------------------------------------------------------------------

  describe('pointAddingMode', () => {
    it('shows "Add Points" label', () => {
      render(<ModeLegend {...ALL_OFF} pointAddingMode={true} />);
      expect(screen.getByText('Add Points')).toBeInTheDocument();
    });

    it('does not show other mode labels', () => {
      render(<ModeLegend {...ALL_OFF} pointAddingMode={true} />);
      expect(screen.queryByText('Create Polygon')).not.toBeInTheDocument();
      expect(screen.queryByText('Slice Polygon')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete Polygon')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // deleteMode → Delete Polygon
  // -----------------------------------------------------------------------

  describe('deleteMode', () => {
    it('shows "Delete Polygon" label', () => {
      render(<ModeLegend {...ALL_OFF} deleteMode={true} />);
      expect(screen.getByText('Delete Polygon')).toBeInTheDocument();
    });

    it('does not show other mode labels', () => {
      render(<ModeLegend {...ALL_OFF} deleteMode={true} />);
      expect(screen.queryByText('Create Polygon')).not.toBeInTheDocument();
      expect(screen.queryByText('Slice Polygon')).not.toBeInTheDocument();
      expect(screen.queryByText('Add Points')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Priority — first matching mode wins
  // -----------------------------------------------------------------------

  describe('Mode priority', () => {
    it('editMode takes priority over deleteMode when both true', () => {
      render(<ModeLegend {...ALL_OFF} editMode={true} deleteMode={true} />);
      expect(screen.getByText('Create Polygon')).toBeInTheDocument();
      expect(screen.queryByText('Delete Polygon')).not.toBeInTheDocument();
    });

    it('slicingMode takes priority over deleteMode when both true', () => {
      render(<ModeLegend {...ALL_OFF} slicingMode={true} deleteMode={true} />);
      expect(screen.getByText('Slice Polygon')).toBeInTheDocument();
      expect(screen.queryByText('Delete Polygon')).not.toBeInTheDocument();
    });

    it('pointAddingMode takes priority over deleteMode when both true', () => {
      render(
        <ModeLegend {...ALL_OFF} pointAddingMode={true} deleteMode={true} />
      );
      expect(screen.getByText('Add Points')).toBeInTheDocument();
      expect(screen.queryByText('Delete Polygon')).not.toBeInTheDocument();
    });
  });
});
