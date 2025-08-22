import React, { createContext, useContext, useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import en from '@/translations/en';
import cs from '@/translations/cs';
import es from '@/translations/es';
import fr from '@/translations/fr';
import de from '@/translations/de';
import zh from '@/translations/zh';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';
import { i18nLogger } from '@/lib/i18nLogger';

export type Language = 'en' | 'cs' | 'es' | 'fr' | 'de' | 'zh';
export type Translations = typeof en;

interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string | string[];
  translations: Translations;
}

const translations = {
  en,
  cs,
  es,
  fr,
  de,
  zh,
};

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: key => key,
  translations: en,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [language, setLanguageState] = useState<Language>('en');
  const [loaded, setLoaded] = useState<boolean>(false);

  // Po přihlášení zkusíme načíst jazyk z uživatelského profilu
  useEffect(() => {
    const fetchUserLanguage = async () => {
      // Nejprve zkusíme načíst z localStorage
      const localLanguage = localStorage.getItem('language') as Language | null;

      // Pokud jsme přihlášeni, zkusíme získat jazyk z profilu
      if (user) {
        try {
          const profileData = await apiClient.getUserProfile();

          if (profileData && profileData.preferredLang) {
            const dbLanguage = profileData.preferredLang as Language;
            setLanguageState(dbLanguage);
            localStorage.setItem('language', dbLanguage);
            setLoaded(true);
            return;
          }
        } catch (error) {
          logger.error('Error loading language preference:', error);
        }
      }

      // Pokud nemáme jazyk z profilu, použijeme localStorage nebo výchozí hodnotu
      if (localLanguage && Object.keys(translations).includes(localLanguage)) {
        setLanguageState(localLanguage);
      } else {
        // Pokusíme se detekovat preferovaný jazyk prohlížeče
        const browserLanguage = navigator.language.split('-')[0];
        if (
          browserLanguage &&
          Object.keys(translations).includes(browserLanguage as Language)
        ) {
          setLanguageState(browserLanguage as Language);
          localStorage.setItem('language', browserLanguage);
        } else {
          setLanguageState('en');
          localStorage.setItem('language', 'en');
        }
      }

      setLoaded(true);
    };

    fetchUserLanguage();
  }, [user]);

  // Funkce pro nastavení jazyka
  const setLanguage = async (newLanguage: Language) => {
    // Aktualizujeme localStorage a stav
    localStorage.setItem('language', newLanguage);
    setLanguageState(newLanguage);

    // Pokud jsme přihlášeni, aktualizujeme uživatelský profil
    if (user) {
      try {
        await apiClient.updateUserProfile({ preferredLang: newLanguage });
      } catch (error: unknown) {
        const errorMessage =
          getErrorMessage(error) || 'Failed to save language';
        logger.error('Error updating profile language:', errorMessage, error);
      }
    }
  };

  // Funkce pro překlad
  const t = (
    key: string,
    options?: Record<string, unknown>
  ): string | string[] => {
    // Rozdělení klíče podle teček pro přístup k vnořeným objektům
    const keys = key.split('.');

    // Získání překladu
    let translation: Record<string, unknown> = translations[language];

    for (const k of keys) {
      if (
        translation &&
        typeof translation === 'object' &&
        translation[k] !== undefined
      ) {
        translation = translation[k] as Record<string, unknown>;
      } else {
        // Pokud překlad neexistuje, logujeme chybějící klíč a vrátíme původní klíč
        i18nLogger.logMissingKey(key);
        return key;
      }
    }

    // Pokud je překlad pole, vrátíme ho
    if (Array.isArray(translation)) {
      return translation;
    }

    // Pokud překlad není řetězec, vrátíme původní klíč
    if (typeof translation !== 'string') {
      i18nLogger.logMissingKey(key);
      return key;
    }

    // Nahrazení placeholderů
    if (options) {
      return Object.entries(options).reduce((result, [optKey, optValue]) => {
        return result.replace(
          new RegExp(`{{${optKey}}}`, 'g'),
          String(optValue)
        );
      }, translation);
    }

    return translation;
  };

  // Čekáme, dokud se nenačte jazykové nastavení
  if (!loaded) {
    return null;
  }

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        translations: translations[language] as Translations,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
