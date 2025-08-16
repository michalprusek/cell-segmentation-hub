import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Settings as SettingsIcon,
  User as UserIcon,
  LogOut,
  X,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';

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

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      logger.error('Error signing out:', error);
    }
  };

  return (
    <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="dark:text-gray-300">
          <span className="sr-only">Open menu</span>
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
              navigate('/profile');
            }}
          >
            <UserIcon className="h-5 w-5 mr-3 text-gray-500" />
            <span>Profile</span>
          </button>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/settings');
            }}
          >
            <SettingsIcon className="h-5 w-5 mr-3 text-gray-500" />
            <span>Settings</span>
          </button>
          <button
            className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => {
              setIsMenuOpen(false);
              navigate('/settings?tab=notifications');
            }}
          >
            <Bell className="h-5 w-5 mr-3 text-gray-500" />
            <span>Notifications</span>
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
            <span>Log out</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileMenu;
