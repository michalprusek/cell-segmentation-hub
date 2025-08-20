import React, { Suspense, lazy, Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import { SegmentationResult } from '@/lib/segmentation';

// Lazy load the heavy ExcelExporter component that imports ExcelJS
const ExcelExporter = lazy(() => import('./ExcelExporter'));

interface LazyExcelExporterProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
}

// Error boundary for handling dynamic import failures
class LazyImportErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('LazyExcelExporter failed to load:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

const LazyExcelExporter: React.FC<LazyExcelExporterProps> = ({
  segmentation,
  imageName,
}) => {
  const [showExporter, setShowExporter] = React.useState(false);

  if (!segmentation || !segmentation.polygons) return null;

  if (!showExporter) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={() => setShowExporter(true)}
        className="text-xs"
      >
        <FileSpreadsheet className="h-4 w-4 mr-1" />
        Exportovat všechny metriky jako XLSX
      </Button>
    );
  }

  return (
    <LazyImportErrorBoundary
      fallback={
        <Button variant="default" size="sm" disabled className="text-xs">
          <AlertCircle className="h-4 w-4 mr-1" />
          Export Unavailable
        </Button>
      }
    >
      <Suspense
        fallback={
          <Button variant="default" size="sm" disabled className="text-xs">
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            Loading...
          </Button>
        }
      >
        <ExcelExporter segmentation={segmentation} imageName={imageName} />
      </Suspense>
    </LazyImportErrorBoundary>
  );
};

export default LazyExcelExporter;
