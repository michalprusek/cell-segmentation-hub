
import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DashboardHeader from "@/components/DashboardHeader";
import { Skeleton } from "@/components/ui/skeleton";
import UserProfileSection from "@/components/settings/UserProfileSection";
import NotificationSection from "@/components/settings/NotificationSection";
import AccountSection from "@/components/settings/AccountSection";
import { useTheme, Theme } from "@/contexts/ThemeContext"; // Import Theme type from ThemeContext
import { useLanguage, languageNames, Language } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Monitor, Moon, Sun } from "lucide-react";

const Settings = () => {
  const { user, profile, loading } = useAuth();
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  
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
          <Tabs defaultValue="profile" className="w-full">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <TabsList className="grid w-full md:w-auto grid-cols-5 md:inline-flex h-9">
                <TabsTrigger value="profile">{t('common.profile')}</TabsTrigger>
                <TabsTrigger value="notifications">{t('common.notifications')}</TabsTrigger>
                <TabsTrigger value="account">{t('common.account')}</TabsTrigger>
                <TabsTrigger value="appearance">{t('settings.appearance')}</TabsTrigger>
                <TabsTrigger value="language">{t('common.language')}</TabsTrigger>
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
              
              <TabsContent value="appearance" className="mt-0 space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-4 dark:text-white">{t('settings.themeSettings')}</h3>
                  <RadioGroup 
                    defaultValue={theme} 
                    className="grid grid-cols-3 gap-4"
                    onValueChange={(value) => setTheme(value as Theme)}
                  >
                    <div>
                      <RadioGroupItem 
                        value="light" 
                        id="theme-light" 
                        className="peer sr-only" 
                      />
                      <Label
                        htmlFor="theme-light"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                      >
                        <Sun className="mb-3 h-6 w-6" />
                        <span>{t('common.light')}</span>
                      </Label>
                    </div>
                    
                    <div>
                      <RadioGroupItem 
                        value="dark" 
                        id="theme-dark" 
                        className="peer sr-only" 
                      />
                      <Label
                        htmlFor="theme-dark"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                      >
                        <Moon className="mb-3 h-6 w-6" />
                        <span>{t('common.dark')}</span>
                      </Label>
                    </div>
                    
                    <div>
                      <RadioGroupItem 
                        value="system" 
                        id="theme-system" 
                        className="peer sr-only" 
                      />
                      <Label
                        htmlFor="theme-system"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                      >
                        <Monitor className="mb-3 h-6 w-6" />
                        <span>{t('common.system')}</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </TabsContent>
              
              <TabsContent value="language" className="mt-0 space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-4 dark:text-white">{t('settings.languageSettings')}</h3>
                  <div className="max-w-md">
                    <Select 
                      defaultValue={language} 
                      onValueChange={(value) => setLanguage(value as Language)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('settings.selectLanguage')} />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(languageNames).map(([code, name]) => (
                          <SelectItem key={code} value={code}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Settings;
