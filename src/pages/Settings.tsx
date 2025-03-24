
import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import DashboardHeader from "@/components/DashboardHeader";
import { Skeleton } from "@/components/ui/skeleton";
import UserProfileSection from "@/components/settings/UserProfileSection";
import NotificationSection from "@/components/settings/NotificationSection";
import AccountSection from "@/components/settings/AccountSection";
import AppearanceSection from "@/components/settings/AppearanceSection";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";

const Settings = () => {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState("profile");

  // Načtení preferovaného jazyka a motivu při prvním načtení
  useEffect(() => {
    const loadUserPreferences = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("preferred_language, preferred_theme")
          .eq("id", user.id)
          .single();
          
        if (error) throw error;
        
        if (data) {
          // Aplikování uložených předvoleb - toto je pouze informativní,
          // faktická změna se provede v individuálních komponentách
          console.log("Loaded user preferences:", data);
        }
      } catch (error) {
        console.error("Error loading user preferences:", error);
      }
    };
    
    loadUserPreferences();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <Skeleton className="h-8 w-32 mb-1" />
            <Skeleton className="h-4 w-64" />
          </div>
          
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <Skeleton className="h-8 w-64" />
            </div>
            
            <div className="p-6">
              <div className="space-y-6">
                <div className="space-y-4">
                  <Skeleton className="h-6 w-48" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                </div>
                
                <Separator />
                
                <div className="space-y-4">
                  <Skeleton className="h-6 w-36" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-12 w-72" />
                </div>
                
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-32" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <DashboardHeader />
      
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1 dark:text-white">{t('common.settings')}</h1>
          <p className="text-gray-500 dark:text-gray-400">{t('settings.manageSettings')}</p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <Tabs defaultValue={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <TabsList className="grid w-full md:w-auto grid-cols-4 md:inline-flex h-9">
                <TabsTrigger value="profile">{t('common.profile')}</TabsTrigger>
                <TabsTrigger value="notifications">{t('common.notifications')}</TabsTrigger>
                <TabsTrigger value="account">{t('common.account')}</TabsTrigger>
                <TabsTrigger value="appearance">{t('settings.appearance')}</TabsTrigger>
              </TabsList>
            </div>
            
            <div className="p-6">
              <TabsContent value="profile" className="mt-0">
                {user && <UserProfileSection userId={user.id} profile={profile} />}
              </TabsContent>
              
              <TabsContent value="notifications" className="mt-0">
                <NotificationSection />
              </TabsContent>
              
              <TabsContent value="account" className="mt-0">
                <AccountSection />
              </TabsContent>
              
              <TabsContent value="appearance" className="mt-0">
                {user && <AppearanceSection userId={user.id} profile={profile} />}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Settings;
