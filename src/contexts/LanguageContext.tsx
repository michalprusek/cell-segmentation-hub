
import React, { createContext, useContext, useState, useEffect } from 'react';

// Define supported languages
export type Language = 'en' | 'de' | 'fr' | 'es' | 'zh';

// Language names for display
export const languageNames = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  zh: '中文'
};

// Interface for the language context
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

// Create context with default values
const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key: string) => key,
});

// Import all translations
import en from '@/translations/en';
import de from '@/translations/de';
import fr from '@/translations/fr';
import es from '@/translations/es';
import zh from '@/translations/zh';

// Translations mapping
const translations = {
  en,
  de,
  fr,
  es,
  zh
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Try to get language from localStorage or use browser language or default to English
  const getBrowserLanguage = (): Language => {
    const browserLang = navigator.language.split('-')[0];
    return (browserLang as Language) in translations ? (browserLang as Language) : 'en';
  };

  const [language, setLanguageState] = useState<Language>(
    (localStorage.getItem('language') as Language) || getBrowserLanguage()
  );

  // Translation function
  const t = (key: string): string => {
    const keys = key.split('.');
    let value: any = translations[language];
    
    // Try to find the translation in the selected language
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        // If key not found or value is not an object, try fallback to English
        let fallbackValue: any = translations['en'];
        for (const fallbackKey of keys) {
          if (fallbackValue && typeof fallbackValue === 'object' && fallbackKey in fallbackValue) {
            fallbackValue = fallbackValue[fallbackKey];
          } else {
            return key; // Return the key itself if translation missing
          }
        }
        
        // If fallback found, use it
        if (typeof fallbackValue === 'string') {
          return fallbackValue;
        }
        return key; // Return the key itself if all fallbacks fail
      }
    }
    
    return typeof value === 'string' ? value : key;
  };

  // Set language and save to localStorage
  const setLanguage = (lang: Language) => {
    localStorage.setItem('language', lang);
    setLanguageState(lang);
    // Set html lang attribute for accessibility
    document.documentElement.lang = lang;
  };

  // Set the initial HTML lang attribute
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

// Custom hook to use the language context
export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
