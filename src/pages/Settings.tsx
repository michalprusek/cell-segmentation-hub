
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import AccountSection from '@/components/settings/AccountSection';
import NotificationSection from '@/components/settings/NotificationSection';
import AppearanceSection from '@/components/settings/AppearanceSection';
import UserProfileSection from '@/components/settings/UserProfileSection';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';

const Settings = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <motion.div 
      className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="mr-4"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('common.back')}
          </Button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('settings.pageTitle')}</h1>
        </div>
        
        <Tabs defaultValue="account" className="w-full">
          <TabsList className="mb-8 grid w-full grid-cols-4">
            <TabsTrigger value="account">{t('settings.account')}</TabsTrigger>
            <TabsTrigger value="appearance">{t('settings.appearance')}</TabsTrigger>
            <TabsTrigger value="profile">{t('settings.profile')}</TabsTrigger>
            <TabsTrigger value="notifications">{t('settings.notifications')}</TabsTrigger>
          </TabsList>
          
          <TabsContent value="account">
            <AccountSection />
          </TabsContent>
          
          <TabsContent value="appearance">
            <AppearanceSection />
          </TabsContent>
          
          <TabsContent value="profile">
            <UserProfileSection />
          </TabsContent>
          
          <TabsContent value="notifications">
            <NotificationSection />
          </TabsContent>
        </Tabs>
      </div>
    </motion.div>
  );
};

export default Settings;
