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

/**
 * Resolve which language the client should render in before (and in the
 * absence of) a server-side profile preference.
 *
 * Precedence:
 *   1. an explicit choice already persisted in localStorage,
 *   2. the browser's accept-language list — `navigator.languages` is an
 *      ordered preference list, so a user whose first choice we do not ship
 *      (e.g. `pl`) still gets their second (`de`) rather than English,
 *   3. English.
 *
 * Deliberately does NOT write to localStorage. A browser-derived guess has to
 * stay distinguishable from a real user choice: `syncLocalPreferencesToDatabase`
 * pushes whatever is in localStorage onto the server profile at sign-in, so
 * persisting the guess would let a fresh browser silently overwrite the
 * language a returning user picked on another device.
 */
export function resolveClientLanguage(): Language {
  const stored = localStorage.getItem('language') as Language | null;
  if (stored && SUPPORTED_LANGUAGES.includes(stored)) return stored;

  // Per spec `navigator.language` is `navigator.languages[0]`, so listing it
  // first is a no-op in a conformant browser — it just keeps the primary
  // preference authoritative in runtimes that expose only one of the two.
  const candidates = [navigator.language, ...(navigator.languages ?? [])];

  for (const tag of candidates) {
    const base = tag?.split('-')[0]?.toLowerCase() as Language | undefined;
    if (base && SUPPORTED_LANGUAGES.includes(base)) return base;
  }

  return 'en';
}
