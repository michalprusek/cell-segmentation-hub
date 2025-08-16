import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NotificationsDropdownProps {
  hasNotifications: boolean;
}

const NotificationsDropdown = ({
  hasNotifications,
}: NotificationsDropdownProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative dark:text-gray-300"
      onClick={() => {
        if (location.pathname !== '/settings') {
          navigate('/settings?tab=notifications');
        }
      }}
    >
      <Bell className="h-5 w-5" />
      {hasNotifications && (
        <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red-500"></span>
      )}
    </Button>
  );
};

export default NotificationsDropdown;
