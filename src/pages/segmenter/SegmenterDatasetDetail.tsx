import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Trash2,
  ImageOff,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import DashboardHeader from '@/components/DashboardHeader';
import { PageContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import DropZone from '@/components/upload/DropZone';
import { isVideoLikeUpload } from '@/lib/uploadUtils';
import segmenterApi, {
  type SegmenterImage,
  segmenterThumbnailUrl,
} from '@/lib/segmenterApi';
import { useLanguage } from '@/contexts/exports';
import { useSegmenterClasses } from './hooks/useSegmenterClasses';
import ClassManagerPanel from './components/ClassManagerPanel';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';

/**
 * `/segmenter/:datasetId` — a dataset's image grid + upload dropzone + class
 * manager. Per-image annotation happens in the polygon editor, mounted (by
 * the orchestrator) at `/segmenter/:datasetId/image/:imageId`.
 */
const SegmenterDatasetDetail: React.FC = () => {
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [datasetName, setDatasetName] = useState<string>('');
  const [images, setImages] = useState<SegmenterImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SegmenterImage | null>(null);
  const [isDeletingImage, setIsDeletingImage] = useState(false);
  // Thumbnails that failed to load (broken/missing file) — rendered as a
  // placeholder instead of retrying a nonexistent `/display` route (that
  // route was removed; see `segmenterApi.ts`).
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(
    new Set()
  );

  const {
    classes,
    loading: classesLoading,
    createClass,
    renameClass,
    deleteClass,
  } = useSegmenterClasses(datasetId);

  const fetchDataset = useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      const detail = await segmenterApi.getDataset(datasetId);
      setDatasetName(detail.name);
      setImages(detail.images);
    } catch (err) {
      logger.error('Failed to load segmenter dataset', err as Error);
      toast.error(
        getErrorMessage(err) ||
          (t('segmenter.datasetDetail.loadFailed') as string)
      );
    } finally {
      setLoading(false);
    }
  }, [datasetId, t]);

  useEffect(() => {
    fetchDataset();
  }, [fetchDataset]);

  const handleDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!datasetId || isUploading) return;

      // v1 scope is images only (no video/stack extraction machinery) — see
      // spec §2 "out of scope". Filter defensively even though DropZone's own
      // accept list already skews toward images; a renamed/misdetected file
      // could still slip through.
      const imageFiles = acceptedFiles.filter(f => !isVideoLikeUpload(f));
      const skipped = acceptedFiles.length - imageFiles.length;
      if (skipped > 0) {
        toast.warning(
          t('segmenter.upload.skippedVideo', { count: skipped }) as string
        );
      }
      if (imageFiles.length === 0) return;

      setIsUploading(true);
      setUploadProgress(0);
      try {
        const result = await segmenterApi.uploadImages(
          datasetId,
          imageFiles,
          percent => setUploadProgress(percent)
        );
        setImages(prev => [...prev, ...result.images]);
        // A partial failure is never swallowed behind a bare success toast —
        // report both the uploaded count AND the failed count so the user
        // knows to check the skipped files' format/size.
        if (result.images.length > 0) {
          toast.success(
            t('segmenter.upload.success', {
              count: result.images.length,
            }) as string
          );
        }
        if (result.failedCount > 0) {
          toast.warning(
            t('segmenter.upload.partialFail', {
              uploaded: result.images.length,
              failed: result.failedCount,
            }) as string
          );
        }
      } catch (err) {
        logger.error('Failed to upload segmenter images', err as Error);
        toast.error(
          getErrorMessage(err) || (t('segmenter.upload.failed') as string)
        );
      } finally {
        setIsUploading(false);
        setUploadProgress(null);
      }
    },
    [datasetId, isUploading, t]
  );

  const handleDeleteImageConfirm = async () => {
    if (!deleteTarget || isDeletingImage) return;
    setIsDeletingImage(true);
    try {
      await segmenterApi.deleteImage(deleteTarget.id);
      setImages(prev => prev.filter(img => img.id !== deleteTarget.id));
    } catch (err) {
      logger.error('Failed to delete segmenter image', err as Error);
      toast.error(
        getErrorMessage(err) ||
          (t('segmenter.datasetDetail.deleteFailed') as string)
      );
    } finally {
      setIsDeletingImage(false);
      setDeleteTarget(null);
    }
  };

  const imageCountLabel = useMemo(
    () => t('segmenter.datasetDetail.imageCount', { count: images.length }),
    [images.length, t]
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <DashboardHeader />

      <div className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/segmenter')}
              aria-label={t('segmenter.datasetDetail.backLabel') as string}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1
                className="text-xl font-semibold truncate"
                title={datasetName}
              >
                {loading ? t('segmenter.datasetDetail.loading') : datasetName}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {imageCountLabel}
              </p>
            </div>
          </div>
        </div>
      </div>

      <PageContainer>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-6">
            <div>
              <DropZone disabled={isUploading} onDrop={handleDrop} />
              {isUploading && uploadProgress !== null && (
                <div className="mt-2 flex items-center gap-3">
                  <Progress value={uploadProgress} className="flex-1" />
                  <span className="text-sm text-gray-500 w-10 text-right">
                    {uploadProgress}%
                  </span>
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center items-center h-48">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              </div>
            ) : images.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-center text-gray-500 dark:text-gray-400">
                <ImageOff className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                <p>{t('segmenter.datasetDetail.noImages')}</p>
              </div>
            ) : (
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(180px, 180px))',
                }}
              >
                {images.map(image => (
                  <div
                    key={image.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      navigate(`/segmenter/${datasetId}/image/${image.id}`)
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        navigate(`/segmenter/${datasetId}/image/${image.id}`);
                      }
                    }}
                    className="group relative overflow-hidden rounded-lg cursor-pointer bg-gray-100 dark:bg-gray-800 aspect-square transition-all hover:shadow-lg hover:scale-[1.02]"
                  >
                    {thumbnailErrors.has(image.id) ? (
                      <div
                        className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 p-2"
                        title={image.name}
                      >
                        <ImageOff className="h-6 w-6" />
                        <span className="text-[11px] text-center truncate max-w-full">
                          {image.name}
                        </span>
                      </div>
                    ) : (
                      <img
                        src={segmenterThumbnailUrl(image.id)}
                        alt={image.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => {
                          // The `/display` route this used to fall back to
                          // does not exist on the backend (only `/file`) —
                          // render a placeholder instead of retrying a 404.
                          setThumbnailErrors(prev => {
                            if (prev.has(image.id)) return prev;
                            const next = new Set(prev);
                            next.add(image.id);
                            return next;
                          });
                        }}
                      />
                    )}
                    {image.hasAnnotation && (
                      <div
                        className="absolute top-2 left-2 z-10 rounded-full bg-black/60 text-emerald-400 p-1 backdrop-blur-sm"
                        title={t('segmenter.datasetDetail.annotated') as string}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setDeleteTarget(image);
                      }}
                      className="absolute top-2 right-2 z-10 p-1.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600/90 transition-all"
                      aria-label={
                        t('segmenter.datasetDetail.deleteImage') as string
                      }
                      title={t('segmenter.datasetDetail.deleteImage') as string}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                      <p
                        className="text-xs text-white truncate"
                        title={image.name}
                      >
                        {image.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <ClassManagerPanel
              classes={classes}
              loading={classesLoading}
              onCreateClass={createClass}
              onRenameClass={renameClass}
              onDeleteClass={deleteClass}
            />
          </div>
        </div>
      </PageContainer>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('segmenter.datasetDetail.deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('segmenter.datasetDetail.deleteConfirmDescription', {
                name: deleteTarget?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingImage}>
              {t('segmenter.datasetDetail.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteImageConfirm}
              disabled={isDeletingImage}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeletingImage
                ? t('segmenter.datasetDetail.deleting')
                : t('segmenter.datasetDetail.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SegmenterDatasetDetail;
