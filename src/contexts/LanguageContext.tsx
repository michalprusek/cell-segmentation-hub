
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";
import en from '@/translations/en';
import cs from '@/translations/cs';
import de from '@/translations/de';
import es from '@/translations/es';
import fr from '@/translations/fr';
import zh from '@/translations/zh';
import { useAuth } from "@/contexts/AuthContext";

export type Language = 'en' | 'cs' | 'de' | 'es' | 'fr' | 'zh';
export type Translations = typeof en;

interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, options?: Record<string, any>) => string;
  translations: Translations;
}

const translations = {
  en,
  cs,
  de,
  es,
  fr,
  zh,
};

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key,
  translations: en,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
          const { data, error } = await supabase
            .from('profiles')
            .select('preferred_language')
            .eq('id', user.id)
            .single();
            
          if (!error && data && data.preferred_language) {
            const dbLanguage = data.preferred_language as Language;
            setLanguageState(dbLanguage);
            localStorage.setItem('language', dbLanguage);
            setLoaded(true);
            return;
          }
        } catch (error) {
          console.error('Error loading language preference:', error);
        }
      }
      
      // Pokud nemáme jazyk z profilu, použijeme localStorage nebo výchozí hodnotu
      if (localLanguage && Object.keys(translations).includes(localLanguage)) {
        setLanguageState(localLanguage);
      } else {
        // Pokusíme se detekovat preferovaný jazyk prohlížeče
        const browserLanguage = navigator.language.split('-')[0];
        if (browserLanguage && Object.keys(translations).includes(browserLanguage as Language)) {
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
        const { error } = await supabase
          .from('profiles')
          .update({ preferred_language: newLanguage })
          .eq('id', user.id);
        
        if (error) {
          console.error('Error saving language preference:', error);
        }
      } catch (error) {
        console.error('Error updating profile:', error);
      }
    }
  };

  // Funkce pro překlad
  const t = (key: string, options?: Record<string, any>): string => {
    // Rozdělení klíče podle teček pro přístup k vnořeným objektům
    const keys = key.split('.');
    
    // Získání překladu
    let translation: any = translations[language];
    
    for (const k of keys) {
      if (translation && translation[k] !== undefined) {
        translation = translation[k];
      } else {
        // Pokud překlad neexistuje, vrátíme původní klíč
        return key;
      }
    }
    
    // Pokud překlad není řetězec, vrátíme původní klíč
    if (typeof translation !== 'string') {
      return key;
    }
    
    // Nahrazení placeholderů
    if (options) {
      return Object.entries(options).reduce((result, [optKey, optValue]) => {
        return result.replace(new RegExp(`{{${optKey}}}`, 'g'), String(optValue));
      }, translation);
    }
    
    return translation;
  };

  // Čekáme, dokud se nenačte jazykové nastavení
  if (!loaded) {
    return null;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, translations: translations[language] as Translations }}>
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
