import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: string;
}

export class SegmentationErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      error,
      errorInfo: errorInfo.componentStack,
    });

    // Log to console for debugging
    console.error(
      'SegmentationErrorBoundary caught an error:',
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Alert className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3">
            <div>
              <strong>Segmentation Error</strong>
              <p className="text-sm text-gray-600 mt-1">
                An error occurred while loading segmentation data. This might be
                due to network issues or server problems.
              </p>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer">Error Details</summary>
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
              Try Again
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}

export default SegmentationErrorBoundary;
