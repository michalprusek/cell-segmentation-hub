import React, { useState, useCallback } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Loader2, X, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { cropImageToCircle } from '@/lib/cropImage';
import { toast } from '@/hooks/use-toast';

interface AvatarCropDialogProps {
  open: boolean;
  onClose: () => void;
  imageSrc: string;
  onCropComplete: (croppedImageBlob: Blob) => Promise<void>;
}

const AvatarCropDialog: React.FC<AvatarCropDialogProps> = ({
  open,
  onClose,
  imageSrc,
  onCropComplete,
}) => {
  const { t } = useLanguage();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropCompleteCallback = useCallback(
    (croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    []
  );

  const handleApplyChanges = async () => {
    if (!croppedAreaPixels) {
      return;
    }

    setIsProcessing(true);

    try {
      const croppedImage = await cropImageToCircle(imageSrc, croppedAreaPixels);
      await onCropComplete(croppedImage);
      onClose();
    } catch (error) {
      console.error('Error cropping image:', error);
      toast({
        title: t('common.error'),
        description: t('profile.avatar.cropError'),
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md mx-auto">
        <DialogHeader>
          <DialogTitle className="text-center">
            {t('profile.avatar.cropTitle')}
          </DialogTitle>
          <DialogDescription className="text-center">
            {t(
              'profile.avatar.cropDescription',
              'Crop your avatar image to fit perfectly'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Crop area */}
          <div className="relative w-full h-64 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1} // Square aspect ratio for circular crop
              cropShape="round" // Circular crop shape
              onCropChange={setCrop}
              onCropComplete={onCropCompleteCallback}
              onZoomChange={setZoom}
              showGrid={false} // Hide grid for cleaner circular crop
              style={{
                containerStyle: {
                  width: '100%',
                  height: '100%',
                  backgroundColor: 'transparent',
                },
              }}
            />
          </div>

          {/* Zoom control */}
          <div className="space-y-2">
            <Label htmlFor="zoom-slider" className="text-sm font-medium">
              {t('profile.avatar.zoomLevel')}
            </Label>
            <div className="px-2">
              <Slider
                id="zoom-slider"
                min={1}
                max={3}
                step={0.1}
                value={[zoom]}
                onValueChange={value => setZoom(value[0])}
                className="w-full"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>1x</span>
              <span>3x</span>
            </div>
          </div>

          {/* Instructions */}
          <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
            {t('profile.avatar.cropInstructions')}
          </div>
        </div>

        <DialogFooter className="flex justify-end space-x-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isProcessing}
            className="flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleApplyChanges}
            disabled={isProcessing || !croppedAreaPixels}
            className="flex items-center gap-2"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isProcessing
              ? t('profile.avatar.processing')
              : t('profile.avatar.applyChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AvatarCropDialog;
