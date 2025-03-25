
import React, { useEffect, useState } from 'react';
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
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import DashboardHeader from '@/components/DashboardHeader';

const Settings = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;

      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error fetching profile:', error);
        } else if (data) {
          setProfile(data);
        }
      } catch (error) {
        console.error('Unexpected error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user]);

  return (
    <motion.div 
      className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <DashboardHeader />
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
        
        {!loading && (
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="mb-8 grid w-full grid-cols-4">
              <TabsTrigger value="profile">{t('settings.profile')}</TabsTrigger>
              <TabsTrigger value="account">{t('settings.account')}</TabsTrigger>
              <TabsTrigger value="appearance">{t('settings.appearance')}</TabsTrigger>
              <TabsTrigger value="notifications">{t('settings.notifications')}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="profile">
              {user && profile && (
                <UserProfileSection userId={user.id} profile={profile} />
              )}
            </TabsContent>
            
            <TabsContent value="account">
              <AccountSection />
            </TabsContent>
            
            <TabsContent value="appearance">
              <AppearanceSection />
            </TabsContent>
            
            <TabsContent value="notifications">
              <NotificationSection />
            </TabsContent>
          </Tabs>
        )}
        
        {loading && (
          <div className="flex justify-center items-center h-64">
            <span className="text-gray-500">{t('common.loading')}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Settings;
