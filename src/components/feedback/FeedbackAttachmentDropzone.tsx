import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';

interface FeedbackAttachmentDropzoneProps {
  file: File | null;
  onChange: (file: File | null) => void;
  /** Defaults to 50 GB — matches the backend cap. */
  maxBytes?: number;
  disabled?: boolean;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024 * 1024;

/** Human-readable byte size (0 decimals for whole/large values). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/**
 * Optional drag-and-drop attachment for the feedback form. Accepts either a
 * screenshot OR the microscopy file the report is about (video / ND2 / TIFF),
 * up to 50 GB. On reject (oversize, wrong type, multi-file) the user sees a
 * clear-text reason surfaced from react-dropzone's `fileRejections`.
 */
const FeedbackAttachmentDropzone: React.FC<FeedbackAttachmentDropzoneProps> = ({
  file,
  onChange,
  maxBytes = DEFAULT_MAX_BYTES,
  disabled,
}) => {
  const { t } = useLanguage();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const next = acceptedFiles[0];
      if (next) onChange(next);
    },
    [onChange]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      accept: {
        'image/png': ['.png'],
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/tiff': ['.tif', '.tiff'],
        'video/mp4': ['.mp4'],
        'video/x-msvideo': ['.avi'],
        'video/quicktime': ['.mov'],
        'video/x-matroska': ['.mkv'],
        'video/webm': ['.webm'],
        // ND2 has no registered MIME — matched by extension.
        'application/octet-stream': ['.nd2'],
      },
      maxFiles: 1,
      maxSize: maxBytes,
      multiple: false,
      disabled: disabled || Boolean(file),
    });

  // Show the most recent rejection (oversize / wrong type) so the user
  // knows why their drop didn't take. Codes come straight from
  // react-dropzone (file-too-large / file-invalid-type).
  const rejection = fileRejections[0]?.errors[0];
  const rejectionMessage =
    rejection?.code === 'file-too-large'
      ? t(
          'feedback.attachmentTooLarge',
          `File too large — limit is ${formatBytes(maxBytes)}`
        )
      : rejection?.code === 'file-invalid-type'
        ? t(
            'feedback.attachmentInvalidType',
            'Unsupported file type (image, video or ND2 only)'
          )
        : rejection?.message;

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Paperclip className="h-4 w-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm truncate dark:text-gray-100">{file.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatBytes(file.size)}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={() => onChange(null)}
          disabled={disabled}
          type="button"
          aria-label={t('feedback.removeAttachment', 'Remove attachment')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-md px-4 py-6 cursor-pointer text-center transition-colors ${
          isDragActive
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 hover:border-blue-400 dark:border-gray-700 dark:hover:border-blue-600'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />
        <Paperclip className="h-6 w-6 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
        <p className="text-sm text-gray-700 dark:text-gray-200">
          {t(
            'feedback.attachmentPrompt',
            'Drag a file here, or click to select — a screenshot or the video/ND2 your report is about (up to 50 GB)'
          )}
        </p>
      </div>
      {rejectionMessage && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {rejectionMessage}
        </p>
      )}
    </div>
  );
};

export default FeedbackAttachmentDropzone;
