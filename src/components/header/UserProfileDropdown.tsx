import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User as UserIcon,
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

interface UserProfileDropdownProps {
  username: string;
}

const UserProfileDropdown = ({ username }: UserProfileDropdownProps) => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { t } = useLanguage();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success(t('auth.successfulSignOut'));
    } catch (error) {
      logger.error('Error signing out:', error);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 dark:text-gray-300">
          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
            <UserIcon className="h-3 w-3 text-gray-600" />
          </div>
          <span className="text-sm">{username}</span>
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
        <DropdownMenuSeparator className="dark:bg-gray-700" />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('common.logOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserProfileDropdown;
