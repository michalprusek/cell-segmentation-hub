
import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import Logo from "@/components/header/Logo";
import UserProfileDropdown from "@/components/header/UserProfileDropdown";
import MobileMenu from "@/components/header/MobileMenu";

const DashboardHeader = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  // Skrýt header v segmentačním editoru
  const isSegmentationEditor = location.pathname.includes('/segmentation/');

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
          <UserProfileDropdown username={user?.email?.split('@')[0] || 'User'} />
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
