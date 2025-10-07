import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Bell,
  Settings as SettingsIcon,
  User as UserIcon,
  LogOut,
  X,
  LayoutDashboard,
  BookOpen,
  Cpu,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/useAuth';
import { useLanguage } from '@/contexts/useLanguage';
import { useLocalizedModels } from '@/hooks/useLocalizedModels';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

interface MobileMenuProps {
  isMenuOpen: boolean;
  setIsMenuOpen: (isOpen: boolean) => void;
  hasNotifications: boolean;
  mlServiceStatus?: 'idle' | 'processing' | 'error';
  isConnected?: boolean;
}

const MobileMenu = ({
  isMenuOpen,
  setIsMenuOpen,
  hasNotifications,
  mlServiceStatus = 'idle',
  isConnected = true,
}: MobileMenuProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const { t } = useLanguage();
  const { getSelectedModelInfo } = useLocalizedModels();

  // Determine current page for back navigation
  const getCurrentPageInfo = () => {
    const path = location.pathname;
    if (path === '/dashboard') {
      return { name: t('common.dashboard'), path: '/dashboard' };
    } else if (path === '/settings') {
      return { name: t('common.settings'), path: '/settings' };
    } else if (path === '/profile') {
      return { name: t('common.profile'), path: '/profile' };
    } else if (path.startsWith('/project/')) {
      return { name: t('common.project'), path };
    }
    return null;
  };

  const currentPageInfo = getCurrentPageInfo();

  // Determine status dot color for model badge
  const getStatusColor = () => {
    if (!isConnected || mlServiceStatus === 'error') {
      return 'bg-red-500'; // Red - error or disconnected
    }
    if (mlServiceStatus === 'processing') {
      return 'bg-blue-500'; // Blue - processing
    }
    return 'bg-green-500'; // Green - idle and available
  };

  const getStatusTooltip = () => {
    if (!isConnected) return t('status.disconnected');
    if (mlServiceStatus === 'error') return t('status.error');
    if (mlServiceStatus === 'processing') return t('status.processing');
    return t('status.ready');
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success(t('auth.successfulSignOut'));
    } catch (error) {
      logger.error('Error signing out:', error);
    }
  };

  return (
    <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="dark:text-gray-300">
          <span className="sr-only">{t('common.openMenu')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="p-0 dark:bg-gray-800">
        <div className="p-4 border-b dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-md bg-blue-500 flex items-center justify-center">
                <span className="text-white font-bold">S</span>
              </div>
              <span className="ml-2 font-semibold dark:text-white">
                SpheroSeg
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMenuOpen(false)}
              className="dark:text-gray-300"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <div className="py-2">
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/dashboard');
            }}
          >
            <LayoutDashboard className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.dashboard')}</span>
          </button>

          {/* Documentation Link */}
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/documentation', {
                state: currentPageInfo
                  ? {
                      from: currentPageInfo.name,
                      path: currentPageInfo.path,
                    }
                  : undefined,
              });
            }}
          >
            <BookOpen className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.documentation', 'Documentation')}</span>
          </button>

          {/* Current Model Selection */}
          <button
            className="flex items-center justify-between w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/settings?tab=models');
            }}
            title={getStatusTooltip()}
          >
            <div className="flex items-center">
              <Cpu className="h-5 w-5 mr-3 text-gray-500" />
              <span>{t('settings.model', 'Model')}</span>
            </div>
            <Badge
              variant="secondary"
              className="flex items-center gap-2 text-xs"
            >
              <div
                className={`w-2 h-2 ${getStatusColor()} rounded-full animate-pulse`}
              ></div>
              {getSelectedModelInfo().displayName}
            </Badge>
          </button>

          <div className="border-t my-2 dark:border-gray-700"></div>

          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/profile');
            }}
          >
            <UserIcon className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.profile')}</span>
          </button>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/settings');
            }}
          >
            <SettingsIcon className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.settings')}</span>
          </button>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/settings?tab=notifications');
            }}
          >
            <Bell className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.notifications')}</span>
            {hasNotifications && (
              <span className="ml-2 h-2 w-2 rounded-full bg-red-500"></span>
            )}
          </button>
          <div className="border-t my-2 dark:border-gray-700"></div>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500"
            onClick={handleSignOut}
          >
            <LogOut className="h-5 w-5 mr-3" />
            <span>{t('common.logOut')}</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileMenu;
