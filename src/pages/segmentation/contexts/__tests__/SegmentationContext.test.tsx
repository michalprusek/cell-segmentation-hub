/**
 * Tests for SegmentationContext and SegmentationProvider
 * Covers context provision, consumer access, and edge cases
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SegmentationProvider } from '../SegmentationContext';
import { useSegmentationContext } from '../useSegmentationContext';
import { SegmentationContext } from '../SegmentationContext.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A minimal consumer that renders segmentation data as text so we can assert
 * on what the context provided.
 */
const ContextConsumer: React.FC = () => {
  const { segmentation } = useSegmentationContext();
  if (segmentation === null) {
    return <span data-testid="value">null</span>;
  }
  // Render a representative field so tests can confirm the value was passed
  return <span data-testid="value">present</span>;
};

/**
 * A consumer that deliberately calls useContext without a provider to trigger
 * the default context value path.
 */
const BareConsumer: React.FC = () => {
  const { segmentation } = useSegmentationContext();
  return (
    <span data-testid="bare-value">
      {segmentation === null ? 'null' : 'present'}
    </span>
  );
};

/**
 * Build a minimal fake segmentation object that satisfies whatever TypeScript
 * expects from the (intentionally empty) SegmentationResult type imported by
 * the context.  At runtime this is an unconstrained object – we only need
 * something truthy so consumers can distinguish null vs non-null.
 */
const makeFakeSegmentation = () => ({
  id: 'seg-1',
  image_id: 'img-1',
  polygons: [
    {
      id: 'poly-1',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      type: 'external' as const,
    },
  ],
  status: 'completed' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SegmentationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SegmentationProvider', () => {
    it('passes non-null segmentation data to children via context', () => {
      const seg = makeFakeSegmentation();

      render(
        <SegmentationProvider segmentation={seg as any}>
          <ContextConsumer />
        </SegmentationProvider>
      );

      expect(screen.getByTestId('value')).toHaveTextContent('present');
    });

    it('passes null segmentation to children and consumer handles it gracefully', () => {
      render(
        <SegmentationProvider segmentation={null}>
          <ContextConsumer />
        </SegmentationProvider>
      );

      expect(screen.getByTestId('value')).toHaveTextContent('null');
    });

    it('renders children without crashing', () => {
      render(
        <SegmentationProvider segmentation={null}>
          <div data-testid="child">child node</div>
        </SegmentationProvider>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('passes updated segmentation when the prop changes', () => {
      const seg = makeFakeSegmentation();

      const { rerender } = render(
        <SegmentationProvider segmentation={null}>
          <ContextConsumer />
        </SegmentationProvider>
      );

      expect(screen.getByTestId('value')).toHaveTextContent('null');

      rerender(
        <SegmentationProvider segmentation={seg as any}>
          <ContextConsumer />
        </SegmentationProvider>
      );

      expect(screen.getByTestId('value')).toHaveTextContent('present');
    });

    it('reverts to null when segmentation prop is set back to null', () => {
      const seg = makeFakeSegmentation();

      const { rerender } = render(
        <SegmentationProvider segmentation={seg as any}>
          <ContextConsumer />
        </SegmentationProvider>
      );

      expect(screen.getByTestId('value')).toHaveTextContent('present');

      rerender(
        <SegmentationProvider segmentation={null}>
          <ContextConsumer />
        </SegmentationProvider>
      );

      expect(screen.getByTestId('value')).toHaveTextContent('null');
    });

    it('supports multiple nested consumers that all receive the same value', () => {
      const seg = makeFakeSegmentation();

      const MultiConsumer: React.FC = () => (
        <>
          <ContextConsumer />
          <ContextConsumer />
        </>
      );

      render(
        <SegmentationProvider segmentation={seg as any}>
          <MultiConsumer />
        </SegmentationProvider>
      );

      const nodes = screen.getAllByTestId('value');
      expect(nodes).toHaveLength(2);
      nodes.forEach(node => expect(node).toHaveTextContent('present'));
    });
  });

  describe('useSegmentationContext', () => {
    it('returns default null segmentation when used outside a provider', () => {
      // The context default (from SegmentationContext.types.ts) is { segmentation: null }
      render(<BareConsumer />);
      expect(screen.getByTestId('bare-value')).toHaveTextContent('null');
    });

    it('returns the segmentation object provided by the nearest provider', () => {
      const seg = makeFakeSegmentation();

      const DirectConsumer: React.FC = () => {
        const ctx = useSegmentationContext();
        return (
          <span data-testid="ctx-seg">
            {ctx.segmentation ? (ctx.segmentation as any).id : 'none'}
          </span>
        );
      };

      render(
        <SegmentationProvider segmentation={seg as any}>
          <DirectConsumer />
        </SegmentationProvider>
      );

      expect(screen.getByTestId('ctx-seg')).toHaveTextContent('seg-1');
    });

    it('respects the closest provider in a nested tree', () => {
      const outer = { ...makeFakeSegmentation(), id: 'outer-seg' };
      const inner = { ...makeFakeSegmentation(), id: 'inner-seg' };

      const IdConsumer: React.FC = () => {
        const ctx = useSegmentationContext();
        return (
          <span data-testid="nested-id">
            {ctx.segmentation ? (ctx.segmentation as any).id : 'none'}
          </span>
        );
      };

      render(
        <SegmentationProvider segmentation={outer as any}>
          <SegmentationProvider segmentation={inner as any}>
            <IdConsumer />
          </SegmentationProvider>
        </SegmentationProvider>
      );

      expect(screen.getByTestId('nested-id')).toHaveTextContent('inner-seg');
    });
  });

  describe('SegmentationContext default value', () => {
    it('exports a context whose default segmentation is null', () => {
      // Read the default value directly from the exported context object
      expect(SegmentationContext).toBeDefined();
      // The defaultValue passed to createContext was { segmentation: null }
      // React exposes it via _currentValue in test environments
      const defaultValue = (SegmentationContext as any)._currentValue;
      expect(defaultValue).toBeDefined();
      expect(defaultValue.segmentation).toBeNull();
    });
  });
});
