import React, { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useLanguage } from '@/contexts/useLanguage';
import { Profile, getErrorMessage } from '@/types';
import { Info } from 'lucide-react';
import { logger } from '@/lib/logger';

interface ConsentSectionProps {
  userId: string;
  profile: Profile | null;
}

const ConsentSection = ({ userId, profile }: ConsentSectionProps) => {
  const { t } = useLanguage();

  const [consents, setConsents] = useState({
    consentToMLTraining: profile?.consentToMLTraining || false,
    consentToAlgorithmImprovement:
      profile?.consentToAlgorithmImprovement || false,
    consentToFeatureDevelopment: profile?.consentToFeatureDevelopment || false,
  });
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (profile) {
      setConsents({
        consentToMLTraining: profile.consentToMLTraining || false,
        consentToAlgorithmImprovement:
          profile.consentToAlgorithmImprovement || false,
        consentToFeatureDevelopment:
          profile.consentToFeatureDevelopment || false,
      });
    }
  }, [profile]);

  const handleConsentChange = (
    field: keyof typeof consents,
    value: boolean
  ) => {
    setConsents(prev => {
      const newConsents = { ...prev, [field]: value };

      // If disabling ML training, disable sub-options
      if (field === 'consentToMLTraining' && !value) {
        newConsents.consentToAlgorithmImprovement = false;
        newConsents.consentToFeatureDevelopment = false;
      }

      // If enabling sub-options, ensure main consent is enabled
      if (
        (field === 'consentToAlgorithmImprovement' ||
          field === 'consentToFeatureDevelopment') &&
        value
      ) {
        newConsents.consentToMLTraining = true;
      }

      return newConsents;
    });
    setHasChanges(true);
  };

  const handleSaveConsents = async () => {
    if (!userId) return;

    setLoading(true);
    try {
      await apiClient.updateUserProfile({
        ...consents,
        consentUpdatedAt: new Date().toISOString(),
      });

      toast.success(t('toast.profile.consentUpdated'));
      setHasChanges(false);
    } catch (error: unknown) {
      logger.error('Error saving consent preferences:', error);
      const errorMessage =
        getErrorMessage(error, t) || t('errors.operations.updateConsent');
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-xl">
          {t('settings.dataUsageTitle')}
        </CardTitle>
        <CardDescription>{t('settings.dataUsageDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 space-y-6">
        <div className="rounded-lg border p-4 bg-blue-50 dark:bg-blue-950/20">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm text-blue-900 dark:text-blue-200">
                {t('settings.consent.privacyNotice')}
              </p>
              <p className="text-sm text-blue-800 dark:text-blue-300">
                {t('settings.consent.dataUsageNote')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <Label htmlFor="ml-training" className="text-base font-medium">
                {t('settings.allowMLTraining.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.allowMLTraining.description')}
              </p>
            </div>
            <Switch
              id="ml-training"
              checked={consents.consentToMLTraining}
              onCheckedChange={checked =>
                handleConsentChange('consentToMLTraining', checked)
              }
            />
          </div>

          {consents.consentToMLTraining && (
            <div className="ml-6 space-y-4 pl-4 border-l-2">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <Label htmlFor="algorithm-improvement" className="text-sm">
                    {t('settings.consent.algorithmImprovement.label')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.consent.algorithmImprovement.description')}
                  </p>
                </div>
                <Switch
                  id="algorithm-improvement"
                  checked={consents.consentToAlgorithmImprovement}
                  onCheckedChange={checked =>
                    handleConsentChange(
                      'consentToAlgorithmImprovement',
                      checked
                    )
                  }
                />
              </div>

              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <Label htmlFor="feature-development" className="text-sm">
                    {t('settings.consent.featureDevelopment.label')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.consent.featureDevelopment.description')}
                  </p>
                </div>
                <Switch
                  id="feature-development"
                  checked={consents.consentToFeatureDevelopment}
                  onCheckedChange={checked =>
                    handleConsentChange('consentToFeatureDevelopment', checked)
                  }
                />
              </div>
            </div>
          )}
        </div>

        {profile?.consentUpdatedAt && (
          <p className="text-xs text-muted-foreground">
            {t('settings.consent.lastUpdated')}:{' '}
            {new Date(profile.consentUpdatedAt).toLocaleDateString()}
          </p>
        )}

        {hasChanges && (
          <Button
            onClick={handleSaveConsents}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading
              ? t('settings.consent.savingPreferences')
              : t('settings.consent.savePreferences')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default ConsentSection;
