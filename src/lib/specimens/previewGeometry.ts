/**
 * On-demand loader for preview outline geometry.
 *
 * The 33 tiles carry ~127 kB of path data between them. Bundling that would
 * put it in the dashboard and settings chunks for every visitor, when almost
 * none of it is ever looked at — so the index in `previewIndex.ts` holds only
 * URLs and the geometry is fetched the first time a card wants it.
 *
 * Two caches, on purpose: `cache` makes a second hover free, and `inFlight`
 * makes three tiles opening at once (or a pointer that leaves and comes back
 * inside the open delay) issue ONE request each instead of a burst. A failed
 * fetch is deliberately not cached, so a hover after a network blip retries
 * instead of showing an outline-less tile forever.
 */

import { logger } from '@/lib/logger';
import type { SpecimenOutline } from '@/lib/specimens/specimenStroke';

const cache = new Map<string, readonly SpecimenOutline[]>();
const inFlight = new Map<string, Promise<readonly SpecimenOutline[]>>();

/** Geometry already in memory, or undefined. Lets a card paint its outlines on
 *  the first frame rather than after a state round-trip. */
export function peekSpecimenGeometry(
  url: string
): readonly SpecimenOutline[] | undefined {
  return cache.get(url);
}

/** Fetch (or reuse) one tile's outlines. Resolves to `[]` when the asset is
 *  unreachable: a missing overlay must degrade to a plain frame, never break
 *  the picker the card is attached to. */
export function loadSpecimenGeometry(
  url: string
): Promise<readonly SpecimenOutline[]> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = fetch(url)
    .then(async response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as { outlines?: SpecimenOutline[] };
      const outlines: readonly SpecimenOutline[] = body.outlines ?? [];
      cache.set(url, outlines);
      return outlines;
    })
    .catch(error => {
      logger.warn('Specimen preview geometry failed to load', { url, error });
      return [] as readonly SpecimenOutline[];
    })
    .finally(() => {
      inFlight.delete(url);
    });

  inFlight.set(url, request);
  return request;
}

/** Test seam: drop everything this module remembers. */
export function resetSpecimenGeometryCache(): void {
  cache.clear();
  inFlight.clear();
}
