import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { logger } from '@/lib/logger';
import { useLanguage } from '@/contexts/exports';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  translations?: {
    title: string;
    description: string;
    errorDetails: string;
    tryAgain: string;
  };
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: string;
}

class SegmentationErrorBoundaryClass extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    logger.error('[SegmentationErrorBoundary] Error caught:', error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('[SegmentationErrorBoundary] Component stack:', errorInfo);
    this.setState({
      error,
      errorInfo: errorInfo.componentStack || '',
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const t = this.props.translations || {
        title: 'Segmentation Error',
        description:
          'An error occurred while loading segmentation data. This might be due to network issues or server problems.',
        errorDetails: 'Error Details',
        tryAgain: 'Try Again',
      };

      return (
        <Alert className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3">
            <div>
              <strong>{t.title}</strong>
              <p className="text-sm text-gray-600 mt-1">{t.description}</p>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer">{t.errorDetails}</summary>
                  <pre className="mt-1 whitespace-pre-wrap">
                    {this.state.error.toString()}
                    {this.state.errorInfo && `\n${this.state.errorInfo}`}
                  </pre>
                </details>
              )}
            </div>
            <Button
              onClick={this.handleRetry}
              variant="outline"
              size="sm"
              className="w-fit"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t.tryAgain}
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}

// Wrapper component to provide translations
export const SegmentationErrorBoundary = (
  props: Omit<Props, 'translations'>
) => {
  const { t } = useLanguage();

  const translations = {
    title: t('segmentationEditor.error.title'),
    description: t('segmentationEditor.error.description'),
    errorDetails: t('segmentationEditor.error.errorDetails'),
    tryAgain: t('segmentationEditor.error.tryAgain'),
  };

  return (
    <SegmentationErrorBoundaryClass {...props} translations={translations} />
  );
};

export default SegmentationErrorBoundary;
