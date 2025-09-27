import React, { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import { SegmentationResult } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/exports';
import { lazyWithRetry, LazyImportErrorBoundary } from '@/lib/lazyWithRetry';

// Lazy load the heavy ExcelExporter component with automatic retry
const ExcelExporter = lazyWithRetry(
  () => import('./ExcelExporter'),
  'Excel Exporter'
);

interface LazyExcelExporterProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
}

// Component implementation

const LazyExcelExporter: React.FC<LazyExcelExporterProps> = ({
  segmentation,
  imageName,
}) => {
  const { t } = useLanguage();
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
        {t('segmentationEditor.export.exportAllMetrics')}
      </Button>
    );
  }

  return (
    <LazyImportErrorBoundary componentName="Excel Exporter">
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
