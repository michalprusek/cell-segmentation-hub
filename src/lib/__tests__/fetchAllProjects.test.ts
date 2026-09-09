/**
 * `fetchAllProjects` — the page walk that replaced three copies of
 * "render page 1 and call it the list".
 *
 * The bug it exists to prevent was reported on 2026-09-09 as "Disappearing
 * projects?": `GET /projects` defaults to 10 per page, three call sites sent
 * no limit, and the reporter had 36 projects — none of them deleted. Because
 * the default sort is `createdAt desc`, each new project pushed the oldest out
 * of view, which reads as data loss rather than as a missing page.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchAllProjects,
  PROJECTS_PAGE_SIZE,
  MAX_PROJECT_PAGES,
} from '../fetchAllProjects';

interface P {
  id: string;
}

/** Serves `total` projects split into pages of `PROJECTS_PAGE_SIZE`. */
const server = (total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / PROJECTS_PAGE_SIZE));
  return vi.fn(async (params: { page?: number; limit?: number }) => {
    const page = params.page ?? 1;
    const start = (page - 1) * PROJECTS_PAGE_SIZE;
    const projects: P[] = Array.from(
      { length: Math.max(0, Math.min(PROJECTS_PAGE_SIZE, total - start)) },
      (_, i) => ({ id: `p${start + i + 1}` })
    );
    return { projects, totalPages };
  });
};

describe('fetchAllProjects', () => {
  it('returns a single page whole', async () => {
    const getPage = server(36);
    const all = await fetchAllProjects<P>(getPage);

    expect(all).toHaveLength(36);
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it('walks past the first page and keeps document order', async () => {
    // 250 is the case the old code got wrong in the most visible way: it
    // would have shown 10 of them.
    const getPage = server(250);
    const all = await fetchAllProjects<P>(getPage);

    expect(all).toHaveLength(250);
    expect(all[0].id).toBe('p1');
    expect(all[249].id).toBe('p250');
    expect(getPage).toHaveBeenCalledTimes(3);
  });

  it('asks for the API maximum, so one trip covers most users', async () => {
    const getPage = server(5);
    await fetchAllProjects<P>(getPage);

    expect(getPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 100 })
    );
  });

  it('passes the caller its own params on every page', async () => {
    // The dashboard scopes the listing to a folder; dropping that on page 2
    // would mix another folder's projects into the view.
    const getPage = server(150);
    await fetchAllProjects<P>(getPage, { folderId: 'root' });

    for (const call of getPage.mock.calls) {
      expect(call[0]).toMatchObject({ folderId: 'root' });
    }
  });

  it('stops after one page when totalPages is missing', async () => {
    const getPage = vi.fn(async () => ({ projects: [{ id: 'p1' }] }));
    const all = await fetchAllProjects<P>(getPage);

    expect(all).toHaveLength(1);
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller cancels, keeping only completed pages', async () => {
    // The check sits after the request and before the push, so the page that
    // was in flight when the caller cancelled is DISCARDED rather than half
    // merged. Callers abort because they no longer want the result at all —
    // the dashboard returns from its effect immediately afterwards — so the
    // simpler contract is the right one.
    const getPage = server(250);
    let checks = 0;
    const all = await fetchAllProjects<P>(getPage, {}, () => ++checks >= 2);

    expect(getPage).toHaveBeenCalledTimes(2);
    expect(all).toHaveLength(100); // page 1 only; page 2 arrived after cancel
  });

  it('refuses to loop forever on a backend that always claims more', async () => {
    // A `totalPages` that never ends must not spin the caller.
    const getPage = vi.fn(async () => ({
      projects: [{ id: 'x' }],
      totalPages: Number.MAX_SAFE_INTEGER,
    }));
    const all = await fetchAllProjects<P>(getPage);

    expect(getPage).toHaveBeenCalledTimes(MAX_PROJECT_PAGES);
    expect(all).toHaveLength(MAX_PROJECT_PAGES);
  });
});
