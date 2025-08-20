import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test-utils/reactTestUtils';
import ErrorBoundary from '@/components/ErrorBoundary';
import * as router from 'react-router-dom';

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useRouteError: vi.fn(),
    isRouteErrorResponse: vi.fn(),
  };
});

describe('ErrorBoundary', () => {
  const mockUseRouteError = vi.mocked(router.useRouteError);
  const mockIsRouteErrorResponse = vi.mocked(router.isRouteErrorResponse);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders route error response with status and statusText', () => {
    const mockError = {
      status: 404,
      statusText: 'Not Found',
      data: {
        message: 'The requested page was not found',
      },
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    expect(screen.getByText('404 Not Found')).toBeInTheDocument();
    expect(
      screen.getByText('The requested page was not found')
    ).toBeInTheDocument();
  });

  it('renders route error response without custom message', () => {
    const mockError = {
      status: 500,
      statusText: 'Internal Server Error',
      data: null,
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    expect(screen.getByText('500 Internal Server Error')).toBeInTheDocument();
    // Should fallback to translation key when no custom message
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('renders generic error for non-route errors', () => {
    const mockError = new Error('Generic error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    render(<ErrorBoundary />);

    expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('renders return to home link for route errors', () => {
    const mockError = {
      status: 404,
      statusText: 'Not Found',
      data: { message: 'Page not found' },
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    const homeLink = screen.getByRole('link', { name: /return to home/i });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('renders return to home link for generic errors', () => {
    const mockError = new Error('Generic error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    render(<ErrorBoundary />);

    const homeLink = screen.getByRole('link', { name: /return to home/i });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('has proper styling classes for route errors', () => {
    const mockError = {
      status: 403,
      statusText: 'Forbidden',
      data: { message: 'Access denied' },
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    const container = document.querySelector(
      '.min-h-screen.flex.items-center.justify-center'
    );
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('bg-gray-100', 'dark:bg-gray-900');

    const errorCard = document.querySelector('.bg-white.dark\\:bg-gray-800');
    expect(errorCard).toBeInTheDocument();
    expect(errorCard).toHaveClass(
      'p-8',
      'rounded-lg',
      'shadow-lg',
      'max-w-md',
      'w-full'
    );

    const title = screen.getByText('403 Forbidden');
    expect(title).toHaveClass(
      'text-2xl',
      'font-bold',
      'text-red-600',
      'dark:text-red-400',
      'mb-4'
    );
  });

  it('has proper styling classes for generic errors', () => {
    const mockError = new Error('Generic error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    render(<ErrorBoundary />);

    const container = document.querySelector(
      '.min-h-screen.flex.items-center.justify-center'
    );
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('bg-gray-100', 'dark:bg-gray-900');

    const errorCard = document.querySelector('.bg-white.dark\\:bg-gray-800');
    expect(errorCard).toBeInTheDocument();

    const title = screen.getByText(/unexpected error/i);
    expect(title).toHaveClass(
      'text-2xl',
      'font-bold',
      'text-red-600',
      'dark:text-red-400',
      'mb-4'
    );
  });

  it('has proper button styling', () => {
    const mockError = new Error('Test error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    render(<ErrorBoundary />);

    const homeLink = screen.getByRole('link', { name: /return to home/i });
    expect(homeLink).toHaveClass(
      'inline-flex',
      'items-center',
      'justify-center',
      'rounded-md',
      'bg-blue-600',
      'px-4',
      'py-2',
      'text-sm',
      'font-medium',
      'text-white',
      'shadow',
      'transition-colors',
      'hover:bg-blue-700',
      'focus-visible:outline-none',
      'focus-visible:ring-1',
      'focus-visible:ring-blue-700'
    );
  });

  it('handles different HTTP status codes', () => {
    const testCases = [
      { status: 400, statusText: 'Bad Request' },
      { status: 401, statusText: 'Unauthorized' },
      { status: 403, statusText: 'Forbidden' },
      { status: 404, statusText: 'Not Found' },
      { status: 500, statusText: 'Internal Server Error' },
      { status: 503, statusText: 'Service Unavailable' },
    ];

    testCases.forEach(({ status, statusText }) => {
      const mockError = {
        status,
        statusText,
        data: { message: `${status} error occurred` },
      };

      mockUseRouteError.mockReturnValue(mockError);
      mockIsRouteErrorResponse.mockReturnValue(true);

      const { unmount } = render(<ErrorBoundary />);

      expect(screen.getByText(`${status} ${statusText}`)).toBeInTheDocument();
      expect(screen.getByText(`${status} error occurred`)).toBeInTheDocument();

      unmount();
    });
  });

  it('handles route error without data', () => {
    const mockError = {
      status: 404,
      statusText: 'Not Found',
      data: undefined,
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    expect(screen.getByText('404 Not Found')).toBeInTheDocument();
    // Should fallback to translation when no data.message
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('handles route error with empty data', () => {
    const mockError = {
      status: 500,
      statusText: 'Internal Server Error',
      data: {},
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    expect(screen.getByText('500 Internal Server Error')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('renders full-screen layout', () => {
    const mockError = new Error('Test error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    const { container } = render(<ErrorBoundary />);

    const outerDiv = container.firstChild;
    expect(outerDiv).toHaveClass('min-h-screen');
  });

  it('centers content properly', () => {
    const mockError = new Error('Test error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    render(<ErrorBoundary />);

    const centeringContainer = document.querySelector(
      '.flex.items-center.justify-center'
    );
    expect(centeringContainer).toBeInTheDocument();
    expect(centeringContainer).toHaveClass('min-h-screen');
  });

  it('has responsive card sizing', () => {
    const mockError = new Error('Test error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    render(<ErrorBoundary />);

    const card = document.querySelector('.max-w-md.w-full');
    expect(card).toBeInTheDocument();
  });

  it('uses semantic HTML structure', () => {
    const mockError = {
      status: 404,
      statusText: 'Not Found',
      data: { message: 'Page not found' },
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('404 Not Found');

    const link = screen.getByRole('link', { name: /return to home/i });
    expect(link).toBeInTheDocument();
  });

  it('provides proper dark mode support', () => {
    const mockError = new Error('Test error');

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(false);

    render(<ErrorBoundary />);

    // Check for dark mode classes
    expect(document.querySelector('.dark\\:bg-gray-900')).toBeInTheDocument();
    expect(document.querySelector('.dark\\:bg-gray-800')).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-red-400')).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-gray-300')).toBeInTheDocument();
  });

  it('handles complex error objects', () => {
    const mockError = {
      status: 422,
      statusText: 'Unprocessable Entity',
      data: {
        message: 'Validation failed',
        errors: ['Field is required', 'Invalid format'],
        code: 'VALIDATION_ERROR',
      },
    };

    mockUseRouteError.mockReturnValue(mockError);
    mockIsRouteErrorResponse.mockReturnValue(true);

    render(<ErrorBoundary />);

    expect(screen.getByText('422 Unprocessable Entity')).toBeInTheDocument();
    expect(screen.getByText('Validation failed')).toBeInTheDocument();
  });
});
