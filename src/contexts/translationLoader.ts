/**
 * Translation chunk loading + caching for LanguageContext.
 *
 * Kept in its own module (not LanguageContext.tsx) so the provider file
 * exports only the component — satisfying react-refresh/only-export-components
 * — while these loaders/cache helpers can be shared and unit-tested.
 */
import type { Language, Translations } from './LanguageContext.types';

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

export const SUPPORTED_LANGUAGES = Object.keys(
  TRANSLATION_LOADERS
) as Language[];

// Module-scope cache so a language re-selection across mount/unmount
// doesn't re-fetch the chunk; the dynamic import is already cached by
// the bundler but keeping the parsed module avoids re-instantiation.
const _translationCache = new Map<Language, Translations>();

export async function loadTranslation(lang: Language): Promise<Translations> {
  const cached = _translationCache.get(lang);
  if (cached) return cached;
  const mod = await TRANSLATION_LOADERS[lang]();
  _translationCache.set(lang, mod);
  return mod;
}

/** Synchronous read of an already-loaded chunk; undefined if not cached. */
export function getCachedTranslation(lang: Language): Translations | undefined {
  return _translationCache.get(lang);
}

/**
 * Seed the cache synchronously. Used by the test setup to make English
 * available on the FIRST synchronous render (the chunk loader is an effect,
 * which runs only AFTER render — so component tests that query by translated
 * text without awaiting would otherwise see raw i18n keys). No-op in
 * production paths, which never call this.
 */
export function primeTranslationCache(
  lang: Language,
  translations: Translations
): void {
  _translationCache.set(lang, translations);
}
