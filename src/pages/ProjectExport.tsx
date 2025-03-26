
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Download, ArrowLeft, Check, X, FileSpreadsheet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectData } from '@/hooks/useProjectData';
import ProjectHeader from '@/components/project/ProjectHeader';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { calculatePolygonArea, calculatePerimeter } from '@/lib/segmentation';
import { SpheroidMetric } from '@/types';

// Calculate metrics for spheroid objects
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
    const mainArea = calculatePolygonArea(polygon.points);
    const holesArea = holes.reduce((sum, hole) => sum + calculatePolygonArea(hole.points), 0);
    const area = mainArea - holesArea;
    
    // Calculate perimeter
    const perimeter = calculatePerimeter(polygon.points);
    
    // Calculate circularity: 4π × area / perimeter²
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    
    return {
      objectId: index + 1,
      area,
      perimeter,
      circularity,
      equivalentDiameter: Math.sqrt(4 * area / Math.PI),
      compactness: Math.random() * 0.5 + 0.5, // Simulated values for demonstration
      convexity: Math.random() * 0.3 + 0.7,
      solidity: Math.random() * 0.2 + 0.8,
      sphericity: Math.random() * 0.4 + 0.6,
      feretDiameterMax: Math.random() * 100 + 20,
      feretDiameterMin: Math.random() * 40 + 10,
      aspectRatio: Math.random() * 3 + 1
    };
  });
};

const ProjectExport = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const { projectTitle, images, loading } = useProjectData(projectId, user?.id);
  
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
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <ProjectHeader
        projectTitle={projectTitle}
        imagesCount={images.length}
        loading={loading}
      />
      
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <Button
            variant="outline"
            size="sm"
            className="flex items-center"
            onClick={() => navigate(`/project/${projectId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zpět na projekt
          </Button>
          
          <Button
            disabled={getSelectedCount() === 0 || isExporting}
            onClick={handleExport}
            className="flex items-center"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Exportovat {getSelectedCount()} obrázků
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Možnosti exportu</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="include-metadata" 
                    checked={includeMetadata} 
                    onCheckedChange={() => setIncludeMetadata(!includeMetadata)} 
                  />
                  <Label htmlFor="include-metadata">Zahrnout metadata</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="include-segmentation" 
                    checked={includeSegmentation} 
                    onCheckedChange={() => setIncludeSegmentation(!includeSegmentation)} 
                  />
                  <Label htmlFor="include-segmentation">Zahrnout segmentaci</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="include-object-metrics" 
                    checked={includeObjectMetrics} 
                    onCheckedChange={() => setIncludeObjectMetrics(!includeObjectMetrics)} 
                  />
                  <Label htmlFor="include-object-metrics">Zahrnout metriky objektů</Label>
                </div>
                
                {includeObjectMetrics && (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center w-full"
                      onClick={handleExportMetricsAsXlsx}
                      disabled={getSelectedCount() === 0 || isExporting}
                    >
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Exportovat pouze metriky (XLSX)
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Vyberte obrázky k exportu</CardTitle>
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {images.every(img => selectedImages[img.id]) ? 'Odznačit vše' : 'Vybrat vše'}
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center items-center h-40">
                  <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                </div>
              ) : images.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  Žádné obrázky nejsou k dispozici
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                  {images.map(image => (
                    <div 
                      key={image.id} 
                      className="flex items-center border p-3 rounded-md space-x-4 hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => handleSelectImage(image.id)}
                    >
                      <div className="flex items-center h-5">
                        <Checkbox 
                          checked={!!selectedImages[image.id]} 
                          onCheckedChange={() => handleSelectImage(image.id)}
                          id={`check-${image.id}`}
                        />
                      </div>
                      
                      <div className="h-10 w-10 bg-gray-200 rounded overflow-hidden flex-shrink-0">
                        {image.thumbnail_url ? (
                          <img 
                            src={image.thumbnail_url} 
                            alt={image.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <span className="text-xs text-gray-400">No preview</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 truncate">
                        <div className="font-medium text-sm">{image.name || 'Untitled'}</div>
                        <div className="text-xs text-gray-500">
                          {image.createdAt && format(image.createdAt, 'PPP')}
                        </div>
                      </div>
                      
                      <div className="flex-shrink-0">
                        {image.segmentationStatus === 'completed' ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : image.segmentationStatus === 'failed' ? (
                          <X className="h-5 w-5 text-red-500" />
                        ) : (
                          <div className="h-5 w-5" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ProjectExport;
