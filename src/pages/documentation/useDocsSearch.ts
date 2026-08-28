/**
 * Client-side search over the in-app documentation.
 *
 * Deliberately dependency-free: the whole corpus is a few dozen kilobytes of
 * already-translated strings that are in memory anyway, so a linear scan is
 * both instant and simpler than shipping a search-index library. It also means
 * search works in every locale for free — the index is built from the same
 * `t()` output the page renders.
 *
 * Matching is diacritic-insensitive (so "kymograf" finds "kymográf" and
 * "microtubule" finds "mikrotubule" spelled either way in the Czech text) and
 * requires EVERY whitespace-separated term to appear somewhere in the section,
 * which behaves like the AND search users expect from a docs box.
 */

import { useMemo } from 'react';
import { sectionSearchText, type DocsSection } from './docsContent';

/** Lowercase and strip combining marks so accents never block a match. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

export interface DocsSearchResult {
  /** Sections to render — all of them when the query is empty. */
  sections: DocsSection[];
  /** True when the user has typed something worth filtering on. */
  isSearching: boolean;
  /** Number of matching sections; only meaningful while searching. */
  matchCount: number;
  /** Terms to highlight, normalized. Empty when not searching. */
  terms: string[];
}

/**
 * Filter `sections` by `query`.
 *
 * A single-character query is ignored: it would match nearly everything and
 * make the page flicker while the user is still typing. Two characters is the
 * shortest query that filters.
 */
export function useDocsSearch(
  sections: DocsSection[],
  query: string
): DocsSearchResult {
  return useMemo(() => {
    const normalizedQuery = normalizeForSearch(query.trim());
    if (normalizedQuery.length < 2) {
      return { sections, isSearching: false, matchCount: 0, terms: [] };
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const matches = sections.filter(section => {
      const haystack = normalizeForSearch(sectionSearchText(section));
      return terms.every(term => haystack.includes(term));
    });

    return {
      sections: matches,
      isSearching: true,
      matchCount: matches.length,
      terms,
    };
  }, [sections, query]);
}
