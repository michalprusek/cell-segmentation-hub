import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { ProjectImage, SpheroidMetric, PolygonData } from '@/types';
import { calculateMetrics } from '@/pages/segmentation/utils/metricCalculations';
import { logger } from '@/lib/logger';
import { useLanguage } from '@/contexts/LanguageContext';

export const useExportFunctions = (
  images: ProjectImage[],
  projectTitle: string
) => {
  const { t } = useLanguage();
  const [selectedImages, setSelectedImages] = useState<Record<string, boolean>>(
    {}
  );
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeObjectMetrics, setIncludeObjectMetrics] = useState(true);
  const [includeSegmentation, setIncludeSegmentation] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Initialize selected images
  useEffect(() => {
    if (images.length > 0) {
      const initialSelection = images.reduce(
        (acc, img) => {
          acc[img.id] = true;
          return acc;
        },
        {} as Record<string, boolean>
      );
      setSelectedImages(initialSelection);
    }
  }, [images]);

  const handleSelectAll = () => {
    const allSelected = images.every(img => selectedImages[img.id]);
    const newSelection = images.reduce(
      (acc, img) => {
        acc[img.id] = !allSelected;
        return acc;
      },
      {} as Record<string, boolean>
    );
    setSelectedImages(newSelection);
  };

  const handleSelectImage = (imageId: string) => {
    setSelectedImages(prev => ({
      ...prev,
      [imageId]: !prev[imageId],
    }));
  };

  const getSelectedCount = () => {
    return Object.values(selectedImages).filter(Boolean).length;
  };

  const calculateObjectMetrics = (polygons: PolygonData[]) => {
    if (!polygons || polygons.length === 0) return null;

    // Get external polygons
    const externalPolygons = polygons.filter(p => p.type === 'external');
    if (externalPolygons.length === 0) return null;

    // Calculate metrics for each external polygon
    return externalPolygons.map((polygon, index) => {
      // Find internal polygons (holes) for this external polygon
      const holes = polygons.filter(p => p.type === 'internal');

      // Calculate area
      const metrics = calculateMetrics(polygon, holes);

      return {
        objectId: index + 1,
        area: metrics.Area,
        perimeter: metrics.Perimeter,
        circularity: metrics.Circularity,
        equivalentDiameter: metrics.EquivalentDiameter,
        compactness: metrics.Compactness,
        convexity: metrics.Convexity,
        solidity: metrics.Solidity,
        sphericity: metrics.Sphericity,
        feretDiameterMax: metrics.FeretDiameterMax,
        feretDiameterMin: metrics.FeretDiameterMin,
        aspectRatio: metrics.FeretAspectRatio,
      };
    });
  };

  const handleExportMetricsAsXlsx = async () => {
    setIsExporting(true);

    try {
      // Filter selected images
      const imagesToExport = images.filter(img => selectedImages[img.id]);

      // Collect all metrics from all selected images
      const allMetrics: SpheroidMetric[] = [];

      imagesToExport.forEach(image => {
        if (image.segmentationResult && image.segmentationResult.polygons) {
          const imageMetrics = calculateObjectMetrics(
            image.segmentationResult.polygons
          );

          if (imageMetrics) {
            imageMetrics.forEach((metric, index) => {
              allMetrics.push({
                imageId: image.id,
                imageName: image.name || 'Unnamed',
                contourNumber: index + 1,
                area: parseFloat(metric.area.toFixed(2)),
                perimeter: parseFloat(metric.perimeter.toFixed(2)),
                circularity: parseFloat(metric.circularity.toFixed(4)),
                compactness: parseFloat(metric.compactness.toFixed(4)),
                convexity: parseFloat(metric.convexity.toFixed(4)),
                equivalentDiameter: parseFloat(
                  metric.equivalentDiameter.toFixed(2)
                ),
                aspectRatio: parseFloat(metric.aspectRatio.toFixed(2)),
                feretDiameterMax: parseFloat(
                  metric.feretDiameterMax.toFixed(2)
                ),
                feretDiameterMin: parseFloat(
                  metric.feretDiameterMin.toFixed(2)
                ),
                solidity: parseFloat(metric.solidity.toFixed(4)),
                sphericity: parseFloat(metric.sphericity.toFixed(4)),
              } as SpheroidMetric);
            });
          }
        }
      });

      if (allMetrics.length === 0) {
        toast.error(
          'Žádná data pro export. Vybrané obrázky nemají segmentaci.'
        );
        setIsExporting(false);
        return;
      }

      // Create workbook and worksheet using SheetJS
      const workbook = XLSX.utils.book_new();

      // Prepare data with headers
      const worksheetData = [
        [
          'Image Name',
          'Image ID',
          'Object ID',
          'Area (px²)',
          'Perimeter (px)',
          'Circularity',
          'Equivalent Diameter (px)',
          'Aspect Ratio',
          'Compactness',
          'Convexity',
          'Solidity',
          'Sphericity',
          'Feret Diameter Max (px)',
          'Feret Diameter Min (px)',
        ],
        ...allMetrics.map(metric => [
          metric.imageName,
          metric.imageId,
          metric.contourNumber,
          metric.area,
          metric.perimeter,
          metric.circularity,
          metric.equivalentDiameter,
          metric.aspectRatio,
          metric.compactness,
          metric.convexity,
          metric.solidity,
          metric.sphericity,
          metric.feretDiameterMax,
          metric.feretDiameterMin,
        ]),
      ];

      // Create worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Object Metrics');

      // Download file
      const filename = `${projectTitle || 'project'}_metrics_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      XLSX.writeFile(workbook, filename);

      toast.success(t('export.metricsExportComplete'));
    } catch (error) {
      logger.error('Export failed:', error);
      toast.error(t('export.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      // Filter selected images
      const imagesToExport = images.filter(img => selectedImages[img.id]);

      // Create export data based on selected options
      const exportData = imagesToExport.map(img => {
        const data: Record<string, unknown> = {
          id: img.id,
          name: img.name,
          url: img.url,
        };

        if (includeMetadata) {
          data.metadata = {
            createdAt: img.createdAt,
            updatedAt: img.updatedAt,
            status: img.segmentationStatus,
          };
        }

        if (includeSegmentation && img.segmentationResult) {
          data.segmentation = img.segmentationResult;
        }

        return data;
      });

      // Create a json file and trigger download
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `${projectTitle || 'project'}_export_${format(new Date(), 'yyyy-MM-dd')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // If object metrics option is selected, also export metrics to XLSX
      if (includeObjectMetrics) {
        await handleExportMetricsAsXlsx();
      }

      toast.success(t('export.exportComplete'));
    } catch (error) {
      logger.error('Export failed:', error);
      toast.error(t('export.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  return {
    selectedImages,
    includeMetadata,
    includeObjectMetrics,
    includeSegmentation,
    isExporting,
    handleSelectAll,
    handleSelectImage,
    getSelectedCount,
    handleExport,
    handleExportMetricsAsXlsx,
    setIncludeMetadata,
    setIncludeObjectMetrics,
    setIncludeSegmentation,
  };
};
