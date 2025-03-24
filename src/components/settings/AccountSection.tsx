
import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLanguage } from '@/contexts/LanguageContext';

const AccountSection = () => {
  const { t } = useLanguage();

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success(t('settings.profileUpdated'));
  };

  return (
    <form onSubmit={handleSaveAccount}>
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">{t('common.password')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">{t('settings.currentPassword')}</Label>
              <Input id="currentPassword" type="password" />
            </div>
            <div></div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t('settings.newPassword')}</Label>
              <Input id="newPassword" type="password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('settings.confirmNewPassword')}</Label>
              <Input id="confirmPassword" type="password" />
            </div>
          </div>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-red-600">{t('settings.dangerZone')}</h3>
          <div className="p-4 border border-red-200 bg-red-50 rounded-md">
            <h4 className="font-medium mb-2">{t('common.deleteAccount')}</h4>
            <p className="text-sm text-gray-700 mb-4">{t('settings.deleteAccountWarning')}</p>
            <Button variant="destructive">{t('common.deleteAccount')}</Button>
          </div>
        </div>
        
        <div className="flex justify-end">
          <Button type="submit">{t('settings.saveChanges')}</Button>
        </div>
      </div>
    </form>
  );
};

export default AccountSection;
