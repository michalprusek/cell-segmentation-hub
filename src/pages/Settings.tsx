
import React, { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import AccountSection from '@/components/settings/AccountSection';
import AppearanceSection from '@/components/settings/AppearanceSection';
import UserProfileSection from '@/components/settings/UserProfileSection';
import ModelSettingsSection from '@/components/settings/ModelSettingsSection';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import apiClient from '@/lib/api';
import { Profile } from '@/types';
// Note: Settings functionality now uses AuthContext and API client
import DashboardHeader from '@/components/DashboardHeader';

const Settings = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Get tab from URL parameter, default to 'profile'
  const activeTab = searchParams.get('tab') || 'profile';

  // Handle tab change
  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;

      try {
        setLoading(true);
        // Fetch actual profile data from API
        const profileData = await apiClient.getUserProfile();
        setProfile(profileData);
      } catch (error) {
        console.error('Error fetching profile:', error);
        // If profile fetch fails, use basic user data
        setProfile({
          id: user.id,
          email: user.email,
          username: user.username || '',
          organization: '',
          bio: '',
          public_profile: false,
          consentToMLTraining: false,
          consentToAlgorithmImprovement: false,
          consentToFeatureDevelopment: false,
          consentUpdatedAt: undefined
        });
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
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mb-8 grid w-full grid-cols-4">
              <TabsTrigger value="profile">{t('settings.profile')}</TabsTrigger>
              <TabsTrigger value="account">{t('settings.account')}</TabsTrigger>
              <TabsTrigger value="appearance">{t('settings.appearance')}</TabsTrigger>
              <TabsTrigger value="models">{t('settings.models')}</TabsTrigger>
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
            
            <TabsContent value="models">
              <ModelSettingsSection />
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
