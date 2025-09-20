import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, X, Play, Upload, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/useLanguage';

export type OperationType = 'upload' | 'segmentation' | 'export';

interface UniversalCancelButtonProps {
  operationType: OperationType;
  isOperationActive: boolean;
  isCancelling: boolean;
  onCancel: () => void;
  onPrimaryAction: () => void;
  primaryText: string;
  cancelText?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default' | 'lg';
  variant?:
    | 'default'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'ghost'
    | 'link';
}

/**
 * Universal cancel button component that replaces primary action buttons
 * with cancel functionality during operations, with loading animations
 */
export const UniversalCancelButton: React.FC<UniversalCancelButtonProps> = ({
  operationType,
  isOperationActive,
  isCancelling,
  onCancel,
  onPrimaryAction,
  primaryText,
  cancelText,
  disabled = false,
  className,
  size = 'default',
  variant = 'default',
}) => {
  const { t } = useLanguage();

  // Get operation-specific icons
  const getOperationIcon = () => {
    switch (operationType) {
      case 'upload':
        return <Upload className="h-4 w-4" data-testid="upload-icon" />;
      case 'segmentation':
        return <Play className="h-4 w-4" data-testid="play-icon" />;
      case 'export':
        return <Download className="h-4 w-4" data-testid="download-icon" />;
    }
  };

  // Get default cancel text if not provided
  const getDefaultCancelText = () => {
    switch (operationType) {
      case 'upload':
        return t('upload.cancelUpload');
      case 'segmentation':
        return t('queue.cancelSegmentation');
      case 'export':
        return t('export.cancelExport');
    }
  };

  const finalCancelText = cancelText || getDefaultCancelText();

  // Show cancel button when operation is active
  if (isOperationActive) {
    return (
      <Button
        onClick={onCancel}
        disabled={isCancelling}
        className={cn(
          'gap-2 transition-all',
          // Cancel button styling - destructive variant
          'bg-red-600 hover:bg-red-700 text-white',
          isCancelling && 'bg-red-400 cursor-not-allowed',
          className
        )}
        size={size}
        variant="destructive"
      >
        {isCancelling ? (
          <>
            <Loader2
              className="h-4 w-4 animate-spin"
              data-testid="loader-icon"
            />
            {t('common.cancelling')}
          </>
        ) : (
          <>
            <X className="h-4 w-4" data-testid="cancel-icon" />
            {finalCancelText}
          </>
        )}
      </Button>
    );
  }

  // Show primary action button when no operation is active
  return (
    <Button
      onClick={onPrimaryAction}
      disabled={disabled}
      className={cn(
        'gap-2 transition-all',
        // Primary button styling based on operation type
        operationType === 'segmentation' &&
          'bg-blue-600 hover:bg-blue-700 text-white',
        operationType === 'upload' &&
          'bg-green-600 hover:bg-green-700 text-white',
        operationType === 'export' &&
          'bg-purple-600 hover:bg-purple-700 text-white',
        disabled &&
          'bg-gray-400 hover:bg-gray-400 text-gray-700 cursor-not-allowed',
        className
      )}
      size={size}
      variant={variant}
    >
      {getOperationIcon()}
      {primaryText}
    </Button>
  );
};

export default UniversalCancelButton;
