import React from 'react';
import { Languages, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/exports';
import type { Language } from '@/contexts/exports';

const LanguageSwitcher = () => {
  const { language, setLanguage, t } = useLanguage();

  const languageOptions = [
    { value: 'en' as Language, name: 'English', flag: '🇺🇸' },
    { value: 'cs' as Language, name: 'Čeština', flag: '🇨🇿' },
    { value: 'de' as Language, name: 'Deutsch', flag: '🇩🇪' },
    { value: 'es' as Language, name: 'Español', flag: '🇪🇸' },
    { value: 'fr' as Language, name: 'Français', flag: '🇫🇷' },
    { value: 'zh' as Language, name: '中文', flag: '🇨🇳' },
  ];

  const currentLanguage = languageOptions.find(
    option => option.value === language
  );

  const handleLanguageChange = async (newLanguage: Language) => {
    await setLanguage(newLanguage);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-700 hover:text-blue-500 hover:bg-gray-100/50 transition-colors"
          aria-label={t('accessibility.selectLanguage')}
        >
          <Languages className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        {languageOptions.map(option => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => handleLanguageChange(option.value)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span>{option.flag}</span>
              <span>{option.name}</span>
            </div>
            {language === option.value && (
              <Check className="h-4 w-4 text-blue-600" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default LanguageSwitcher;
