import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import { ToastEventProvider } from '@/components/AuthToastProvider';
import { authEventEmitter } from '@/lib/authEvents';
import { toast } from 'sonner';

// Mock the hooks at module level
vi.mock('@/hooks/useAuthToasts', () => ({
  useAuthToasts: vi.fn(),
}));

vi.mock('@/hooks/useWebSocketToasts', () => ({
  useWebSocketToasts: vi.fn(),
}));

vi.mock('sonner');

describe('ToastEventProvider', () => {
  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Get fresh mock instances
    const { useAuthToasts } = await import('@/hooks/useAuthToasts');
    const { useWebSocketToasts } = await import('@/hooks/useWebSocketToasts');
    vi.mocked(useAuthToasts).mockClear();
    vi.mocked(useWebSocketToasts).mockClear();
    vi.mocked(toast).success = mockToast.success;
    vi.mocked(toast).error = mockToast.error;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders children without modification', () => {
    const TestChild = () => <div data-testid="test-child">Test Content</div>;

    render(
      <ToastEventProvider>
        <TestChild />
      </ToastEventProvider>
    );

    expect(screen.getByTestId('test-child')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('calls useAuthToasts hook', async () => {
    const { useAuthToasts } = await import('@/hooks/useAuthToasts');

    render(
      <ToastEventProvider>
        <div>Test</div>
      </ToastEventProvider>
    );

    expect(useAuthToasts).toHaveBeenCalledTimes(1);
  });

  it('calls useWebSocketToasts hook', async () => {
    const { useWebSocketToasts } = await import('@/hooks/useWebSocketToasts');

    render(
      <ToastEventProvider>
        <div>Test</div>
      </ToastEventProvider>
    );

    expect(useWebSocketToasts).toHaveBeenCalledTimes(1);
  });

  it('calls both hooks when rendered', async () => {
    const { useAuthToasts } = await import('@/hooks/useAuthToasts');
    const { useWebSocketToasts } = await import('@/hooks/useWebSocketToasts');

    render(
      <ToastEventProvider>
        <div>Test</div>
      </ToastEventProvider>
    );

    expect(useAuthToasts).toHaveBeenCalledTimes(1);
    expect(useWebSocketToasts).toHaveBeenCalledTimes(1);
  });

  it('renders multiple children correctly', () => {
    render(
      <ToastEventProvider>
        <div data-testid="child-1">First Child</div>
        <div data-testid="child-2">Second Child</div>
        <span data-testid="child-3">Third Child</span>
      </ToastEventProvider>
    );

    expect(screen.getByTestId('child-1')).toBeInTheDocument();
    expect(screen.getByTestId('child-2')).toBeInTheDocument();
    expect(screen.getByTestId('child-3')).toBeInTheDocument();
    expect(screen.getByText('First Child')).toBeInTheDocument();
    expect(screen.getByText('Second Child')).toBeInTheDocument();
    expect(screen.getByText('Third Child')).toBeInTheDocument();
  });

  it('renders with complex nested children', () => {
    render(
      <ToastEventProvider>
        <div data-testid="parent">
          <h1>Parent Component</h1>
          <div data-testid="nested-child">
            <p>Nested content</p>
            <button>Action</button>
          </div>
        </div>
      </ToastEventProvider>
    );

    expect(screen.getByTestId('parent')).toBeInTheDocument();
    expect(screen.getByTestId('nested-child')).toBeInTheDocument();
    expect(screen.getByText('Parent Component')).toBeInTheDocument();
    expect(screen.getByText('Nested content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('re-renders when children change', () => {
    const { rerender } = render(
      <ToastEventProvider>
        <div data-testid="original">Original Content</div>
      </ToastEventProvider>
    );

    expect(screen.getByTestId('original')).toBeInTheDocument();
    expect(screen.getByText('Original Content')).toBeInTheDocument();

    rerender(
      <ToastEventProvider>
        <div data-testid="updated">Updated Content</div>
      </ToastEventProvider>
    );

    expect(screen.queryByTestId('original')).not.toBeInTheDocument();
    expect(screen.getByTestId('updated')).toBeInTheDocument();
    expect(screen.getByText('Updated Content')).toBeInTheDocument();
  });

  it('maintains hook calls across re-renders', async () => {
    const { useAuthToasts } = await import('@/hooks/useAuthToasts');
    const { useWebSocketToasts } = await import('@/hooks/useWebSocketToasts');

    const { rerender } = render(
      <ToastEventProvider>
        <div>Initial</div>
      </ToastEventProvider>
    );

    expect(useAuthToasts).toHaveBeenCalledTimes(1);
    expect(useWebSocketToasts).toHaveBeenCalledTimes(1);

    rerender(
      <ToastEventProvider>
        <div>Updated</div>
      </ToastEventProvider>
    );

    // Hooks should be called again on re-render
    expect(useAuthToasts).toHaveBeenCalledTimes(2);
    expect(useWebSocketToasts).toHaveBeenCalledTimes(2);
  });

  it('handles empty children', async () => {
    const { useAuthToasts } = await import('@/hooks/useAuthToasts');
    const { useWebSocketToasts } = await import('@/hooks/useWebSocketToasts');

    render(<ToastEventProvider>{null}</ToastEventProvider>);

    // Component should still call hooks even with no children
    expect(useAuthToasts).toHaveBeenCalledTimes(1);
    expect(useWebSocketToasts).toHaveBeenCalledTimes(1);
  });

  it('handles undefined children', async () => {
    const { useAuthToasts } = await import('@/hooks/useAuthToasts');
    const { useWebSocketToasts } = await import('@/hooks/useWebSocketToasts');

    render(<ToastEventProvider>{undefined}</ToastEventProvider>);

    expect(useAuthToasts).toHaveBeenCalledTimes(1);
    expect(useWebSocketToasts).toHaveBeenCalledTimes(1);
  });

  it('has correct component structure', () => {
    const { container } = render(
      <ToastEventProvider>
        <div data-testid="test-content">Test</div>
      </ToastEventProvider>
    );

    // Should render as React Fragment, so no extra DOM nodes
    const directChildren = Array.from(container.children);
    expect(directChildren).toHaveLength(1);
    expect(directChildren[0]).toHaveAttribute('data-testid', 'test-content');
  });
});
