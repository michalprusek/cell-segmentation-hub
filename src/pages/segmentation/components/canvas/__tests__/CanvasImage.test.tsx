/**
 * Tests for CanvasImage component
 * Covers src/alt rendering, load and error callbacks, dimension styles,
 * and CSS positioning.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasImage from '../CanvasImage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CanvasImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders an img element with the provided src', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.tagName).toBe('IMG');
      expect(img).toHaveAttribute('src', '/images/test.png');
    });

    it('uses the default alt text when alt is not provided', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveAttribute('alt', 'Image to segment');
    });

    it('uses a custom alt text when alt is provided', () => {
      render(<CanvasImage src="/images/test.png" alt="My cell image" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveAttribute('alt', 'My cell image');
    });

    it('is not draggable', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveAttribute('draggable', 'false');
    });
  });

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  describe('onLoad callback', () => {
    it('calls onLoad with naturalWidth and naturalHeight when the image loads', () => {
      const onLoad = vi.fn();
      render(<CanvasImage src="/images/test.png" onLoad={onLoad} />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;

      // Simulate image loaded — jsdom does not populate naturalWidth/Height
      // automatically, so we define them via Object.defineProperty.
      Object.defineProperty(img, 'naturalWidth', {
        value: 800,
        configurable: true,
      });
      Object.defineProperty(img, 'naturalHeight', {
        value: 600,
        configurable: true,
      });

      fireEvent.load(img);

      expect(onLoad).toHaveBeenCalledTimes(1);
      expect(onLoad).toHaveBeenCalledWith(800, 600);
    });

    it('does not throw when onLoad is not provided', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(() => fireEvent.load(img)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Dimension styles
  // -------------------------------------------------------------------------

  describe('Dimension styles', () => {
    it('applies pixel width and height from props', () => {
      render(<CanvasImage src="/images/test.png" width={400} height={300} />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img).toHaveStyle({ width: '400px', height: '300px' });
    });

    it('uses "auto" for width and height when props are omitted', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveStyle({ width: 'auto', height: 'auto' });
    });

    it('forwards width and height HTML attributes', () => {
      render(<CanvasImage src="/images/test.png" width={200} height={150} />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      // The component passes width/height directly to the img element
      expect(img.width).toBe(200);
      expect(img.height).toBe(150);
    });
  });

  // -------------------------------------------------------------------------
  // CSS class / opacity
  // -------------------------------------------------------------------------

  describe('Opacity behaviour', () => {
    it('renders at full opacity when loading=true (default)', () => {
      render(<CanvasImage src="/images/test.png" loading={true} />);

      const img = screen.getByTestId('canvas-image');
      // The class applied is opacity-100 when loading is true
      expect(img.className).toContain('opacity-100');
    });

    it('renders at reduced opacity when loading=false', () => {
      render(<CanvasImage src="/images/test.png" loading={false} />);

      const img = screen.getByTestId('canvas-image');
      expect(img.className).toContain('opacity-50');
    });
  });

  // -------------------------------------------------------------------------
  // Positioning
  // -------------------------------------------------------------------------

  describe('CSS positioning', () => {
    it('is positioned absolutely at top-left (0, 0)', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img.className).toMatch(/absolute/);
      expect(img.className).toMatch(/top-0/);
      expect(img.className).toMatch(/left-0/);
    });

    it('has pointer-events-none so it does not interfere with canvas interactions', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img.className).toMatch(/pointer-events-none/);
    });

    it('applies crisp-edges image rendering style', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveStyle({ imageRendering: 'crisp-edges' });
    });
  });
});
