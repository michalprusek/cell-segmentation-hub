
import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { 
  Bell, 
  Settings as SettingsIcon, 
  User as UserIcon,
  Menu,
  LogOut,
  X
} from "lucide-react";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

const DashboardHeader = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasNotifications, setHasNotifications] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Skrýt header v segmentačním editoru
  const isSegmentationEditor = location.pathname.includes('/segmentation/');

  useEffect(() => {
    // This would be where you'd check for actual notifications
    // For now, we'll set it to false since there are no notifications
    setHasNotifications(false);
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  if (isSegmentationEditor) {
    return null;
  }

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center">
          <Link to="/dashboard" className="flex items-center">
            <div className="w-9 h-9 rounded-md bg-blue-500 flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <span className="ml-2 text-xl font-semibold hidden sm:inline-block dark:text-white">
              SpheroSeg
            </span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center space-x-4">
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 dark:text-gray-300">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                  <UserIcon className="h-3 w-3 text-gray-600" />
                </div>
                <span className="text-sm">{user?.email?.split('@')[0] || 'User'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dark:bg-gray-800 dark:border-gray-700">
              <DropdownMenuItem onClick={() => navigate("/profile")} className="dark:text-gray-300 dark:hover:bg-gray-700">
                <UserIcon className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings")} className="dark:text-gray-300 dark:hover:bg-gray-700">
                <SettingsIcon className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="dark:bg-gray-700" />
              <DropdownMenuItem onClick={handleSignOut} className="dark:text-gray-300 dark:hover:bg-gray-700">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden">
          <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="dark:text-gray-300">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 dark:bg-gray-800">
              <div className="p-4 border-b dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-md bg-blue-500 flex items-center justify-center">
                      <span className="text-white font-bold">S</span>
                    </div>
                    <span className="ml-2 font-semibold dark:text-white">SpheroSeg</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setIsMenuOpen(false)} className="dark:text-gray-300">
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>
              <div className="py-2">
                <button 
                  className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  onClick={() => {
                    setIsMenuOpen(false);
                    navigate("/profile");
                  }}
                >
                  <UserIcon className="h-5 w-5 mr-3 text-gray-500" />
                  <span>Profile</span>
                </button>
                <button 
                  className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  onClick={() => {
                    setIsMenuOpen(false);
                    navigate("/settings");
                  }}
                >
                  <SettingsIcon className="h-5 w-5 mr-3 text-gray-500" />
                  <span>Settings</span>
                </button>
                <button 
                  className="flex items-center w-full px-4 py-3 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  onClick={() => {
                    setIsMenuOpen(false);
                    navigate("/settings?tab=notifications");
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
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
