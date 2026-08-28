import React /* , { useState, useEffect } */ from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User as UserIcon,
  Settings as SettingsIcon,
  LogOut,
  LayoutDashboard,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/useAuth';
import { useLanguage } from '@/contexts/useLanguage';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
// import api from '@/lib/api';

interface UserProfileDropdownProps {
  username: string;
}

const UserProfileDropdown = ({ username }: UserProfileDropdownProps) => {
  const navigate = useNavigate();
  const { signOut, user: _user, profile } = useAuth();
  const { t } = useLanguage();

  // Use avatar from AuthContext profile (updated by refreshProfile)
  const avatarUrl = profile?.avatarUrl || null;

  const [isSigningOut, setIsSigningOut] = React.useState(false);

  // Radix closes the menu on select, so the only thing left on screen during
  // the sign-out round-trip was the header — nothing said the click landed.
  // `preventDefault` in the item keeps the menu open long enough to show it.
  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      toast.success(t('auth.successfulSignOut'));
    } catch (error) {
      logger.error('Error signing out:', error);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 dark:text-gray-300">
          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={username}
                className="w-full h-full object-cover"
              />
            ) : (
              // The avatar circle is `bg-gray-200` in both themes, so this
              // icon must stay dark in dark mode — it would otherwise pick up
              // the global `.dark .text-gray-600 → gray-400` rule and drop to
              // ~2:1 against its own light background.
              <UserIcon className="h-3 w-3 text-gray-600 dark:text-gray-600" />
            )}
          </div>
          {/* `username` is the local part of the e-mail, so a long address
              stretched the whole header at 768-900px. Truncate instead. */}
          <span className="max-w-[10rem] truncate text-sm">{username}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="dark:bg-gray-800 dark:border-gray-700"
      >
        <DropdownMenuItem
          onClick={() => navigate('/profile')}
          className="dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <UserIcon className="mr-2 h-4 w-4" />
          <span>{t('common.profile')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate('/settings')}
          className="dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <SettingsIcon className="mr-2 h-4 w-4" />
          <span>{t('common.settings')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate('/dashboard')}
          className="dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <LayoutDashboard className="mr-2 h-4 w-4" />
          <span>{t('common.dashboard')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate('/automated-essays')}
          className="dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <FlaskConical className="mr-2 h-4 w-4" />
          <span>{t('automatedEssays.navLabel')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="dark:bg-gray-700" />
        <DropdownMenuItem
          onSelect={e => {
            e.preventDefault();
            void handleSignOut();
          }}
          disabled={isSigningOut}
          className="dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {isSigningOut ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          <span>{t('common.logOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserProfileDropdown;
