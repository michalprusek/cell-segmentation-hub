import React, { Suspense, lazy, Component, ErrorInfo, ReactNode } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { logger } from '@/lib/logger';

// Lazy load chart components to reduce initial bundle size
const LineChart = lazy(() =>
  import('recharts').then(module => ({ default: module.LineChart }))
);

const BarChart = lazy(() =>
  import('recharts').then(module => ({ default: module.BarChart }))
);

const PieChart = lazy(() =>
  import('recharts').then(module => ({ default: module.PieChart }))
);

const Area = lazy(() =>
  import('recharts').then(module => ({ default: module.Area }))
);

const AreaChart = lazy(() =>
  import('recharts').then(module => ({ default: module.AreaChart }))
);

const Bar = lazy(() =>
  import('recharts').then(module => ({ default: module.Bar }))
);

const Line = lazy(() =>
  import('recharts').then(module => ({ default: module.Line }))
);

const XAxis = lazy(() =>
  import('recharts').then(module => ({ default: module.XAxis }))
);

const YAxis = lazy(() =>
  import('recharts').then(module => ({ default: module.YAxis }))
);

const CartesianGrid = lazy(() =>
  import('recharts').then(module => ({ default: module.CartesianGrid }))
);

const Tooltip = lazy(() =>
  import('recharts').then(module => ({ default: module.Tooltip }))
);

const Legend = lazy(() =>
  import('recharts').then(module => ({ default: module.Legend }))
);

const ResponsiveContainer = lazy(() =>
  import('recharts').then(module => ({ default: module.ResponsiveContainer }))
);

interface LazyChartErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  height?: number;
}

// Error boundary for handling chart loading failures
class LazyChartErrorBoundary extends Component<
  LazyChartErrorBoundaryProps,
  { hasError: boolean }
> {
  constructor(props: LazyChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('LazyChart failed to load', { error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div
          className="flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
          style={{ height: this.props.height || 200 }}
        >
          <div className="text-center text-gray-500 dark:text-gray-400">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm">Chart unavailable</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface LazyChartProps {
  children: ReactNode;
  height?: number;
  fallback?: ReactNode;
  className?: string;
}

const LazyChartWrapper: React.FC<LazyChartProps> = ({
  children,
  height = 200,
  fallback,
  className
}) => {
  return (
    <LazyChartErrorBoundary height={height} fallback={fallback}>
      <Suspense
        fallback={
          <div
            className={`flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 ${className || ''}`}
            style={{ height }}
          >
            <div className="text-center text-gray-500 dark:text-gray-400">
              <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
              <p className="text-sm">Loading chart...</p>
            </div>
          </div>
        }
      >
        {children}
      </Suspense>
    </LazyChartErrorBoundary>
  );
};

export {
  LazyChartWrapper,
  LineChart,
  BarChart,
  PieChart,
  Area,
  AreaChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
};