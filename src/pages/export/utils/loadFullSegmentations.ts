import apiClient from '@/lib/api';
import type { PolygonData, ProjectImage } from '@/types';

type Segmentation = NonNullable<ProjectImage['segmentationResult']>;

/** The most `images-with-thumbnails` serves per page. */
const PAGE_SIZE = 100;

/** Server-side state that `toApiPolygon` keeps away from clients. */
const stripInternalFields = (polygons: PolygonData[]): PolygonData[] =>
  polygons.map(polygon => {
    const { _embedding, ...rest } = polygon as PolygonData & {
      _embedding?: unknown;
    };
    return rest;
  });

/**
 * Fetches the polygons of `images` for an export.
 *
 * The export page lists images at `lod: 'low'`, which leaves polygons out on
 * purpose, so whatever writes polygons to a file has to ask for them.
 *
 * This reads the same listing at `lod: 'high'` rather than
 * `POST /segmentation/batch/results`, which answers only the owner of a project
 * and turns a row it cannot parse into `polygons: []`. A collaborator would get
 * an empty file again. The listing checks shared access and marks such a row
 * with `hasParseError`, which is passed on.
 *
 * Rejects when a segmented image does not come back, so that a file is never
 * written with an empty result in place of the real one.
 */
export async function loadFullSegmentations(
  projectId: string | undefined,
  images: ProjectImage[]
): Promise<ProjectImage[]> {
  const wanted = new Set(
    images.filter(image => image.segmentationResult).map(image => image.id)
  );
  if (wanted.size === 0) return images;
  if (!projectId) throw new Error('Export needs a project id');

  const loaded = new Map<string, Segmentation>();
  for (let page = 1; loaded.size < wanted.size; page++) {
    const { images: rows, pagination } =
      await apiClient.getProjectImagesWithThumbnails(projectId, {
        page,
        limit: PAGE_SIZE,
        lod: 'high',
      });
    for (const row of rows) {
      const result = (row as unknown as { segmentationResult?: Segmentation })
        .segmentationResult;
      if (wanted.has(row.id) && result) {
        loaded.set(row.id, {
          ...result,
          polygons: stripInternalFields(result.polygons ?? []),
        });
      }
    }
    if (page * PAGE_SIZE >= pagination.total) break;
  }

  const missing = [...wanted].filter(id => !loaded.has(id));
  if (missing.length > 0) {
    throw new Error(`No segmentation returned for: ${missing.join(', ')}`);
  }

  return images.map(image =>
    loaded.has(image.id)
      ? { ...image, segmentationResult: loaded.get(image.id) }
      : image
  );
}
