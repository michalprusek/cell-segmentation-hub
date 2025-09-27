import React from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { toast } from 'sonner';
import UPLOAD_CONFIG from '@/lib/uploadConfig';

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

  // Handle drop with file limit and size validation
  const handleDrop = (acceptedFiles: File[], rejectedFiles: any[]) => {
    // Get current language from localStorage or default to 'en'
    const currentLang = (localStorage.getItem('language') || 'en') as
      | 'cs'
      | 'en'
      | 'es'
      | 'de'
      | 'fr'
      | 'zh';

    // Check for files that exceed size limit
    const oversizedFiles: File[] = [];
    const validFiles: File[] = [];

    acceptedFiles.forEach(file => {
      if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES) {
        oversizedFiles.push(file);
      } else {
        validFiles.push(file);
      }
    });

    // Also check rejected files from react-dropzone
    rejectedFiles.forEach(fileRejection => {
      const error = fileRejection.errors[0];
      if (error?.code === 'file-too-large') {
        oversizedFiles.push(fileRejection.file);
      }
    });

    // Show toast notifications for oversized files
    if (oversizedFiles.length > 0) {
      const fileSizeLimitMessages = {
        cs: `${oversizedFiles.length} souborů překročilo limit velikosti ${UPLOAD_CONFIG.MAX_FILE_SIZE_MB}MB a nebude nahráno`,
        en: `${oversizedFiles.length} file(s) exceeded the ${UPLOAD_CONFIG.MAX_FILE_SIZE_MB}MB size limit and will not be uploaded`,
        es: `${oversizedFiles.length} archivo(s) excedieron el límite de tamaño de ${UPLOAD_CONFIG.MAX_FILE_SIZE_MB}MB y no se subirán`,
        de: `${oversizedFiles.length} Datei(en) überschritten das Größenlimit von ${UPLOAD_CONFIG.MAX_FILE_SIZE_MB}MB und werden nicht hochgeladen`,
        fr: `${oversizedFiles.length} fichier(s) ont dépassé la limite de taille de ${UPLOAD_CONFIG.MAX_FILE_SIZE_MB}MB et ne seront pas téléchargés`,
        zh: `${oversizedFiles.length}个文件超过了${UPLOAD_CONFIG.MAX_FILE_SIZE_MB}MB的大小限制，将不会被上传`,
      };

      // List the first few oversized files
      const maxFilesToShow = 3;
      const filesToShow = oversizedFiles.slice(0, maxFilesToShow);
      const filesList = filesToShow
        .map(f => `• ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`)
        .join('\n');
      const moreFiles =
        oversizedFiles.length > maxFilesToShow
          ? `\n... and ${oversizedFiles.length - maxFilesToShow} more`
          : '';

      toast.error(
        fileSizeLimitMessages[currentLang] || fileSizeLimitMessages.en,
        {
          description: filesList + moreFiles,
          duration: 5000,
        }
      );
    }

    // Check for total file count limit
    if (validFiles.length > 10000) {
      // Show toast notification for file limit exceeded
      const messages = {
        cs: 'Překročen maximální počet souborů. Limit je 10 000 souborů najednou.',
        en: 'Maximum file limit exceeded. The limit is 10,000 files at once.',
        es: 'Se excedió el límite máximo de archivos. El límite es de 10,000 archivos a la vez.',
        de: 'Maximale Dateianzahl überschritten. Das Limit beträgt 10.000 Dateien auf einmal.',
        fr: 'Limite maximale de fichiers dépassée. La limite est de 10 000 fichiers à la fois.',
        zh: '超出最大文件限制。限制为一次10,000个文件。',
      };

      toast.error(messages[currentLang] || messages.en);

      // Only pass the first 10,000 valid files
      onDrop(validFiles.slice(0, 10000));
      return;
    }

    // Upload only the valid files
    if (validFiles.length > 0) {
      onDrop(validFiles);

      if (oversizedFiles.length > 0) {
        // Show success message for valid files if some were rejected
        const successMessages = {
          cs: `${validFiles.length} souborů bude nahráno`,
          en: `${validFiles.length} file(s) will be uploaded`,
          es: `${validFiles.length} archivo(s) serán subidos`,
          de: `${validFiles.length} Datei(en) werden hochgeladen`,
          fr: `${validFiles.length} fichier(s) seront téléchargés`,
          zh: `将上传${validFiles.length}个文件`,
        };

        toast.success(successMessages[currentLang] || successMessages.en);
      }
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: handleDrop,
    accept: {
      'image/jpeg': [],
      'image/png': [],
      'image/tiff': [],
      'image/bmp': [],
    },
    maxSize: UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES, // Use centralized config (20MB)
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
