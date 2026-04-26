import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ChevronUp,
  ChevronDown,
  X,
  CheckCircle2,
  Loader2,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useUpload } from '@/contexts/useUpload';
import { useLanguage } from '@/contexts/useLanguage';

const FloatingUploadProgress: React.FC = () => {
  const { activeSession, sessions, cancelUpload, clearSession } = useUpload();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [visibleSessionId, setVisibleSessionId] = useState<string | null>(null);

  // Track which session to display (active or most recent completed)
  const displaySession =
    activeSession ?? (visibleSessionId ? sessions[visibleSessionId] : null);

  // When a new upload starts, show it
  useEffect(() => {
    if (activeSession) {
      setVisibleSessionId(activeSession.id);
      setExpanded(false);
    }
    // Only react to id change to avoid retriggering on object identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id]);

  // Auto-collapse completed sessions after 8 seconds
  useEffect(() => {
    if (!displaySession) return;
    if (
      displaySession.status === 'completed' ||
      displaySession.status === 'failed' ||
      displaySession.status === 'cancelled'
    ) {
      setExpanded(false);
      const timer = setTimeout(() => {
        setVisibleSessionId(null);
        clearSession(displaySession.id);
      }, 8000);
      return () => clearTimeout(timer);
    }
    // displaySession is derived from activeSession + sessions; tracking id+status is sufficient
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySession?.status, displaySession?.id, clearSession]);

  const status = displaySession?.status;
  const totalFiles = displaySession?.totalFiles ?? 0;
  const successCount = displaySession?.successCount ?? 0;
  const failedCount = displaySession?.failedCount ?? 0;

  const statusIcon = useMemo(() => {
    if (!status) return null;
    switch (status) {
      case 'uploading':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  }, [status]);

  const statusLabel = useMemo(() => {
    if (!status) return '';
    switch (status) {
      case 'uploading':
        return t('images.upload.uploading', {
          success: successCount,
          total: totalFiles,
        });
      case 'completed':
        return failedCount > 0
          ? t('images.upload.completedWithFailures', {
              success: successCount,
              failed: failedCount,
            })
          : t('images.upload.completed', { count: successCount });
      case 'failed':
        return t('images.upload.failed');
      case 'cancelled':
        return t('images.upload.cancelled');
      default:
        return '';
    }
  }, [status, successCount, totalFiles, failedCount, t]);

  if (!displaySession) return null;

  const {
    overallProgress,
    projectId,
    projectName,
    chunkProgress,
    currentOperation,
    startedAt,
  } = displaySession;

  // Estimate remaining time
  const elapsed = (Date.now() - startedAt) / 1000;
  const estimatedTotal =
    overallProgress > 5 ? elapsed / (overallProgress / 100) : 0;
  const remaining = Math.max(0, estimatedTotal - elapsed);
  const remainingTime =
    remaining > 60
      ? `${Math.ceil(remaining / 60)}m ${Math.round(remaining % 60)}s`
      : remaining > 0
        ? `${Math.round(remaining)}s`
        : '';
  const remainingText = remainingTime
    ? t('images.upload.remaining', { time: remainingTime })
    : '';

  const handleClose = () => {
    setVisibleSessionId(null);
    if (displaySession.status !== 'uploading') {
      clearSession(displaySession.id);
    }
  };

  const handleViewProject = () => {
    navigate(`/project/${projectId}`);
    handleClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        key={displaySession.id}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-4 right-4 z-[99] w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden"
      >
        {/* Collapsed header — always visible */}
        <div
          className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-750"
          onClick={() => status === 'uploading' && setExpanded(e => !e)}
        >
          {statusIcon}
          <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {statusLabel}
          </span>

          {status === 'completed' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={e => {
                e.stopPropagation();
                handleViewProject();
              }}
            >
              {t('images.upload.view')}{' '}
              <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
          )}

          {status === 'uploading' && (
            <button
              onClick={e => {
                e.stopPropagation();
                setExpanded(e2 => !e2);
              }}
              className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
          )}

          <button
            onClick={e => {
              e.stopPropagation();
              handleClose();
            }}
            className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress bar — shown when uploading */}
        {status === 'uploading' && (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2">
              <Progress value={overallProgress} className="h-1.5 flex-1" />
              <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-8 text-right">
                {Math.round(overallProgress)}%
              </span>
            </div>
          </div>
        )}

        {/* Expanded details */}
        <AnimatePresence>
          {expanded && status === 'uploading' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700 pt-2">
                {projectName && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium">
                      {t('images.upload.project')}
                    </span>{' '}
                    {projectName}
                  </div>
                )}

                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('images.upload.filesProgress', {
                    success: successCount,
                    total: totalFiles,
                    percent: Math.round(overallProgress),
                  })}
                </div>

                {chunkProgress && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('images.upload.chunkProgress', {
                      current: chunkProgress.chunkIndex + 1,
                      total: chunkProgress.totalChunks,
                    })}
                    {remainingText && ` \u00B7 ${remainingText}`}
                  </div>
                )}

                {!chunkProgress && remainingText && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {remainingText}
                  </div>
                )}

                {currentOperation && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    {currentOperation}
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => cancelUpload(displaySession.id)}
                >
                  {t('images.upload.cancelButton')}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};

export default React.memo(FloatingUploadProgress);
