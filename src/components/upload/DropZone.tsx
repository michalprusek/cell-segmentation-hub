import React from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { toast } from 'sonner';

interface DropZoneProps {
  disabled: boolean;
  onDrop: (acceptedFiles: File[]) => void;
  isDragActive: boolean;
}

const DropZone: React.FC<DropZoneProps> = ({
  disabled,
  onDrop,
  isDragActive,
}) => {
  const { t } = useLanguage();

  // Handle drop with 10,000 file limit check
  const handleDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 10000) {
      // Show toast notification for file limit exceeded
      const messages = {
        cs: 'Překročen maximální počet souborů. Limit je 10 000 souborů najednou.',
        en: 'Maximum file limit exceeded. The limit is 10,000 files at once.',
        es: 'Se excedió el límite máximo de archivos. El límite es de 10,000 archivos a la vez.',
        de: 'Maximale Dateianzahl überschritten. Das Limit beträgt 10.000 Dateien auf einmal.',
        fr: 'Limite maximale de fichiers dépassée. La limite est de 10 000 fichiers à la fois.',
        zh: '超出最大文件限制。限制为一次10,000个文件。',
      };

      // Get current language from localStorage or default to 'en'
      const currentLang = (localStorage.getItem('language') ||
        'en') as keyof typeof messages;
      toast.error(messages[currentLang] || messages.en);

      // Only pass the first 10,000 files
      onDrop(acceptedFiles.slice(0, 10000));
      return;
    }

    onDrop(acceptedFiles);
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: handleDrop,
    accept: {
      'image/jpeg': [],
      'image/png': [],
      'image/tiff': [],
      'image/bmp': [],
    },
    maxSize: 100 * 1024 * 1024, // 100MB per file (increased from 10MB)
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
        isDragActive
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 hover:border-blue-400 dark:border-gray-700 dark:hover:border-blue-600'
      } ${disabled ? 'opacity-70 pointer-events-none bg-gray-100 dark:bg-gray-800/50' : ''}`}
    >
      <input {...getInputProps()} disabled={disabled} />
      <div className="flex flex-col items-center space-y-3 text-center">
        <Upload
          className={`h-12 w-12 ${!disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-300 dark:text-gray-700'}`}
        />
        <div>
          <p
            className={`text-base font-medium ${disabled ? 'text-gray-400 dark:text-gray-600' : 'dark:text-white'}`}
          >
            {isDragActive
              ? t('images.dropImagesHere')
              : !disabled
                ? t('images.dragDrop')
                : t('projects.createProject')}
          </p>
          <p
            className={`text-sm ${!disabled ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400 dark:text-gray-600'} mt-1`}
          >
            {!disabled ? t('images.clickToSelect') : t('images.uploadingTo')}
          </p>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('images.acceptedFormats')}
        </p>
      </div>
    </div>
  );
};

export default DropZone;
