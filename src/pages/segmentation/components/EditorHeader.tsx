import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Home,
  FolderOpen,
  Image as ImageIcon,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import SegmentationStatusIndicator from './SegmentationStatusIndicator';
import type {
  SegmentationUpdate,
  QueueStats,
} from '@/hooks/useSegmentationQueue';

interface EditorHeaderProps {
  projectId: string;
  projectTitle: string;
  imageName: string;
  currentImageIndex: number;
  totalImages: number;
  onNavigate: (direction: 'prev' | 'next') => void;
  hasUnsavedChanges?: boolean;
  onSave?: () => Promise<void>;
  imageId?: string;
  segmentationStatus?: string;
  lastUpdate?: SegmentationUpdate | null;
  queueStats?: QueueStats | null;
  isWebSocketConnected?: boolean;
}

const EditorHeader = ({
  projectId,
  projectTitle,
  imageName,
  currentImageIndex,
  totalImages,
  onNavigate,
  hasUnsavedChanges = false,
  onSave,
  imageId,
  segmentationStatus,
  lastUpdate,
  queueStats,
  isWebSocketConnected = false,
}: EditorHeaderProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleBackClick = async () => {
    // Autosave before leaving the editor
    if (hasUnsavedChanges && onSave) {
      try {
        await onSave();
      } catch (error) {
        console.error('Failed to autosave before navigation:', error);
        // Continue navigation even if save fails
      }
    }
    navigate(`/project/${projectId}`);
  };

  const handleHomeClick = async () => {
    // Autosave before leaving the editor
    if (hasUnsavedChanges && onSave) {
      try {
        await onSave();
      } catch (error) {
        console.error('Failed to autosave before navigation:', error);
        // Continue navigation even if save fails
      }
    }
    navigate('/dashboard');
  };

  return (
    <motion.header
      className="w-full h-12 px-6 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between z-20 shadow-sm"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Left section - Breadcrumb Navigation */}
      <div className="flex items-center space-x-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60"
          onClick={handleHomeClick}
        >
          <Home className="h-4 w-4" />
        </Button>

        <ChevronRight className="h-4 w-4 text-slate-400" />

        <Button
          variant="ghost"
          size="sm"
          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60 max-w-32 sm:max-w-48"
          onClick={handleBackClick}
        >
          <FolderOpen className="h-4 w-4 mr-2" />
          <span className="truncate text-sm font-medium">{projectTitle}</span>
        </Button>

        <ChevronRight className="h-4 w-4 text-slate-400" />

        <div className="flex items-center space-x-2">
          <ImageIcon className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate max-w-32 sm:max-w-48">
            {imageName}
          </span>
        </div>
      </div>

      {/* Right section - Navigation and Progress */}
      <div className="flex items-center space-x-4">
        {/* WebSocket Connection Status */}
        <div
          className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs ${
            isWebSocketConnected
              ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
              : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
          }`}
          title={
            isWebSocketConnected
              ? t('websocket.connected')
              : t('websocket.disconnected')
          }
        >
          {isWebSocketConnected ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">
            {isWebSocketConnected ? t('status.online') : t('status.offline')}
          </span>
        </div>

        {/* Segmentation Status Indicator */}
        {imageId && (
          <SegmentationStatusIndicator
            imageId={imageId}
            segmentationStatus={segmentationStatus}
            lastUpdate={lastUpdate}
            queuePosition={queueStats?.position}
          />
        )}

        {/* Progress indicator */}
        <div className="hidden md:flex items-center space-x-3">
          <div className="text-sm text-slate-600 dark:text-slate-300 flex items-center space-x-2">
            <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {currentImageIndex + 1}
            </span>
            <span className="text-slate-400">/</span>
            <span>{totalImages}</span>
          </div>

          {/* Progress bar */}
          <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
              style={{
                width: `${((currentImageIndex + 1) / totalImages) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('prev')}
            disabled={currentImageIndex <= 0}
            className="h-9 bg-white/60 dark:bg-slate-800/60 border-white/40 dark:border-slate-600/40 hover:bg-white dark:hover:bg-slate-700"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">{t('common.back')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('next')}
            disabled={currentImageIndex >= totalImages - 1}
            className="h-9 bg-white/60 dark:bg-slate-800/60 border-white/40 dark:border-slate-600/40 hover:bg-white dark:hover:bg-slate-700"
          >
            <span className="hidden sm:inline">{t('common.next')}</span>
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </motion.header>
  );
};

export default EditorHeader;
