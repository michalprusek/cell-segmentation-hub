
import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Moon, Sun, MonitorSmartphone, Languages } from 'lucide-react';

const AppearanceSection = () => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();

  const languageOptions = [
    { value: 'en', name: 'English' },
    { value: 'cs', name: 'Čeština' },
    { value: 'de', name: 'Deutsch' },
    { value: 'es', name: 'Español' },
    { value: 'fr', name: 'Français' },
    { value: 'zh', name: '中文' },
  ];

  const handleLanguageChange = (value: string) => {
    setLanguage(value as any);
    toast.success(t('settings.languageUpdated'));
  };

  const handleThemeChange = (value: string) => {
    setTheme(value as any);
    toast.success(t('settings.themeUpdated'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance')}</CardTitle>
        <CardDescription>
          {t('settings.appearanceDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="language">{t('settings.language')}</Label>
              <p className="text-sm text-muted-foreground mt-1">
                {t('settings.languageDescription')}
              </p>
            </div>
            <div className="w-[180px]">
              <Select value={language} onValueChange={handleLanguageChange}>
                <SelectTrigger className="w-full">
                  <div className="flex items-center gap-2">
                    <Languages className="h-4 w-4" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="theme">{t('settings.theme')}</Label>
              <p className="text-sm text-muted-foreground mt-1">
                {t('settings.themeDescription')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                className="w-24"
                onClick={() => handleThemeChange('light')}
              >
                <Sun className="h-4 w-4 mr-2" />
                {t('settings.light')}
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                className="w-24"
                onClick={() => handleThemeChange('dark')}
              >
                <Moon className="h-4 w-4 mr-2" />
                {t('settings.dark')}
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                size="sm"
                className="w-24"
                onClick={() => handleThemeChange('system')}
              >
                <MonitorSmartphone className="h-4 w-4 mr-2" />
                {t('settings.system')}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AppearanceSection;
