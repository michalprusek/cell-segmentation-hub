/**
 * Microtubule type-label palette service.
 *
 * The palette is the SSOT for the user-defined tubulin "type" labels of a
 * microtubule project: `[{ id, name, color }]`, stored on `Project.mtTypeLabels`.
 * Each microtubule polyline references a label by id via its `mtType` field
 * (inside the segmentation polygons JSON). Renames are cheap (id stable, only
 * the palette changes); a delete removes the entry AND nulls every `mtType`
 * reference across the project's frames so no dangling ids remain.
 */
import { prisma } from '../db';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

export interface MTTypeLabel {
  id: string;
  name: string;
  color: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Coerce untrusted palette JSON into a clean `MTTypeLabel[]`. Drops entries with
 * an empty id/name or a non-`#RRGGBB` colour; dedupes by id (last wins) and then
 * by case-insensitive name (first wins) so a project can't hold two labels with
 * the same visible name.
 */
export function sanitizeLabels(raw: unknown): MTTypeLabel[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, MTTypeLabel>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const color = typeof r.color === 'string' ? r.color.trim() : '';
    if (!id || !name || !HEX.test(color)) continue;
    byId.set(id, { id, name, color });
  }
  const seenNames = new Set<string>();
  const out: MTTypeLabel[] = [];
  for (const label of byId.values()) {
    const key = label.name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    out.push(label);
  }
  return out;
}

/** Ids present in `prev` but absent from `next` (i.e. removed by a PUT). */
export function diffRemovedIds(
  prev: MTTypeLabel[],
  next: MTTypeLabel[]
): string[] {
  const nextIds = new Set(next.map(l => l.id));
  return prev.filter(l => !nextIds.has(l.id)).map(l => l.id);
}

/** Lenient parse of a frame's polygons JSON to an array (empty on null/corrupt).
 *  Cleanup must never throw on one bad frame. */
function parseFramePolygons(json: string | null | undefined): unknown[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Clear `mtType` on every polygon whose `mtType` equals `labelId`. Pure — changed
 * polygons are shallow-copied. Returns the new array + how many changed.
 */
export function clearMtTypeById(
  polys: unknown[],
  labelId: string
): { polygons: unknown[]; changed: number } {
  let changed = 0;
  const polygons = polys.map(p => {
    const rec = p as Record<string, unknown>;
    if (rec.mtType !== labelId) return p;
    changed++;
    const copy = { ...rec };
    delete copy.mtType;
    return copy;
  });
  return { polygons, changed };
}

export async function getLabels(projectId: string): Promise<MTTypeLabel[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { mtTypeLabels: true },
  });
  return sanitizeLabels(project?.mtTypeLabels ?? []);
}

/** Replace the whole palette (create / rename / reorder). Ids are stable, so no
 *  polyline rewrite is needed. Returns the sanitized set stored + ids removed. */
export async function putLabels(
  projectId: string,
  labels: unknown
): Promise<{ labels: MTTypeLabel[]; removedIds: string[] }> {
  const prev = await getLabels(projectId);
  const next = sanitizeLabels(labels);
  await prisma.project.update({
    where: { id: projectId },
    data: { mtTypeLabels: next as unknown as Prisma.InputJsonValue },
  });
  return { labels: next, removedIds: diffRemovedIds(prev, next) };
}

/** Delete one label and null its `mtType` references on every frame of the
 *  project. Returns the surviving palette + how many frames were cleaned. */
export async function deleteLabel(
  projectId: string,
  labelId: string
): Promise<{ labels: MTTypeLabel[]; framesCleaned: number }> {
  // Guard: an empty labelId must never reach clearMtTypeById, whose
  // `mtType !== labelId` test would otherwise spuriously "clear" untyped
  // polygons (mtType === undefined). Route validation enforces this too.
  if (!labelId) {
    return { labels: await getLabels(projectId), framesCleaned: 0 };
  }
  const prev = await getLabels(projectId);
  const next = prev.filter(l => l.id !== labelId);
  await prisma.project.update({
    where: { id: projectId },
    data: { mtTypeLabels: next as unknown as Prisma.InputJsonValue },
  });

  const frames = await prisma.image.findMany({
    where: { projectId },
    select: {
      id: true,
      segmentation: { select: { id: true, polygons: true } },
    },
  });
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  let framesCleaned = 0;
  for (const frame of frames) {
    if (!frame.segmentation) continue;
    const parsed = parseFramePolygons(frame.segmentation.polygons);
    const { polygons, changed } = clearMtTypeById(parsed, labelId);
    if (changed > 0) {
      framesCleaned++;
      ops.push(
        prisma.segmentation.update({
          where: { id: frame.segmentation.id },
          data: { polygons: JSON.stringify(polygons), updatedAt: new Date() },
        })
      );
    }
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  logger.info('Deleted MT type label', 'MtTypeLabelService', {
    projectId,
    labelId,
    framesCleaned,
  });
  return { labels: next, framesCleaned };
}
