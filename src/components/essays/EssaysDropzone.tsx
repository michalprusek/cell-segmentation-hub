import React, { useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { FolderUp } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import { Button } from '@/components/ui/button';

interface EssaysDropzoneProps {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

const keepNd2 = (files: File[]): File[] =>
  files.filter(f => f.name.toLowerCase().endsWith('.nd2'));

/**
 * Folder-capable dropzone for Automated Essays. Accepts a folder of .nd2 wells
 * two ways: dragging a folder onto the drop area (react-dropzone recurses the
 * directory tree) or the "Select folder" button, which opens a native folder
 * picker via a webkitdirectory input. Non-.nd2 files are ignored.
 */
const EssaysDropzone: React.FC<EssaysDropzoneProps> = ({
  disabled = false,
  onFiles,
}) => {
  const { t } = useLanguage();
  const folderInputRef = useRef<HTMLInputElement>(null);

  // webkitdirectory / directory aren't in React's input prop types; set them
  // imperatively so the button opens a folder (not file) picker.
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  const emit = (files: File[]) => {
    const nd2 = keepNd2(files);
    if (nd2.length === 0) {
      // Never leave the picker/drop with no feedback — the user picked
      // something, so tell them nothing usable was found rather than no-op.
      toast.error(t('automatedEssays.noNd2Found'));
      return;
    }
    if (nd2.length < files.length) {
      toast.info(
        t('automatedEssays.someIgnored', {
          kept: nd2.length,
          total: files.length,
        })
      );
    }
    onFiles(nd2);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: accepted => emit(accepted),
    accept: { 'application/octet-stream': ['.nd2'] },
    disabled,
    noClick: true, // the drop area is drag-only; folder pick uses the button
    noKeyboard: true,
  });

  const onFolderPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    emit(Array.from(e.target.files ?? []));
    e.target.value = ''; // allow re-picking the same folder
  };

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-8 transition-colors ${
        isDragActive
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 dark:border-gray-700'
      } ${disabled ? 'opacity-70 pointer-events-none' : ''}`}
    >
      <input {...getInputProps()} />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFolderPicked}
        disabled={disabled}
      />
      <div className="flex flex-col items-center space-y-3 text-center">
        <FolderUp className="h-12 w-12 text-gray-400 dark:text-gray-500" />
        <p className="text-base font-medium dark:text-white">
          {isDragActive
            ? t('automatedEssays.dropHere')
            : t('automatedEssays.dragFolder')}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => folderInputRef.current?.click()}
        >
          {t('automatedEssays.selectFolder')}
        </Button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('automatedEssays.onlyNd2')}
        </p>
      </div>
    </div>
  );
};

export default EssaysDropzone;
