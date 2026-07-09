/**
 * Typed API client for the `/segmenter` module (few-shot / active-learning
 * polygon annotation tool — see
 * `docs/superpowers/specs/2026-07-09-segmenter-fewshot-al-design.md` §9 and
 * `docs/superpowers/plans/2026-07-09-segmenter-p0.md` Task 2/3).
 *
 * Mirrors the style of `@/lib/api.ts` (axios instance, httpOnly-cookie auth,
 * `{ success, data }` envelope unwrap) but is kept as a fully separate
 * module/instance so this file, the backend routes, and the polygon editor
 * can be built concurrently without colliding on `api.ts`.
 *
 * Endpoint shapes below are the P0 CONTRACT this client assumes the backend
 * implements (per the plan's Task 2/3 interface list). If the backend lands
 * with different route names/envelopes, update the request URLs here — the
 * exported types/method signatures are the stable surface for FE consumers.
 */
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import config from '@/lib/config';
import { TIMEOUTS } from '@/lib/constants';
import { logger } from '@/lib/logger';
// Reused only for its httpOnly-cookie refresh-token flow (dedup via
// `refreshPromise`) — avoids re-implementing that race-safety here.
import apiClient from '@/lib/api';

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** A dataset in the datasets list (`GET /segmenter/datasets`). */
export interface SegmenterDataset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Image count, included by the list endpoint for the dashboard cards. */
  imageCount?: number;
}

/** One uploaded image inside a dataset. */
export interface SegmenterImage {
  id: string;
  datasetId: string;
  name: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** True when the image already has a saved annotation (drives a grid badge). */
  hasAnnotation?: boolean;
}

/** A dataset's generic class-label palette entry (name + colour), the SSOT
 *  a polygon's `classId` references — pattern forked from the microtubule
 *  type-label palette (`MTTypeLabel` in `@/lib/api.ts`). */
export interface SegmenterClass {
  id: string;
  name: string;
  color: string;
}

/** `GET /segmenter/datasets/:id` — dataset + its images + its class palette. */
export interface SegmenterDatasetDetail {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  images: SegmenterImage[];
  classes: SegmenterClass[];
}

export interface SegmenterPoint {
  x: number;
  y: number;
}

/** One annotated polygon. Closed shapes only in v1 (no polylines). Polygons
 *  are independent — overlap (incl. same `classId`) is allowed by construction,
 *  never collapsed into a single-label raster. */
export interface SegmenterPolygon {
  id: string;
  points: SegmenterPoint[];
  /** References a `SegmenterClass.id` in this dataset. Absent/null = unclassified. */
  classId?: string | null;
  /** Optional instance grouping; independent per-polygon by default in P0. */
  instanceId?: string;
}

/** `GET`/`PUT /segmenter/images/:id/annotations`. */
export interface SegmenterAnnotationData {
  polygons: SegmenterPolygon[];
  imageWidth: number;
  imageHeight: number;
}

// ---------------------------------------------------------------------------
// URL builders (root-relative) — for use directly in `<img src>`, not routed
// through axios. Backed by `GET /api/segmenter/images/:imageId/file`, which
// streams the original bytes owner-scoped (see segmenterRoutes.ts). P0 has no
// separate thumbnail (thumbnails aren't generated), so both point at /file —
// the grid just renders the original scaled down via CSS.
// ---------------------------------------------------------------------------

export function segmenterImageUrl(imageId: string): string {
  return `/api/segmenter/images/${imageId}/file`;
}

