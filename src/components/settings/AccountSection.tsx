import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useLanguage, useAuth } from '@/contexts/exports';
import apiClient from '@/lib/api';
import { getErrorMessage } from '@/types';
import { Check, X } from 'lucide-react';
import DeleteAccountDialog from './DeleteAccountDialog';
import { logger } from '@/lib/logger';

const AccountSection = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);

  // Real-time validation
  const passwordsMatch = useMemo(() => {
    if (!passwordData.newPassword || !passwordData.confirmPassword) return null;
    return passwordData.newPassword === passwordData.confirmPassword;
  }, [passwordData.newPassword, passwordData.confirmPassword]);

  const showPasswordMatchIndicator =
    passwordData.newPassword.length > 0 &&
    passwordData.confirmPassword.length > 0;

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validace
    if (
      !passwordData.currentPassword ||
      !passwordData.newPassword ||
      !passwordData.confirmPassword
    ) {
      toast.error(t('settings.fillAllFields') || 'Vyplňte všechna pole');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error(t('settings.passwordsDoNotMatch') || 'Hesla se neshodují');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error(
        t('settings.passwordTooShort') || 'Heslo musí mít alespoň 6 znaků'
      );
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.changePassword({
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });

      toast.success(
        t('settings.passwordChanged') || 'Heslo bylo úspěšně změněno'
      );

      // Vyčistit formulář
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error: unknown) {
      logger.error('Error changing password:', error);
      const errorMessage =
        getErrorMessage(error, t) || t('errors.operations.changePassword');
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSaveAccount}>
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">{t('common.password')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">
                {t('settings.currentPassword')}
              </Label>
              <Input
                id="currentPassword"
                type="password"
                value={passwordData.currentPassword}
                onChange={e =>
                  setPasswordData({
                    ...passwordData,
                    currentPassword: e.target.value,
                  })
                }
                disabled={isLoading}
              />
            </div>
            <div></div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t('settings.newPassword')}</Label>
              <Input
                id="newPassword"
                type="password"
                value={passwordData.newPassword}
                onChange={e =>
                  setPasswordData({
                    ...passwordData,
                    newPassword: e.target.value,
                  })
                }
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                {t('settings.confirmNewPassword')}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={passwordData.confirmPassword}
                onChange={e =>
                  setPasswordData({
                    ...passwordData,
                    confirmPassword: e.target.value,
                  })
                }
                disabled={isLoading}
                className={
                  showPasswordMatchIndicator
                    ? passwordsMatch
                      ? 'border-green-500'
                      : 'border-red-500'
                    : ''
                }
                aria-invalid={
                  showPasswordMatchIndicator ? !passwordsMatch : false
                }
                aria-describedby={
                  showPasswordMatchIndicator
                    ? 'password-match-status'
                    : undefined
                }
              />
              {showPasswordMatchIndicator && (
                <div
                  id="password-match-status"
                  role="status"
                  aria-live="polite"
                  className={`flex items-center gap-2 text-sm mt-1 ${passwordsMatch ? 'text-green-600' : 'text-red-600'}`}
                >
                  {passwordsMatch ? (
                    <>
                      <Check className="w-4 h-4" aria-hidden="true" />
                      <span>
                        {t('settings.passwordsMatch') || 'Hesla se shodují'}
                      </span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" aria-hidden="true" />
                      <span>
                        {t('settings.passwordsDoNotMatch') ||
                          'Hesla se neshodují'}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isLoading}>
            {isLoading
              ? t('settings.changingPassword') || 'Měním heslo...'
              : t('settings.changePassword') || 'Změnit heslo'}
          </Button>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium text-red-600 dark:text-red-400">
            {t('settings.dangerZone')}
          </h3>
          <div className="p-4 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-md">
            <h4 className="font-medium mb-2 text-gray-900 dark:text-red-100">
              {t('common.deleteAccount')}
            </h4>
            <p className="text-sm text-gray-700 dark:text-red-200 mb-4">
              {t('settings.deleteAccountWarning')}
            </p>
            <Button
              variant="destructive"
              onClick={() => setIsDeleteDialogOpen(true)}
              type="button"
            >
              {t('common.deleteAccount')}
            </Button>
          </div>
        </div>
      </div>

      <DeleteAccountDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        userEmail={user?.email || ''}
      />
    </form>
  );
};

export default AccountSection;
