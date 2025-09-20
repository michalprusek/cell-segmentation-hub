import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  X,
  ImageIcon,
  Upload,
} from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { FileWithPreview, getFileSize } from '@/lib/fileUtils';

interface UploadFileCardProps {
  file: FileWithPreview;
  onRemove: (file: FileWithPreview) => void;
  className?: string;
}

// Helper function to get upload status display information
const getUploadStatusInfo = (status: string, t: (key: string) => string) => {
  switch (status) {
    case 'complete':
      return {
        label: t('images.complete'),
        icon: CheckCircle,
        className: 'bg-green-500/90 text-white',
        progressColor: 'bg-green-500',
        animate: false,
      };
    case 'uploading':
      return {
        label: t('images.uploading'),
        icon: Loader2,
        className: 'bg-blue-500/90 text-white',
        progressColor: 'bg-blue-500',
        animate: true,
      };
    case 'error':
      return {
        label: t('images.failed'),
        icon: XCircle,
        className: 'bg-red-500/90 text-white',
        progressColor: 'bg-red-500',
        animate: false,
      };
    case 'pending':
    default:
      return {
        label: t('images.pending'),
        icon: Clock,
        className: 'bg-yellow-500/90 text-white',
        progressColor: 'bg-yellow-500',
        animate: false,
      };
  }
};

export const UploadFileCard: React.FC<UploadFileCardProps> = React.memo(
  ({ file, onRemove, className }) => {
    const [imageError, setImageError] = useState(false);
    const { t } = useLanguage();

    const statusInfo = getUploadStatusInfo(file.status || 'pending', t);
    const StatusIcon = statusInfo.icon;
    const progress = file.uploadProgress || 0;

    // Reset image error when file changes
    React.useEffect(() => {
      setImageError(false);
    }, [file.preview]);

    const handleRemove = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onRemove(file);
      },
      [file, onRemove]
    );

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className={className}
      >
        <div
          className={cn(
            'relative overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800',
            'transition-all duration-200 hover:shadow-md border border-gray-200 dark:border-gray-700',
            'group'
          )}
          style={{
            width: '120px',
            height: '90px',
          }}
        >
          {/* Image preview */}
          <div className="absolute inset-0">
            {!imageError && file.preview ? (
              <img
                src={file.preview}
                alt={file.name}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
                <ImageIcon className="h-8 w-8 text-gray-400 dark:text-gray-500" />
              </div>
            )}
          </div>

          {/* Upload progress overlay for uploading files */}
          {file.status === 'uploading' && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="text-center text-white">
                <Upload className="h-6 w-6 mx-auto mb-1 animate-pulse" />
                <div className="text-xs font-medium">{progress}%</div>
              </div>
            </div>
          )}

          {/* Gradient overlay for better text visibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

          {/* Remove button - visible on hover */}
          <div className="absolute top-1 right-1 z-20">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0 rounded-full bg-black/50 hover:bg-black/70',
                'text-white hover:text-white opacity-0 group-hover:opacity-100',
                'transition-opacity duration-200'
              )}
              onClick={handleRemove}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          {/* Status badge - always visible */}
          <div className="absolute top-1 left-1 z-20">
            <Badge
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 text-xs h-5',
                statusInfo.className
              )}
            >
              <StatusIcon
                className={cn(
                  'h-2.5 w-2.5',
                  statusInfo.animate && 'animate-spin'
                )}
              />
            </Badge>
          </div>

          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-0 p-1.5 text-white z-10">
            <h4
              className="font-medium text-xs truncate mb-0.5"
              title={file.name}
            >
              {file.name}
            </h4>
            <p className="text-xs opacity-80">{getFileSize(file)}</p>
          </div>

          {/* Progress bar for uploading files */}
          {file.status === 'uploading' && (
            <div className="absolute bottom-0 left-0 right-0 z-20">
              <Progress
                value={progress}
                className="h-1 rounded-none"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                }}
              />
            </div>
          )}
        </div>
      </motion.div>
    );
  }
);

UploadFileCard.displayName = 'UploadFileCard';

export default UploadFileCard;
