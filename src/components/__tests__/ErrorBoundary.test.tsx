import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';
import { logger } from '@/lib/logger';

// ErrorDisplay calls useLanguage(); return the key so assertions are stable
// regardless of the loaded dictionary.
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// A component that throws on render to trip the boundary.
const Boom = ({ message = 'kaboom' }: { message?: string }) => {
  throw new Error(message);
};

describe('ErrorBoundary (class boundary)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // React logs the caught error to console.error during the throw; silence
    // it so the test output stays clean (the boundary still catches it).
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">all good</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('all good');
  });

  it('renders the default error display when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom message="render failed" />
      </ErrorBoundary>
    );
    // ErrorDisplay shows the thrown message + the localized heading/link keys.
    expect(screen.getByText('render failed')).toBeInTheDocument();
    expect(screen.getByText('toast.unexpectedError')).toBeInTheDocument();
    expect(screen.getByText('toast.returnToHome').closest('a')).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('renders a provided fallback instead of the default display', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="fallback">custom</div>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('fallback')).toHaveTextContent('custom');
    // Default display heading must NOT be present when a fallback is given.
    expect(screen.queryByText('toast.unexpectedError')).not.toBeInTheDocument();
  });

  it('logs the caught error via the logger', () => {
    render(
      <ErrorBoundary>
        <Boom message="logged error" />
      </ErrorBoundary>
    );
    expect(logger.error).toHaveBeenCalledWith(
      'ErrorBoundary caught an error',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('falls back to a generic message when the error has no message', () => {
    const ThrowEmpty = () => {
      throw new Error('');
    };
    render(
      <ErrorBoundary>
        <ThrowEmpty />
      </ErrorBoundary>
    );
    // Empty error.message → the localized "something went wrong" key shows.
    expect(screen.getByText('toast.somethingWentWrong')).toBeInTheDocument();
  });
});
