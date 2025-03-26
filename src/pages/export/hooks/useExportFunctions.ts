
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { toast } from 'sonner';
import { ProjectImage, SpheroidMetric } from '@/types';
import { calculateMetrics } from '@/pages/segmentation/utils/metricCalculations';

export const useExportFunctions = (images: ProjectImage[], projectTitle: string) => {
  const [selectedImages, setSelectedImages] = useState<Record<string, boolean>>({});
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeObjectMetrics, setIncludeObjectMetrics] = useState(true);
  const [includeSegmentation, setIncludeSegmentation] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  
  // Initialize selected images
  useEffect(() => {
    if (images.length > 0) {
      const initialSelection = images.reduce((acc, img) => {
        acc[img.id] = true;
        return acc;
      }, {} as Record<string, boolean>);
      setSelectedImages(initialSelection);
    }
  }, [images]);
  
  const handleSelectAll = () => {
    const allSelected = images.every(img => selectedImages[img.id]);
    const newSelection = images.reduce((acc, img) => {
      acc[img.id] = !allSelected;
      return acc;
    }, {} as Record<string, boolean>);
    setSelectedImages(newSelection);
  };
  
  const handleSelectImage = (imageId: string) => {
    setSelectedImages(prev => ({
      ...prev,
      [imageId]: !prev[imageId]
    }));
  };
  
  const getSelectedCount = () => {
    return Object.values(selectedImages).filter(Boolean).length;
  };
  
  const calculateObjectMetrics = (polygons: any[]) => {
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
        aspectRatio: metrics.FeretAspectRatio
      };
    });
  };
  
  const handleExportMetricsAsXlsx = async () => {
    setIsExporting(true);
    
    try {
      // Filter selected images
      const imagesToExport = images.filter(img => selectedImages[img.id]);
      
      // Collect all metrics from all selected images
      const allMetrics: any[] = [];
      
      imagesToExport.forEach(image => {
        if (image.segmentationResult && image.segmentationResult.polygons) {
          const imageMetrics = calculateObjectMetrics(image.segmentationResult.polygons);
          
          if (imageMetrics) {
            imageMetrics.forEach((metric, index) => {
              allMetrics.push({
                'Image Name': image.name || 'Unnamed',
                'Image ID': image.id,
                'Object ID': index + 1,
                'Area (px²)': metric.area.toFixed(2),
                'Perimeter (px)': metric.perimeter.toFixed(2),
                'Circularity': metric.circularity.toFixed(4),
                'Equivalent Diameter (px)': metric.equivalentDiameter.toFixed(2),
                'Aspect Ratio': metric.aspectRatio.toFixed(2),
                'Compactness': metric.compactness.toFixed(4),
                'Convexity': metric.convexity.toFixed(4),
                'Solidity': metric.solidity.toFixed(4),
                'Sphericity': metric.sphericity.toFixed(4),
                'Feret Diameter Max (px)': metric.feretDiameterMax.toFixed(2),
                'Feret Diameter Min (px)': metric.feretDiameterMin.toFixed(2),
                'Created At': image.createdAt ? format(image.createdAt, 'yyyy-MM-dd HH:mm:ss') : 'N/A'
              });
            });
          }
        }
      });
      
      if (allMetrics.length === 0) {
        toast.error('Žádná data pro export. Vybrané obrázky nemají segmentaci.');
        setIsExporting(false);
        return;
      }
      
      // Create worksheet
      const worksheet = utils.json_to_sheet(allMetrics);
      
      // Set column widths
      const colWidths = [
        { wch: 20 }, // Image Name
        { wch: 36 }, // Image ID
        { wch: 10 }, // Object ID
        { wch: 12 }, // Area
        { wch: 15 }, // Perimeter
        { wch: 12 }, // Circularity
        { wch: 22 }, // Equivalent Diameter
        { wch: 12 }, // Aspect Ratio
        { wch: 12 }, // Compactness
        { wch: 12 }, // Convexity
        { wch: 12 }, // Solidity
        { wch: 12 }, // Sphericity
        { wch: 20 }, // Feret Diameter Max
        { wch: 20 }, // Feret Diameter Min
        { wch: 20 }  // Created At
      ];
      
      worksheet['!cols'] = colWidths;
      
      // Create workbook
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, 'Object Metrics');
      
      // Download file
      const filename = `${projectTitle || 'project'}_metrics_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      writeFile(workbook, filename);
      
      toast.success('Export metrik dokončen');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export selhal');
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
        const data: any = {
          id: img.id,
          name: img.name,
          url: img.url
        };
        
        if (includeMetadata) {
          data.metadata = {
            createdAt: img.createdAt,
            updatedAt: img.updatedAt,
            status: img.segmentationStatus
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
      
      toast.success('Export dokončen');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export selhal');
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
    setIncludeSegmentation
  };
};
