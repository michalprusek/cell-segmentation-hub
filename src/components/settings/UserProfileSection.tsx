import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useLanguage } from '@/contexts/useLanguage';
import { Profile, getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';

interface UserProfileSectionProps {
  userId: string;
  profile: Profile | null;
}

const UserProfileSection = ({ userId, profile }: UserProfileSectionProps) => {
  const { t } = useLanguage();

  const [formData, setFormData] = useState({
    fullName: profile?.username || '',
    organization: profile?.organization || '',
    bio: profile?.bio || '',
  });
  const [loading, setLoading] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    setLoading(true);
    try {
      await apiClient.updateUserProfile({
        username: formData.fullName,
        organization: formData.organization,
        bio: formData.bio,
      });

      toast.success(t('settings.profileUpdated'));
    } catch (error: unknown) {
      logger.error('Error saving profile:', error);
      const errorMessage =
        getErrorMessage(error, t) || t('errors.operations.updateProfile');
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSaveProfile}>
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">{t('settings.personal')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">{t('settings.fullName')}</Label>
              <Input
                id="fullName"
                value={formData.fullName}
                onChange={e =>
                  setFormData({ ...formData, fullName: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization">{t('settings.organization')}</Label>
              <Input
                id="organization"
                value={formData.organization}
                onChange={e =>
                  setFormData({ ...formData, organization: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">{t('settings.bio')}</h3>
          <div className="space-y-2">
            <Label htmlFor="bio">{t('settings.bio')}</Label>
            <Input
              id="bio"
              value={formData.bio}
              onChange={e => setFormData({ ...formData, bio: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={loading}>
            {loading ? t('settings.savingChanges') : t('settings.saveChanges')}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default UserProfileSection;
