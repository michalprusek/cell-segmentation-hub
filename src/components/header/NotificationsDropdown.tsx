
import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Bell } from "lucide-react";
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent 
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface NotificationsDropdownProps {
  hasNotifications: boolean;
}

const NotificationsDropdown = ({ hasNotifications }: NotificationsDropdownProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative dark:text-gray-300"
          onClick={() => {
            if (location.pathname !== "/settings") {
              navigate("/settings?tab=notifications");
            }
          }}
        >
          <Bell className="h-5 w-5" />
          {hasNotifications && (
            <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red-500"></span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="p-4 text-center">
          <h3 className="font-medium">Notifications</h3>
          <p className="text-sm text-gray-500 mt-1">You have no new notifications</p>
          <Button 
            size="sm" 
            variant="outline" 
            className="mt-3 w-full"
            onClick={() => navigate("/settings?tab=notifications")}
          >
            View all notifications
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default NotificationsDropdown;
