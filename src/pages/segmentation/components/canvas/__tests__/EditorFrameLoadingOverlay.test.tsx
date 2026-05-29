/**
 * Tests for EditorFrameLoadingOverlay component.
 *
 * Covers: null render when visible=false, renders overlay when visible=true,
 * aria-busy / aria-live accessibility attributes, optional label text,
 * custom width/height inline styles, and the spinner / skeleton presence.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EditorFrameLoadingOverlay from '../EditorFrameLoadingOverlay';

describe('EditorFrameLoadingOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Visibility gate
  // -----------------------------------------------------------------------

  describe('visible prop', () => {
    it('renders nothing when visible=false', () => {
      const { container } = render(
        <EditorFrameLoadingOverlay visible={false} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the overlay when visible=true', () => {
      render(<EditorFrameLoadingOverlay visible={true} />);
      expect(
        screen.getByTestId('editor-frame-loading-overlay')
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Accessibility attributes
  // -----------------------------------------------------------------------

  describe('Accessibility', () => {
    it('has aria-busy="true" on the overlay', () => {
      render(<EditorFrameLoadingOverlay visible={true} />);
      expect(
        screen.getByTestId('editor-frame-loading-overlay')
      ).toHaveAttribute('aria-busy', 'true');
    });

    it('has aria-live="polite" on the overlay', () => {
      render(<EditorFrameLoadingOverlay visible={true} />);
      expect(
        screen.getByTestId('editor-frame-loading-overlay')
      ).toHaveAttribute('aria-live', 'polite');
    });
  });

  // -----------------------------------------------------------------------
  // Optional label
  // -----------------------------------------------------------------------

  describe('label prop', () => {
    it('shows label text when provided', () => {
      render(
        <EditorFrameLoadingOverlay visible={true} label="Loading frame 5…" />
      );
      expect(screen.getByText('Loading frame 5…')).toBeInTheDocument();
    });

    it('does not render a label span when label is omitted', () => {
      render(<EditorFrameLoadingOverlay visible={true} />);
      // No <span> in the inner flex column
      const overlay = screen.getByTestId('editor-frame-loading-overlay');
      expect(overlay.querySelector('span')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Inline size styles
  // -----------------------------------------------------------------------

  describe('width and height props', () => {
    it('applies width style when width is provided', () => {
      render(<EditorFrameLoadingOverlay visible={true} width={400} />);
      const overlay = screen.getByTestId('editor-frame-loading-overlay');
      expect(overlay).toHaveStyle({ width: '400px' });
    });

    it('applies height style when height is provided', () => {
      render(<EditorFrameLoadingOverlay visible={true} height={300} />);
      const overlay = screen.getByTestId('editor-frame-loading-overlay');
      expect(overlay).toHaveStyle({ height: '300px' });
    });

    it('width and height are undefined in style when not provided', () => {
      render(<EditorFrameLoadingOverlay visible={true} />);
      const overlay = screen.getByTestId('editor-frame-loading-overlay');
      // style attribute should be empty or absent
      expect(overlay.style.width).toBe('');
      expect(overlay.style.height).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Spinner presence (Loader2 svg icon)
  // -----------------------------------------------------------------------

  describe('Spinner', () => {
    it('contains an svg element (Loader2 icon) inside the overlay', () => {
      render(<EditorFrameLoadingOverlay visible={true} />);
      const overlay = screen.getByTestId('editor-frame-loading-overlay');
      expect(overlay.querySelector('svg')).not.toBeNull();
    });
  });
});
