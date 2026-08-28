import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Settings as SettingsIcon,
  User as UserIcon,
  LogOut,
  X,
  LayoutDashboard,
  Loader2,
} from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/useAuth';
import { useLanguage } from '@/contexts/useLanguage';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

interface MobileMenuProps {
  isMenuOpen: boolean;
  setIsMenuOpen: (isOpen: boolean) => void;
  hasNotifications: boolean;
}

const MobileMenu = ({
  isMenuOpen,
  setIsMenuOpen,
  hasNotifications,
}: MobileMenuProps) => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { t } = useLanguage();

  const [isSigningOut, setIsSigningOut] = React.useState(false);

  // Sign-out is the one menu item that does not navigate, so without a pending
  // state the sheet just sat there after the tap with nothing happening. The
  // row now spins and disables while the request is in flight, closes the
  // sheet on success, and — where it previously only wrote to the logger —
  // says so when it fails, leaving the sheet open so the user can retry.
  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      setIsMenuOpen(false);
      toast.success(t('auth.successfulSignOut'));
    } catch (error) {
      logger.error('Error signing out:', error);
      toast.error(t('auth.signOutFailed'));
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    // BUG FIX: this used to render a `SheetTrigger` wrapping a Button whose
    // only child was an `sr-only` span — no icon. DashboardHeader already
    // renders its own Menu button and drives `isMenuOpen` by state, so the
    // trigger was redundant *and* painted an empty 40×40 ghost box beside the
    // real hamburger, eating 40px of a 328px mobile header. The Sheet is fully
    // controlled; it needs no trigger at all.
    <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
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
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:bg-gray-800 dark:bg-gray-800"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/profile');
            }}
          >
            <UserIcon className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.profile')}</span>
          </button>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:bg-gray-800 dark:bg-gray-800"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/settings');
            }}
          >
            <SettingsIcon className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.settings')}</span>
          </button>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:bg-gray-800 dark:bg-gray-800"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/dashboard');
            }}
          >
            <LayoutDashboard className="h-5 w-5 mr-3 text-gray-500" />
            <span>{t('common.dashboard')}</span>
          </button>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:bg-gray-800 dark:bg-gray-800"
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
            className="flex w-full items-center px-4 py-3 text-red-500 transition-colors hover:bg-gray-100 disabled:opacity-60 dark:bg-gray-800 dark:hover:bg-gray-700"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? (
              <Loader2 className="mr-3 h-5 w-5 animate-spin" />
            ) : (
              <LogOut className="mr-3 h-5 w-5" />
            )}
            <span>{t('common.logOut')}</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileMenu;
