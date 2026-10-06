/**
 * Leave the single-page app for a URL, discarding everything in memory.
 *
 * A router `navigate()` keeps the React tree, the React Query cache and every
 * context alive. That is the point of it, and exactly wrong after the account
 * those hold has been deleted. Its own module so tests can replace it: jsdom
 * does not implement navigation.
 */
export function hardRedirect(url: string): void {
  window.location.replace(url);
}

/**
 * sessionStorage key set just before the reload that follows an account
 * deletion, so the page that loads next can say so. Read (and removed) by
 * `useAuthToasts`.
 */
export const ACCOUNT_DELETED_FLAG = 'spheroseg.accountDeleted';
