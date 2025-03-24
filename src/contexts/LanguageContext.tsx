
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Define supported languages
export type Language = 'en' | 'de' | 'fr' | 'es' | 'zh' | 'cs';

// Language names for display
export const languageNames = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  zh: '中文',
  cs: 'Čeština'
};

// Interface for the language context
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, any>) => string;
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
import cs from '@/translations/cs';

// Translations mapping
const translations = {
  en,
  de,
  fr,
  es,
  zh,
  cs
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [language, setLanguageState] = useState<Language>('en');
  const [loaded, setLoaded] = useState(false);

  // Načtení jazyka z localStorage nebo z databáze
  useEffect(() => {
    const fetchUserLanguage = async () => {
      // První zkusíme načíst z localStorage
      const localLang = localStorage.getItem('language') as Language | null;
      
      // Pokud jsme přihlášeni, zkusíme získat jazyk z profilu
      if (user) {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('preferred_language')
            .eq('id', user.id)
            .single();
            
          if (!error && data && data.preferred_language) {
            const dbLang = data.preferred_language as Language;
            if (dbLang in translations) {
              setLanguageState(dbLang);
              localStorage.setItem('language', dbLang);
              document.documentElement.lang = dbLang;
              setLoaded(true);
              return;
            }
          }
        } catch (error) {
          console.error('Error loading language preference:', error);
        }
      }
      
      // Pokud nemáme jazyk z profilu, použijeme localStorage nebo výchozí hodnotu
      if (localLang && localLang in translations) {
        setLanguageState(localLang);
      } else {
        // Nebo použijeme jazyk prohlížeče
        const browserLang = navigator.language.split('-')[0];
        const finalLang = (browserLang as Language) in translations 
          ? (browserLang as Language) 
          : 'en';
          
        setLanguageState(finalLang);
        localStorage.setItem('language', finalLang);
      }
      
      document.documentElement.lang = language;
      setLoaded(true);
    };
    
    fetchUserLanguage();
  }, [user]);

  // Translation function with parameter support
  const t = (key: string, params?: Record<string, any>): string => {
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
          value = fallbackValue;
          break;
        }
        return key; // Return the key itself if all fallbacks fail
      }
    }
    
    if (typeof value !== 'string') return key;
    
    // Replace parameters if provided
    if (params) {
      return Object.entries(params).reduce((acc, [paramKey, paramValue]) => {
        return acc.replace(new RegExp(`{${paramKey}}`, 'g'), String(paramValue));
      }, value);
    }
    
    return value;
  };

  // Set language and save to localStorage
  const setLanguage = (lang: Language) => {
    if (!(lang in translations)) {
      console.error(`Language ${lang} is not supported.`);
      return;
    }
    
    localStorage.setItem('language', lang);
    setLanguageState(lang);
    // Set html lang attribute for accessibility
    document.documentElement.lang = lang;
    
    // Uložení do databáze, pokud jsme přihlášeni
    if (user) {
      supabase
        .from('profiles')
        .update({ preferred_language: lang })
        .eq('id', user.id)
        .then(({ error }) => {
          if (error) console.error('Error saving language preference:', error);
        });
    }
  };

  if (!loaded) {
    return null; // Nezobrazovat nic, dokud nemáme načtený jazyk
  }

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
