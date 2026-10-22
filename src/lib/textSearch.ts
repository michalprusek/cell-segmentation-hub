/**
 * The app's one notion of "does this text match what the user typed".
 *
 * Shared by the in-app documentation search and the dashboard's project
 * search, so the two boxes behave the same: case- and diacritic-insensitive
 * (Czech users type "dve" for "dvě" as often as not), and every
 * whitespace-separated term must occur somewhere in the text, which is the
 * AND search users expect from a search box.
 */

/** Lowercase and strip combining marks so accents never block a match. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** The normalized terms of a query; empty for a blank one. */
export function toSearchTerms(query: string): string[] {
  return normalizeForSearch(query.trim()).split(/\s+/).filter(Boolean);
}

/** True when every term (from `toSearchTerms`) occurs in `text`. */
export function matchesAllTerms(text: string, terms: string[]): boolean {
  const haystack = normalizeForSearch(text);
  return terms.every(term => haystack.includes(term));
}
