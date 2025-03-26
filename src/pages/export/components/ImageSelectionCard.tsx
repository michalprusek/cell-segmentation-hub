
import React from 'react';
import { format } from 'date-fns';
import { Loader2, Check, X } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ProjectImage } from '@/types';

interface ImageSelectionCardProps {
  images: ProjectImage[];
  loading: boolean;
  selectedImages: Record<string, boolean>;
  handleSelectAll: () => void;
  handleSelectImage: (imageId: string) => void;
}

const ImageSelectionCard: React.FC<ImageSelectionCardProps> = ({
  images,
  loading,
  selectedImages,
  handleSelectAll,
  handleSelectImage
}) => {
  return (
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
  );
};

export default ImageSelectionCard;
