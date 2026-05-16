import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/exports';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';
import { i18nLogger } from '@/lib/i18nLogger';
import {
  LanguageContext,
  type Language,
  type Translations,
} from './LanguageContext.types';

// Dynamic loaders — each language bundles into its own chunk via Vite's
// import() splitting. The initial app bundle ships ONE language (the
// user's preferred or browser default), not all six (which was ~150 KB
// of unused JSON-shaped TypeScript before this change).
const TRANSLATION_LOADERS: Record<Language, () => Promise<Translations>> = {
  en: () => import('@/translations/en').then(m => m.default as Translations),
  cs: () => import('@/translations/cs').then(m => m.default as Translations),
  es: () => import('@/translations/es').then(m => m.default as Translations),
  fr: () => import('@/translations/fr').then(m => m.default as Translations),
  de: () => import('@/translations/de').then(m => m.default as Translations),
  zh: () => import('@/translations/zh').then(m => m.default as Translations),
};

const SUPPORTED_LANGUAGES = Object.keys(TRANSLATION_LOADERS) as Language[];

// Module-scope cache so a language re-selection across mount/unmount
// doesn't re-fetch the chunk; the dynamic import is already cached by
// the bundler but keeping the parsed module avoids re-instantiation.
const _translationCache = new Map<Language, Translations>();

async function loadTranslation(lang: Language): Promise<Translations> {
  const cached = _translationCache.get(lang);
  if (cached) return cached;
  const mod = await TRANSLATION_LOADERS[lang]();
  _translationCache.set(lang, mod);
  return mod;
}

function resolveInitialLanguage(): Language {
  const local = localStorage.getItem('language') as Language | null;
  if (local && SUPPORTED_LANGUAGES.includes(local)) return local;
  const browser = navigator.language.split('-')[0];
  if (SUPPORTED_LANGUAGES.includes(browser as Language))
    return browser as Language;
  return 'en';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [language, setLanguageState] = useState<Language>(
    resolveInitialLanguage
  );
  const [currentTranslations, setCurrentTranslations] =
    useState<Translations | null>(null);

  // Tracks whether the user manually picked a language since the
  // profile-fetch effect last started. Set by `setLanguage` below; the
  // effect's onSuccess handler refuses to overwrite a manual choice
  // (otherwise a slow server profile fetch resolving AFTER a user
  // click would silently revert the click — review pass-3 #3).
  const manualOverrideRef = useRef(false);

  // Resolve preferred language from server profile (overrides localStorage)
  // once authenticated. Keys on `user?.id` rather than the whole user
  // object or `language`: including `language` would re-fire the fetch
  // each time the user picks a different locale (the effect's own
  // setLanguageState mutates `language`, so the deps array would loop
  // — every UI language toggle would cost an extra getUserProfile()).
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    manualOverrideRef.current = false;
    (async () => {
      try {
        const profile = await apiClient.getUserProfile();
        const pref = profile?.preferredLang as Language | undefined;
        if (cancelled || !pref || !SUPPORTED_LANGUAGES.includes(pref)) return;
        if (manualOverrideRef.current) return;
        localStorage.setItem('language', pref);
        setLanguageState(prev => (prev === pref ? prev : pref));
      } catch (err) {
        logger.error('Error loading language preference:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Load the chunk for the current language. The provider returns null
  // until the first language is resolved, so consumers never see an
  // empty `t()`. Subsequent language switches keep the previous strings
  // visible until the new chunk arrives — no full-page flash.
  useEffect(() => {
    let cancelled = false;
    loadTranslation(language)
      .then(strings => {
        if (!cancelled) setCurrentTranslations(strings);
      })
      .catch(err => {
        logger.error(`Failed to load translations for '${language}':`, err);
        // Fall back to English so the app doesn't dead-lock on a missing
        // chunk (e.g. CDN hiccup or removed locale).
        if (language !== 'en') {
          loadTranslation('en')
            .then(strings => {
              if (!cancelled) setCurrentTranslations(strings);
            })
            .catch(enErr => {
              // English fallback ALSO failed — without this log the app
              // renders a blank page forever (`currentTranslations`
              // stays null, provider returns null) with no diagnostic.
              logger.error(
                'CRITICAL: English fallback translation chunk failed to load — UI will be blank until a refresh',
                enErr
              );
            });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const setLanguage = useCallback(
    async (newLanguage: Language) => {
      // Mark manual override so an in-flight profile fetch can't
      // stomp the user's click (review pass-3 #3).
      manualOverrideRef.current = true;
      localStorage.setItem('language', newLanguage);
      setLanguageState(newLanguage);

      if (user) {
        try {
          await apiClient.updateUserProfile({ preferredLang: newLanguage });
        } catch (error: unknown) {
          const errorMessage =
            getErrorMessage(error) || 'Failed to save language';
          logger.error('Error updating profile language:', errorMessage, error);
        }
      }
    },
    [user]
  );

  // Stable t() identity per (language, currentTranslations) — both are
  // primitives or refs that only change when the dictionary really
  // changes, so memoised consumers don't re-render on every render
  // of the provider.
  const t = useCallback(
    (key: string, options?: Record<string, unknown>): string | string[] => {
      if (!currentTranslations) return key;
      const keys = key.split('.');
      let translation: unknown = currentTranslations;
      for (const k of keys) {
        if (
          translation &&
          typeof translation === 'object' &&
          (translation as Record<string, unknown>)[k] !== undefined
        ) {
          translation = (translation as Record<string, unknown>)[k];
        } else {
          i18nLogger.logMissingKey(key);
          return key;
        }
      }

      if (Array.isArray(translation)) return translation as string[];

      if (typeof translation !== 'string') {
        i18nLogger.logMissingKey(key);
        return key;
      }

      if (options) {
        return Object.entries(options).reduce((result, [optKey, optValue]) => {
          return result.replace(
            new RegExp(`{{${optKey}}}`, 'g'),
            String(optValue)
          );
        }, translation);
      }
      return translation;
    },
    [currentTranslations]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      translations: (currentTranslations ?? {}) as Translations,
    }),
    [language, setLanguage, t, currentTranslations]
  );

  // First-paint gate: wait for at least one translation to resolve.
  // Subsequent language switches keep the previous strings until the
  // new chunk arrives (no flash) because `setCurrentTranslations` is
  // only called on success.
  if (!currentTranslations) {
    return null;
  }

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
