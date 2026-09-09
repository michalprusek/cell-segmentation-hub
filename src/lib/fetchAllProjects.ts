/**
 * Walk every page of the paginated project listing.
 *
 * `GET /projects` is paginated and defaults to **10** when the caller sends no
 * limit (`projectController.ts`, `limit: limit || 10`). Three separate call
 * sites took that default and rendered the first page as if it were the whole
 * list, which is invisible until a user passes ten projects and then reads as
 * DATA LOSS rather than as a missing page: the default sort is
 * `createdAt desc`, so each new project pushes the oldest out of view.
 *
 * That is not hypothetical — it was reported on 2026-09-09 as "Disappearing
 * projects?" by a user who had re-created projects she believed she had
 * deleted by mistake. She had 36, all of them still in the database.
 *
 * Raising the limit is not a fix: the API caps at 100 (`validation.ts`,
 * `.max(100)`), so a bigger page only moves the cliff to 101. Walking pages is
 * what removes the silent truncation.
 *
 * Takes the page-fetching function rather than importing `apiClient`, so the
 * existing suites that mock `apiClient.getProjects` keep working and this can
 * be tested on its own.
 */

/** The API's hard maximum, so this is the fewest round trips it allows. */
export const PROJECTS_PAGE_SIZE = 100;

/**
 * A stop so a backend that keeps claiming another page cannot spin the caller
 * forever. 100 pages is 10 000 projects — far past anything real, and the
 * point is to stop rather than to support that many.
 */
export const MAX_PROJECT_PAGES = 100;

interface ProjectPageParams {
  page?: number;
  limit?: number;
  folderId?: string | 'root';
  _t?: number;
  [key: string]: unknown;
}

/**
 * Generic over the project shape on purpose: `Project` lives in `@/lib/api`
 * and each caller has its own view of it (the dashboard adds `images`), so
 * naming a concrete type here would only force casts at the call sites.
 */
export async function fetchAllProjects<TProject>(
  getPage: (
    params: ProjectPageParams
  ) => Promise<{ projects?: TProject[]; totalPages?: number }>,
  baseParams: ProjectPageParams = {},
  /** Checked between pages so a cancelled caller stops mid-walk. */
  isCancelled: () => boolean = () => false
): Promise<TProject[]> {
  const all: TProject[] = [];
  let pageToFetch = 1;
  let hasMorePages = true;

  while (hasMorePages && pageToFetch <= MAX_PROJECT_PAGES) {
    const response = await getPage({
      ...baseParams,
      page: pageToFetch,
      limit: PROJECTS_PAGE_SIZE,
    });
    if (isCancelled()) return all;

    all.push(...(response.projects || []));

    // A backend that omits `totalPages` must not spin the loop, so an absent
    // or nonsensical value ends the walk after this page.
    const totalPages = Number(response.totalPages) || 1;
    hasMorePages = pageToFetch < totalPages;
    pageToFetch += 1;
  }

  return all;
}
