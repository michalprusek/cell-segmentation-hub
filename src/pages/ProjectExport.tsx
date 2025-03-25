
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Download, ArrowLeft, Check, X } from 'lucide-react';
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

const ProjectExport = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const { projectTitle, images, loading } = useProjectData(projectId, user?.id);
  
  const [selectedImages, setSelectedImages] = useState<Record<string, boolean>>({});
  const [includeMetadata, setIncludeMetadata] = useState(true);
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
