/**
 * Behavioral tests for PageTransition.tsx
 *
 * PageTransition wraps children in framer-motion's AnimatePresence +
 * motion.div, keyed on location.pathname.  In jsdom framer-motion
 * does not animate; we mock it so motion.div renders as a plain div
 * and AnimatePresence renders children directly.
 *
 * Covered behaviours:
 *  - Children are always rendered
 *  - The wrapper div has w-full h-full
 *  - The motion.div key changes when the pathname changes (component re-renders
 *    with a new key — we verify the new child text appears)
 *  - All three mode props accepted without error: fade | slide | scale
 *  - Custom duration accepted without error
 *
 * NOT testable here:
 *  - Actual CSS animations (no CSS engine in jsdom)
 *  - AnimatePresence exit animation timing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock framer-motion before importing the component
// ---------------------------------------------------------------------------
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      'data-testid': testId,
    }: {
      children: React.ReactNode;
      className?: string;
      'data-testid'?: string;
    }) => (
      <div className={className} data-testid={testId ?? 'motion-div'}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ---------------------------------------------------------------------------
// Mock react-router-dom useLocation
// ---------------------------------------------------------------------------
const mockPathname = { current: '/home' };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: vi.fn(() => ({ pathname: mockPathname.current })),
  };
});

import { PageTransition } from '../PageTransition';

// ---------------------------------------------------------------------------
describe('PageTransition', () => {
  beforeEach(() => {
    mockPathname.current = '/home';
  });

  it('renders children inside the motion wrapper', () => {
    render(
      <PageTransition>
        <span data-testid="page-child">Hello</span>
      </PageTransition>
    );
    expect(screen.getByTestId('page-child')).toBeInTheDocument();
  });

  it('renders the motion.div with w-full h-full classes', () => {
    render(
      <PageTransition>
        <span>content</span>
      </PageTransition>
    );
    const motionDiv = screen.getByTestId('motion-div');
    expect(motionDiv.className).toContain('w-full');
    expect(motionDiv.className).toContain('h-full');
  });

  it('renders with mode="fade" without error', () => {
    expect(() =>
      render(
        <PageTransition mode="fade">
          <span>fade</span>
        </PageTransition>
      )
    ).not.toThrow();
    expect(screen.getByText('fade')).toBeInTheDocument();
  });

  it('renders with mode="slide" without error', () => {
    expect(() =>
      render(
        <PageTransition mode="slide">
          <span>slide</span>
        </PageTransition>
      )
    ).not.toThrow();
    expect(screen.getByText('slide')).toBeInTheDocument();
  });

  it('renders with mode="scale" without error', () => {
    expect(() =>
      render(
        <PageTransition mode="scale">
          <span>scale</span>
        </PageTransition>
      )
    ).not.toThrow();
    expect(screen.getByText('scale')).toBeInTheDocument();
  });

  it('accepts a custom duration without error', () => {
    expect(() =>
      render(
        <PageTransition duration={0.5}>
          <span>custom duration</span>
        </PageTransition>
      )
    ).not.toThrow();
    expect(screen.getByText('custom duration')).toBeInTheDocument();
  });

  it('re-renders with new children when pathname changes', () => {
    const { rerender } = render(
      <PageTransition>
        <span>Page A</span>
      </PageTransition>
    );
    expect(screen.getByText('Page A')).toBeInTheDocument();

    mockPathname.current = '/about';
    rerender(
      <PageTransition>
        <span>Page B</span>
      </PageTransition>
    );
    expect(screen.getByText('Page B')).toBeInTheDocument();
  });
});
