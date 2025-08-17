import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLocalizedModels } from '@/hooks/useLocalizedModels';
import { Badge } from '@/components/ui/badge';
import Logo from '@/components/header/Logo';
import UserProfileDropdown from '@/components/header/UserProfileDropdown';
import MobileMenu from '@/components/header/MobileMenu';
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';
import api from '@/lib/api';
import { mlServiceUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { fetchWithRetry } from '@/lib/httpUtils';

const DashboardHeader = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [mlServiceStatus, setMlServiceStatus] = useState<
    'idle' | 'processing' | 'error'
  >('idle');
  const { user } = useAuth();
  const { selectedModel, getSelectedModelInfo } = useLocalizedModels();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Check if we're on a project detail page to avoid conflicts
  const isProjectDetailPage = location.pathname.includes('/project/');
  const { isConnected, queueStats } = useSegmentationQueue(
    isProjectDetailPage ? 'DISABLE_GLOBAL' : undefined
  );

  // Skrýt header v segmentačním editoru
  const isSegmentationEditor = location.pathname.includes('/segmentation/');

  // Fetch ML service status periodically
  useEffect(() => {
    const checkMlServiceStatus = async () => {
      try {
        const response = await fetchWithRetry(
          `${mlServiceUrl}/api/v1/status`,
          {},
          {
            retries: 2,
            delay: 500,
            backoff: 2,
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'processing') {
            setMlServiceStatus('processing');
          } else {
            setMlServiceStatus('idle');
          }
        } else {
          setMlServiceStatus('error');
        }
      } catch (error) {
        logger.warn('ML service status check failed:', error);
        setMlServiceStatus('error');
      }
    };

    // Check immediately and then every 5 seconds
    checkMlServiceStatus();
    const interval = setInterval(checkMlServiceStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  // Determine status dot color
  const getStatusColor = () => {
    if (!isConnected || mlServiceStatus === 'error') {
      return 'bg-red-500'; // Red - error or disconnected
    }
    if (
      mlServiceStatus === 'processing' ||
      (queueStats && queueStats.processing > 0)
    ) {
      return 'bg-blue-500'; // Blue - processing
    }
    return 'bg-green-500'; // Green - idle and available
  };

  const getStatusTooltip = () => {
    if (!isConnected) return t('status.disconnected');
    if (mlServiceStatus === 'error') return t('status.error');
    if (
      mlServiceStatus === 'processing' ||
      (queueStats && queueStats.processing > 0)
    ) {
      return t('status.processing', { count: queueStats?.processing || 0 });
    }
    return t('status.ready');
  };

  if (isSegmentationEditor) {
    return null;
  }

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center">
          <Logo />
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center space-x-4">
          {/* Documentation Link */}
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
            onClick={() => navigate('/documentation')}
          >
            <BookOpen className="h-4 w-4 mr-2" />
            {t('common.documentation', 'Documentation')}
          </Button>
          
          {/* Current Model Badge - Clickable */}
          <Badge
            variant="secondary"
            className="flex items-center gap-2 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            onClick={() => navigate('/settings?tab=models')}
            title={getStatusTooltip()}
          >
            <div
              className={`w-2 h-2 ${getStatusColor()} rounded-full animate-pulse`}
            ></div>
            {getSelectedModelInfo().displayName}
          </Badge>
          <UserProfileDropdown
            username={user?.email?.split('@')[0] || 'User'}
          />
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="dark:text-gray-300"
            onClick={() => setIsMenuOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </Button>
          <MobileMenu
            isMenuOpen={isMenuOpen}
            setIsMenuOpen={setIsMenuOpen}
            hasNotifications={false}
          />
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
