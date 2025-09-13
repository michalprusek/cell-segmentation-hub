import React from 'react';
import { Sun, Moon, MonitorSmartphone, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useTheme, useLanguage, type Theme } from '@/contexts/exports';
import { logger } from '@/lib/logger';

const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();

  const themeOptions = [
    {
      value: 'light' as Theme,
      name: 'Light',
      icon: Sun,
    },
    {
      value: 'dark' as Theme,
      name: 'Dark',
      icon: Moon,
    },
    {
      value: 'system' as Theme,
      name: 'System',
      icon: MonitorSmartphone,
    },
  ];

  const getCurrentThemeIcon = () => {
    switch (theme) {
      case 'light':
        return Sun;
      case 'dark':
        return Moon;
      case 'system':
        return MonitorSmartphone;
      default:
        return MonitorSmartphone;
    }
  };

  const handleThemeChange = async (newTheme: Theme) => {
    try {
      await setTheme(newTheme);
    } catch (error) {
      // Silently handle theme change errors
      logger.warn('Failed to change theme', error);
    }
  };

  const CurrentIcon = getCurrentThemeIcon();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-700 hover:text-blue-500 hover:bg-gray-100/50 transition-colors"
          aria-label={t('accessibility.selectTheme')}
        >
          <CurrentIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[140px]">
        {themeOptions.map(option => {
          const IconComponent = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => handleThemeChange(option.value)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <IconComponent className="h-4 w-4" />
                <span>{option.name}</span>
              </div>
              {theme === option.value && (
                <Check className="h-4 w-4 text-blue-600" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ThemeSwitcher;