export function segmenterThumbnailUrl(imageId: string): string {
  return `/api/segmenter/images/${imageId}/file`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

class SegmenterApiClient {
  private instance: AxiosInstance;

  constructor(baseURL: string = config.apiBaseUrl) {
    this.instance = axios.create({
      baseURL,
      timeout: TIMEOUTS.API_DEFAULT,
      headers: { 'Content-Type': 'application/json' },
      // Same-origin httpOnly auth cookies as the rest of the app — there is
      // no separate token to manage here.
      withCredentials: true,
    });

    // Single-retry-on-401 via the shared refresh flow. Deliberately simpler
    // than `api.ts`'s interceptor (no retryable-5xx backoff): this module's
    // calls are all explicit user actions (create/upload/save), not
    // high-volume polling, so a thrown error + a toast is the right UX.
    this.instance.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest?._retry) {
          originalRequest._retry = true;
          try {
            await apiClient.refreshAccessToken();
            return this.instance(originalRequest);
          } catch (refreshError) {
            logger.debug(
              'segmenterApi: token refresh failed',
              refreshError as Error
            );
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private extractData<T>(
    response: AxiosResponse<{ success: boolean; data: T; message?: string } | T>
  ): T {
    const responseData = response.data as unknown;
    if (
      responseData &&
      typeof responseData === 'object' &&
      'success' in responseData &&
      'data' in responseData
    ) {
      return (responseData as { success: boolean; data: T }).data;
    }
    return response.data as T;
  }

  // ---- Datasets ----------------------------------------------------------

  async createDataset(name: string): Promise<SegmenterDataset> {
    const response = await this.instance.post('/segmenter/datasets', {
      name,
    });
    return this.extractData(response);
  }

  async listDatasets(): Promise<SegmenterDataset[]> {
    const response = await this.instance.get('/segmenter/datasets');
    const data = this.extractData<unknown>(response);
    if (Array.isArray(data)) return data as SegmenterDataset[];
    // Defensive: tolerate a `{ datasets: [...] }` envelope too.
    const wrapped = data as { datasets?: SegmenterDataset[] } | null;
    return Array.isArray(wrapped?.datasets) ? wrapped!.datasets! : [];
  }

  async getDataset(datasetId: string): Promise<SegmenterDatasetDetail> {
    const response = await this.instance.get(
      `/segmenter/datasets/${datasetId}`
    );
    const data = this.extractData<SegmenterDatasetDetail>(response);
    return {
      id: data.id,
      name: data.name,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      images: Array.isArray(data.images) ? data.images : [],
      classes: Array.isArray(data.classes) ? data.classes : [],
    };
  }

  async deleteDataset(datasetId: string): Promise<void> {
    await this.instance.delete(`/segmenter/datasets/${datasetId}`);
  }

  // ---- Images -------------------------------------------------------------

  /**
   * Uploads one or more images to a dataset. Mirrors `apiClient.uploadImages`
   * (NFC filename normalization, multipart field `images`, progress callback,
   * abort signal) — single request, no chunking (P0 datasets are expected to
   * be far smaller than full spheroid projects; add chunking later if needed).
   */
  async uploadImages(
    datasetId: string,
    files: File[],
    onProgress?: (progressPercent: number) => void,
    signal?: AbortSignal
  ): Promise<SegmenterImage[]> {
    const formData = new FormData();
    files.forEach(file => {
      const normalizedName = file.name.normalize('NFC');
      const payload =
        normalizedName !== file.name
          ? new File([file], normalizedName, {
              type: file.type,
              lastModified: file.lastModified,
            })
          : file;
      formData.append('images', payload);
    });

    const response = await this.instance.post(
      `/segmenter/datasets/${datasetId}/images`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: TIMEOUTS.FILE_UPLOAD_LARGE,
        signal,
        onUploadProgress: progressEvent => {
          if (onProgress && progressEvent.total) {
            onProgress(
              Math.round((progressEvent.loaded * 100) / progressEvent.total)
            );
          }
        },
      }
    );

    const data = this.extractData<unknown>(response);
    if (data && typeof data === 'object' && 'images' in data) {
      const typedData = data as { images: SegmenterImage[] };
      return Array.isArray(typedData.images) ? typedData.images : [];
    }
    return Array.isArray(data) ? (data as SegmenterImage[]) : [];
  }

  async deleteImage(imageId: string): Promise<void> {
    await this.instance.delete(`/segmenter/images/${imageId}`);
  }

  // ---- Class registry (fork of the MT type-label palette pattern) --------

  async getClasses(datasetId: string): Promise<SegmenterClass[]> {
    const response = await this.instance.get(
      `/segmenter/datasets/${datasetId}/classes`
    );
    const data = this.extractData<{ classes?: SegmenterClass[] }>(response);
    return Array.isArray(data?.classes) ? data.classes : [];
  }

  /** Create one class (per-row insert, NOT a whole-list replace — the
   *  backend stores classes in a real table, not a JSON blob column like the
   *  MT type-label palette). Returns the full updated list, mirroring
   *  `mtTypeLabelService`'s "every mutation returns the whole set" contract. */
  async createClass(
    datasetId: string,
    name: string,
    color: string
  ): Promise<SegmenterClass[]> {
    const response = await this.instance.post(
      `/segmenter/datasets/${datasetId}/classes`,
      { name, color }
    );
    const data = this.extractData<{ classes?: SegmenterClass[] }>(response);
    return Array.isArray(data?.classes) ? data.classes : [];
  }

  /** Rename/recolor one class. `patch` must have at least one field. */
  async updateClass(
    datasetId: string,
    classId: string,
    patch: { name?: string; color?: string }
  ): Promise<SegmenterClass[]> {
    const response = await this.instance.put(
      `/segmenter/datasets/${datasetId}/classes/${encodeURIComponent(classId)}`,
      patch
    );
    const data = this.extractData<{ classes?: SegmenterClass[] }>(response);
    return Array.isArray(data?.classes) ? data.classes : [];
  }

  /** Delete one class; the server nulls `classId` on every polygon that
   *  referenced it (`imagesCleaned` = how many annotations were rewritten). */
  async deleteClass(
    datasetId: string,
    classId: string
  ): Promise<{ classes: SegmenterClass[]; imagesCleaned: number }> {
    const response = await this.instance.delete(
      `/segmenter/datasets/${datasetId}/classes/${encodeURIComponent(classId)}`
    );
    const data = this.extractData<{
      classes?: SegmenterClass[];
      imagesCleaned?: number;
    }>(response);
    return {
      classes: Array.isArray(data?.classes) ? data.classes : [],
      imagesCleaned: data?.imagesCleaned ?? 0,
    };
  }

  // ---- Annotations ---------------------------------------------------------

  /** Returns `null` when the image has no saved annotation yet (404). */
  async getAnnotations(
    imageId: string
  ): Promise<SegmenterAnnotationData | null> {
    try {
      const response = await this.instance.get(
        `/segmenter/images/${imageId}/annotations`
      );
      const data = this.extractData<SegmenterAnnotationData>(response);
      return {
        polygons: Array.isArray(data?.polygons) ? data.polygons : [],
        imageWidth: data?.imageWidth ?? 0,
        imageHeight: data?.imageHeight ?? 0,
      };
    } catch (error) {
      if (
        (error as { response?: { status?: number } })?.response?.status === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async putAnnotations(
    imageId: string,
    data: SegmenterAnnotationData
  ): Promise<SegmenterAnnotationData> {
    const response = await this.instance.put(
      `/segmenter/images/${imageId}/annotations`,
      data
    );
    return this.extractData(response);
  }
}

export const segmenterApi = new SegmenterApiClient();
export default segmenterApi;
