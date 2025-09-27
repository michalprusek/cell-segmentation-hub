import { createContext } from 'react';
import en from '@/translations/en';

export type Language = 'en' | 'cs' | 'es' | 'fr' | 'de' | 'zh';
export type Translations = typeof en;

export interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string | string[];
  translations: Translations;
}

export const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => Promise.resolve(),
  t: key => key,
  translations: en,
});
