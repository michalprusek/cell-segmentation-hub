/**
 * Normalize text for search operations
 * Removes accents and converts to lowercase
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks
    .toLowerCase()
    .trim();
}

/**
 * Compare two strings for equality after normalization
 */
export function normalizedCompare(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

/**
 * Check if a string contains a substring after normalization
 */
export function normalizedIncludes(text: string, search: string): boolean {
  return normalizeText(text).includes(normalizeText(search));
}