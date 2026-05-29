/**
 * Tests for EditorHelpTips component.
 *
 * Covers: null render when no mode is active, renders tips for editMode /
 * slicingMode / pointAddingMode, shows the correct number of list items,
 * and confirms the header text appears alongside each tip set.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import EditorHelpTips from '../EditorHelpTips';

// framer-motion uses requestAnimationFrame which is stubbed in setup.ts;
// stub the component itself to render plain divs so we can focus on logic.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...rest}>{children}</div>,
    li: ({
      children,
      ...rest
    }: React.LiHTMLAttributes<HTMLLIElement> & {
      children?: React.ReactNode;
    }) => <li {...rest}>{children}</li>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Stub useLanguage so translations are deterministic.
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      if (key === 'segmentation.tips.header') return 'Tips';
      if (key === 'segmentation.helpTips.editMode')
        return ['Click to add vertex', 'Close polygon to finish'];
      if (key === 'segmentation.helpTips.slicingMode')
        return ['Click start point', 'Click end point to slice'];
      if (key === 'segmentation.helpTips.pointAddingMode')
        return ['Click segment to add point'];
      return key;
    },
  }),
}));

// -----------------------------------------------------------------------
// Helper — default all modes off
// -----------------------------------------------------------------------
const OFF = { editMode: false, slicingMode: false, pointAddingMode: false };

describe('EditorHelpTips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Null render
  // -----------------------------------------------------------------------

  describe('No-op render', () => {
    it('renders nothing when all modes are false', () => {
      const { container } = render(<EditorHelpTips {...OFF} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when only unsupported combos are given (all false)', () => {
      const { container } = render(
        <EditorHelpTips
          editMode={false}
          slicingMode={false}
          pointAddingMode={false}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // editMode
  // -----------------------------------------------------------------------

  describe('editMode active', () => {
    it('shows the tips header', () => {
      render(<EditorHelpTips {...OFF} editMode={true} />);
      expect(screen.getByText('Tips')).toBeInTheDocument();
    });

    it('renders editMode tips as list items', () => {
      render(<EditorHelpTips {...OFF} editMode={true} />);
      expect(screen.getByText('Click to add vertex')).toBeInTheDocument();
      expect(screen.getByText('Close polygon to finish')).toBeInTheDocument();
    });

    it('renders two list items for editMode', () => {
      render(<EditorHelpTips {...OFF} editMode={true} />);
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(2);
    });

    it('each list item has a numbered badge', () => {
      render(<EditorHelpTips {...OFF} editMode={true} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // slicingMode
  // -----------------------------------------------------------------------

  describe('slicingMode active', () => {
    it('shows slicingMode tips', () => {
      render(<EditorHelpTips {...OFF} slicingMode={true} />);
      expect(screen.getByText('Click start point')).toBeInTheDocument();
      expect(screen.getByText('Click end point to slice')).toBeInTheDocument();
    });

    it('does NOT show editMode tips when only slicingMode is on', () => {
      render(<EditorHelpTips {...OFF} slicingMode={true} />);
      expect(screen.queryByText('Click to add vertex')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // pointAddingMode
  // -----------------------------------------------------------------------

  describe('pointAddingMode active', () => {
    it('shows pointAddingMode tips', () => {
      render(<EditorHelpTips {...OFF} pointAddingMode={true} />);
      expect(
        screen.getByText('Click segment to add point')
      ).toBeInTheDocument();
    });

    it('renders one list item for pointAddingMode', () => {
      render(<EditorHelpTips {...OFF} pointAddingMode={true} />);
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Priority: editMode wins over slicingMode when both are true
  // -----------------------------------------------------------------------

  describe('Mode priority', () => {
    it('uses editMode tips when editMode and slicingMode are both true', () => {
      render(
        <EditorHelpTips
          editMode={true}
          slicingMode={true}
          pointAddingMode={false}
        />
      );
      expect(screen.getByText('Click to add vertex')).toBeInTheDocument();
      expect(screen.queryByText('Click start point')).not.toBeInTheDocument();
    });

    it('uses slicingMode tips when slicingMode and pointAddingMode are both true', () => {
      render(
        <EditorHelpTips
          editMode={false}
          slicingMode={true}
          pointAddingMode={true}
        />
      );
      expect(screen.getByText('Click start point')).toBeInTheDocument();
      expect(
        screen.queryByText('Click segment to add point')
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Header always present with tips
  // -----------------------------------------------------------------------

  describe('Header', () => {
    it('header appears alongside pointAddingMode tips', () => {
      render(<EditorHelpTips {...OFF} pointAddingMode={true} />);
      const header = screen.getByText('Tips');
      expect(
        within(header.closest('div')!).getByText('Tips')
      ).toBeInTheDocument();
    });
  });
});
