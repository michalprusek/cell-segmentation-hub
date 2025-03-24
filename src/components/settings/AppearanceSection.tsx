
import React, { useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme, Theme } from "@/contexts/ThemeContext";
import { useLanguage, languageNames, Language } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { updateUserProfile } from "@/lib/supabase";

interface AppearanceSectionProps {
  userId: string;
  profile: any;
}

const AppearanceSection = ({ userId, profile }: AppearanceSectionProps) => {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [loading, setLoading] = useState(false);

  const handleSavePreferences = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      await updateUserProfile(userId, {
        preferred_language: language,
        preferred_theme: theme,
        updated_at: new Date()
      });
      
      toast.success(t('settings.preferencesUpdated'));
    } catch (error) {
      console.error("Error saving preferences:", error);
      toast.error(t('settings.preferencesUpdateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
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

      <div className="flex justify-end">
        <Button onClick={handleSavePreferences} disabled={loading}>
          {loading ? t('settings.savingChanges') : t('settings.saveChanges')}
        </Button>
      </div>
    </div>
  );
};

export default AppearanceSection;
