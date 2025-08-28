import React, { Component, ReactNode } from 'react';
import { useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { logger } from '@/lib/logger';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

// React Router Error Boundary Component (for route errors)
function RouterErrorBoundary() {
  const error = useRouteError();
  const { t } = useLanguage();

  logger.error('Router ErrorBoundary caught an error', { error });

  // Handle React Router errors
  if (isRouteErrorResponse(error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
            {error.status} {error.statusText}
          </h1>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            {error.data?.message || t('toast.somethingWentWrong')}
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-700"
          >
            {t('toast.returnToHome')}
          </a>
        </div>
      </div>
    );
  }

  // Handle generic errors
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
          {t('toast.unexpectedError')}
        </h1>
        <p className="text-gray-700 dark:text-gray-300 mb-6">
          {t('toast.somethingWentWrong')}
        </p>
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-700"
        >
          {t('toast.returnToHome')}
        </a>
      </div>
    </div>
  );
}

// Class-based Error Boundary Component (for JavaScript errors)
class ErrorBoundaryClass extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught an error', { error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return <ErrorDisplay error={this.state.error} />;
    }

    return this.props.children;
  }
}

function ErrorDisplay({ error }: { error: Error | null }) {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
          {t('toast.unexpectedError')}
        </h1>
        <p className="text-gray-700 dark:text-gray-300 mb-6">
          {error?.message || t('toast.somethingWentWrong')}
        </p>
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-700"
        >
          {t('toast.returnToHome')}
        </a>
      </div>
    </div>
  );
}

// Export the router error boundary by default (what tests expect)
export default RouterErrorBoundary;

// Also export the class-based boundary for JavaScript error handling
export { ErrorBoundaryClass };
