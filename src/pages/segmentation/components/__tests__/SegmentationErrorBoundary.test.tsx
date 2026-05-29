/**
 * Behavioral tests for SegmentationErrorBoundary.tsx
 *
 * The module exports:
 *   - SegmentationErrorBoundary (named + default) — wrapper around the class
 *     that uses useLanguage() to supply translated strings.
 *
 * Error boundaries require React class components; to trigger them in tests
 * we render a child component that throws during render.
 *
 * NOTE on console.error:
 * React 18 calls console.error for every error that reaches an error boundary.
 * The global test setup in setup.ts already mocks console.error for the whole
 * suite.  We spy on it inside tests that need to assert it was called.
 *
 * NOTE on providers:
 * The exported wrapper calls useLanguage() which requires AuthContext + LanguageProvider.
 * We use MockAuthProvider + MockLanguageProvider from the shared test-utils so
 * the boundary can resolve translations without needing the real auth stack.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { SegmentationErrorBoundary } from '../SegmentationErrorBoundary';
import {
  MockAuthProvider,
  MockLanguageProvider,
} from '@/test-utils/test-components';

// ---------------------------------------------------------------------------
// Wrapper providing all required contexts
// ---------------------------------------------------------------------------
const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MockAuthProvider>
    <MockLanguageProvider>{children}</MockLanguageProvider>
  </MockAuthProvider>
);

const wrap = (node: React.ReactNode) => <Providers>{node}</Providers>;

// ---------------------------------------------------------------------------
// Throwing child component
// ---------------------------------------------------------------------------

/** Throws synchronously during render when shouldThrow=true */
const Bomb = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error('Kaboom from Bomb');
  return <div data-testid="safe-child">Safe content</div>;
};

// Spy on console.error per test
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Fresh spy — suppresses React's own error boundary noise + lets us assert
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Happy path — no error
// ---------------------------------------------------------------------------

describe('SegmentationErrorBoundary', () => {
  describe('happy path — no error', () => {
    it('renders children when no error is thrown', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <div data-testid="child">Child content</div>
          </SegmentationErrorBoundary>
        )
      );
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('does not show fallback UI (no retry button) when child is healthy', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <div>ok</div>
          </SegmentationErrorBoundary>
        )
      );
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders multiple children when none throw', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <span data-testid="a">A</span>
            <span data-testid="b">B</span>
          </SegmentationErrorBoundary>
        )
      );
      expect(screen.getByTestId('a')).toBeInTheDocument();
      expect(screen.getByTestId('b')).toBeInTheDocument();
    });
  });

  // ---- Error state: default fallback UI -----------------------------------

  describe('error state — default fallback UI', () => {
    it('shows a button in the fallback when a child throws', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('hides the throwing child element when error occurs', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      expect(screen.queryByTestId('safe-child')).toBeNull();
    });

    it('calls console.error when React propagates the boundary error', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      expect(errorSpy).toHaveBeenCalled();
    });

    it('renders an alert role container in the fallback', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      // shadcn <Alert> has role="alert"
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  // ---- Custom fallback prop -----------------------------------------------

  describe('error state — custom fallback prop', () => {
    it('renders custom fallback JSX when provided', () => {
      render(
        wrap(
          <SegmentationErrorBoundary
            fallback={<div data-testid="custom-fb">Custom!</div>}
          >
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      expect(screen.getByTestId('custom-fb')).toBeInTheDocument();
    });

    it('does NOT render the built-in Alert when custom fallback is used', () => {
      render(
        wrap(
          <SegmentationErrorBoundary
            fallback={<div data-testid="custom-fb">Custom!</div>}
          >
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      // Built-in fallback contains a button; custom one should not have it
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  // ---- Retry / reset button -----------------------------------------------

  describe('retry button', () => {
    it('renders a retry button in the default fallback', () => {
      render(
        wrap(
          <SegmentationErrorBoundary>
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('clicking retry re-renders children and removes the fallback UI', async () => {
      // After the boundary is reset the child must NOT throw again
      // We toggle `throws` before clicking so re-render is clean.
      let throws = true;
      const Recoverable = () => {
        if (throws) throw new Error('oops');
        return <div data-testid="ok">ok</div>;
      };

      render(
        wrap(
          <SegmentationErrorBoundary>
            <Recoverable />
          </SegmentationErrorBoundary>
        )
      );

      // Confirm fallback is shown
      expect(screen.getByRole('button')).toBeInTheDocument();

      // Fix the child before clicking retry
      throws = false;
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByTestId('ok')).toBeInTheDocument();
      });
    });

    it('clicking retry shows children again when child stops throwing after reset', async () => {
      // Use the same pattern as the "clicking retry removes fallback" test,
      // which is reliable in strict mode: toggle a mutable flag BEFORE clicking
      // retry so the subsequent render does not throw.
      let throws = true;
      const ToggleThrow = () => {
        if (throws) throw new Error('will stop soon');
        return <div data-testid="after-retry">After retry</div>;
      };

      render(
        wrap(
          <SegmentationErrorBoundary>
            <ToggleThrow />
          </SegmentationErrorBoundary>
        )
      );

      // Boundary caught the error — fallback button is present
      expect(screen.getByRole('button')).toBeInTheDocument();

      // Stop throwing before retry renders the child again
      throws = false;
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(screen.getByTestId('after-retry')).toBeInTheDocument();
      });
    });
  });

  // ---- Deep nesting -------------------------------------------------------

  describe('error propagation from nested children', () => {
    it('catches errors thrown by a grandchild component', () => {
      const GrandChild = (): null => {
        throw new Error('Deep error');
      };
      const Parent = () => (
        <div>
          <GrandChild />
        </div>
      );

      render(
        wrap(
          <SegmentationErrorBoundary>
            <Parent />
          </SegmentationErrorBoundary>
        )
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  // ---- Development-mode error details block --------------------------------

  describe('development mode — error details element', () => {
    it('renders a <details> element containing the error in dev mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      render(
        wrap(
          <SegmentationErrorBoundary>
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );

      const details = document.querySelector('details');
      expect(details).not.toBeNull();
      expect(details?.textContent).toContain('Kaboom from Bomb');

      process.env.NODE_ENV = originalEnv;
    });

    it('does NOT render <details> in test/production mode', () => {
      // process.env.NODE_ENV = 'test' is the current value
      render(
        wrap(
          <SegmentationErrorBoundary>
            <Bomb shouldThrow />
          </SegmentationErrorBoundary>
        )
      );
      expect(document.querySelector('details')).toBeNull();
    });
  });
});
