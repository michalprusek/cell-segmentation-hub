import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Trash2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import DashboardHeader from '@/components/DashboardHeader';
import { PageContainer, ContentCard, FlexBetween } from '@/components/layout';
import { ProjectsGrid } from '@/components/layout/ResponsiveGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import segmenterApi, { type SegmenterDataset } from '@/lib/segmenterApi';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';
import { useLanguage } from '@/contexts/exports';

/**
 * `/segmenter` landing page: lists the current user's datasets, lets them
 * create a new one, and delete existing ones. Per-dataset annotation work
 * happens in `SegmenterDatasetDetail` (image grid + class manager) and the
 * polygon editor (owned by a different work-stream, mounted at
 * `/segmenter/:datasetId/image/:imageId`).
 */
const SegmenterDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [datasets, setDatasets] = useState<SegmenterDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SegmenterDataset | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDatasets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await segmenterApi.listDatasets();
      setDatasets(list);
    } catch (err) {
      logger.error('Failed to load segmenter datasets', err as Error);
      toast.error(
        getErrorMessage(err) || (t('segmenter.dashboard.loadFailed') as string)
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    try {
      const created = await segmenterApi.createDataset(trimmed);
      setDatasets(prev => [created, ...prev]);
      toast.success(t('segmenter.dashboard.created') as string);
      setCreateOpen(false);
      setNewName('');
      navigate(`/segmenter/${created.id}`);
    } catch (err) {
      logger.error('Failed to create segmenter dataset', err as Error);
      toast.error(
        getErrorMessage(err) ||
          (t('segmenter.dashboard.createFailed') as string)
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await segmenterApi.deleteDataset(deleteTarget.id);
      setDatasets(prev => prev.filter(d => d.id !== deleteTarget.id));
      toast.success(t('segmenter.dashboard.deleted') as string);
    } catch (err) {
      logger.error('Failed to delete segmenter dataset', err as Error);
      toast.error(
        getErrorMessage(err) ||
          (t('segmenter.dashboard.deleteFailed') as string)
      );
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <DashboardHeader />

      <PageContainer>
        <FlexBetween align="center" className="flex-col sm:flex-row mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1">
              {t('segmenter.dashboard.title')}
            </h1>
            <p className="text-gray-500">{t('segmenter.dashboard.subtitle')}</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {t('segmenter.dashboard.newDataset')}
          </Button>
        </FlexBetween>

        <ContentCard className="p-6">
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
            </div>
          ) : datasets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
              <FolderOpen className="h-10 w-10 text-gray-300 dark:text-gray-600" />
              <p className="text-gray-500 dark:text-gray-400">
                {t('segmenter.dashboard.noDatasets')}
              </p>
              <Button
                variant="outline"
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                {t('segmenter.dashboard.createFirst')}
              </Button>
            </div>
          ) : (
            <ProjectsGrid>
              {datasets.map(dataset => (
                <div
                  key={dataset.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/segmenter/${dataset.id}`)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      navigate(`/segmenter/${dataset.id}`);
                    }
                  }}
                  className="group relative rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 cursor-pointer transition-all hover:shadow-lg hover:scale-[1.01]"
                >
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      setDeleteTarget(dataset);
                    }}
                    className="absolute top-3 right-3 p-1.5 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-all"
                    aria-label={
                      t('segmenter.dashboard.deleteDataset') as string
                    }
                    title={t('segmenter.dashboard.deleteDataset') as string}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <h3
                    className="font-semibold text-gray-900 dark:text-gray-100 truncate pr-8"
                    title={dataset.name}
                  >
                    {dataset.name}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {t('segmenter.dashboard.imageCount', {
                      count: dataset.imageCount ?? 0,
                    })}
                  </p>
                </div>
              ))}
            </ProjectsGrid>
          )}
        </ContentCard>
      </PageContainer>

      {/* Create-dataset dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {t('segmenter.dashboard.createDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('segmenter.dashboard.createDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-2 py-2">
              <Label htmlFor="segmenter-dataset-name">
                {t('segmenter.dashboard.nameLabel')}
              </Label>
              <Input
                id="segmenter-dataset-name"
                placeholder={t('segmenter.dashboard.namePlaceholder') as string}
                value={newName}
                autoFocus
                onChange={e => setNewName(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={isCreating || newName.trim().length === 0}
              >
                {isCreating
                  ? t('segmenter.dashboard.creating')
                  : t('segmenter.dashboard.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('segmenter.dashboard.deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('segmenter.dashboard.deleteConfirmDescription', {
                name: deleteTarget?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('segmenter.dashboard.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting
                ? t('segmenter.dashboard.deleting')
                : t('segmenter.dashboard.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SegmenterDashboard;
