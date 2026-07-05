import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Loader2, Trash2, FileText, AlertCircle } from 'lucide-react';
import DashboardHeader from '@/components/DashboardHeader';
import { PageContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import EssaysDropzone from '@/components/essays/EssaysDropzone';
import { useLanguage } from '@/contexts/useLanguage';
import apiClient from '@/lib/api';
import type { EssayJob } from '@/types/essays';

const humanSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

// Best-effort folder name from a picked/dragged file's relative path.
const folderNameFromFiles = (files: File[]): string | undefined => {
  const rel = (files[0] as File & { webkitRelativePath?: string })
    ?.webkitRelativePath;
  if (rel && rel.includes('/')) return rel.split('/')[0];
  return undefined;
};

const statusVariant = (
  status: EssayJob['status']
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'completed':
      return 'default';
    case 'failed':
      return 'destructive';
    case 'running':
      return 'secondary';
    default:
      return 'outline';
  }
};

const AutomatedEssays: React.FC = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [staged, setStaged] = useState<File[]>([]);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const totalSize = useMemo(
    () => staged.reduce((s, f) => s + f.size, 0),
    [staged]
  );

  const { data: jobs = [] } = useQuery({
    queryKey: ['essay-jobs'],
    queryFn: () => apiClient.listEssayJobs(),
    // Poll while any job is active so status/progress stay live.
    refetchInterval: query => {
      const list = (query.state.data as EssayJob[] | undefined) ?? [];
      return list.some(j => j.status === 'queued' || j.status === 'running')
        ? 3000
        : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      setUploadPct(0);
      return apiClient.uploadEssays(staged, {
        folderName: folderNameFromFiles(staged),
        onUploadProgress: p => setUploadPct(p),
      });
    },
    onSuccess: () => {
      toast.success(t('automatedEssays.jobStarted'));
      setStaged([]);
      setUploadPct(null);
      queryClient.invalidateQueries({ queryKey: ['essay-jobs'] });
    },
    onError: (e: unknown) => {
      setUploadPct(null);
      toast.error(
        e instanceof Error ? e.message : t('automatedEssays.uploadFailed')
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => apiClient.deleteEssayJob(jobId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['essay-jobs'] }),
  });

  const handleDownload = async (job: EssayJob) => {
    try {
      const { token } = await apiClient.getEssayDownloadToken(job.id);
      const url = apiClient.buildEssayDownloadUrl(job.id, token);
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error(t('automatedEssays.downloadFailed'));
    }
  };

  const isUploading = uploadMutation.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <DashboardHeader />
      <PageContainer>
        <div className="max-w-4xl mx-auto space-y-6 py-6">
          <div>
            <h1 className="text-2xl font-bold dark:text-white">
              {t('automatedEssays.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('automatedEssays.subtitle')}
            </p>
          </div>

          <Card className="p-6 space-y-4">
            <EssaysDropzone disabled={isUploading} onFiles={setStaged} />

            {staged.length > 0 && (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  {t('automatedEssays.filesSelected', {
                    count: staged.length,
                  })}{' '}
                  · {humanSize(totalSize)}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={isUploading}
                    onClick={() => setStaged([])}
                  >
                    {t('automatedEssays.clear')}
                  </Button>
                  <Button
                    disabled={isUploading}
                    onClick={() => uploadMutation.mutate()}
                  >
                    {isUploading && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {t('automatedEssays.uploadAndProcess')}
                  </Button>
                </div>
              </div>
            )}

            {uploadPct !== null && (
              <div className="space-y-1">
                <Progress value={uploadPct} />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('automatedEssays.uploading', { percent: uploadPct })}
                </p>
              </div>
            )}
          </Card>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold dark:text-white">
              {t('automatedEssays.yourRuns')}
            </h2>
            {jobs.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('automatedEssays.noRuns')}
              </p>
            )}
            {jobs.map(job => (
              <Card key={job.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="font-medium truncate dark:text-white">
                        {job.name}
                      </span>
                      <Badge variant={statusVariant(job.status)}>
                        {t(`automatedEssays.status.${job.status}`)}
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('automatedEssays.fileCount', { count: job.fileCount })}
                      {job.mtCount > 0 && (
                        <>
                          {' · '}
                          {t('automatedEssays.mtCount', { count: job.mtCount })}
                        </>
                      )}
                      {job.device && <> · {job.device.toUpperCase()}</>}
                    </div>
                    {(job.status === 'running' || job.status === 'queued') && (
                      <Progress value={job.progress} className="mt-2" />
                    )}
                    {job.status === 'failed' && job.error && (
                      <div className="flex items-center gap-1 text-xs text-red-500 mt-2">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span className="truncate">{job.error}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.status === 'completed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(job)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        {t('automatedEssays.download')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(job.id)}
                      aria-label={String(t('automatedEssays.delete'))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </PageContainer>
    </div>
  );
};

export default AutomatedEssays;
