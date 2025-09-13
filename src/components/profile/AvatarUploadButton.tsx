import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Camera } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { toast } from '@/hooks/use-toast';

interface AvatarUploadButtonProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  className?: string;
}

const AvatarUploadButton: React.FC<AvatarUploadButtonProps> = ({
  onFileSelect,
  disabled = false,
  className = '',
}) => {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/bmp',
        'image/tiff',
        'image/webp',
        'image/heic',
        'image/heif',
      ];

      if (!validTypes.includes(file.type)) {
        toast({
          title: t('common.error'),
          description: t('profile.avatar.invalidFileType'),
          variant: 'destructive',
        });
        return;
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        toast({
          title: t('common.error'),
          description: t('profile.avatar.fileTooLarge'),
          variant: 'destructive',
        });
        return;
      }

      onFileSelect(file);
    }

    // Reset input value to allow selecting the same file again
    if (event.target) {
      event.target.value = '';
    }
  };

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={disabled}
        variant="outline"
        size="icon"
        className={className}
        type="button"
        title={t('profile.avatar.uploadButton')}
        aria-label={t('profile.avatar.uploadButton')}
      >
        <Camera className="h-4 w-4" />
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        aria-label={t('profile.avatar.selectFile')}
      />
    </>
  );
};

export default AvatarUploadButton;
