import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  Profile,
  UpdateProfile,
  isProjectType,
  type ProjectType,
  type ProjectImage,
  type SegmentationStatus,
} from '@/types';
import { logger } from '@/lib/logger';
import config from '@/lib/config';
import { TIMEOUTS, FILE_LIMITS, videoUploadTimeoutMs } from '@/lib/constants';
import { retryWithBackoff, RETRY_CONFIGS } from '@/lib/retryUtils';
import {
  chunkFiles,
  processChunksWithConcurrency,
  DEFAULT_CHUNKING_CONFIG,
  ChunkProgress,
  ChunkedUploadResult,
  validateFiles,
} from '@/lib/uploadUtils';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  username?: string;
  consentToMLTraining?: boolean;
  consentToAlgorithmImprovement?: boolean;
  consentToFeatureDevelopment?: boolean;
}

export interface AuthResponse {
  // Tokens live in httpOnly cookies set by the server — never in the body.
  // The client only ever sees the user payload.
  user: {
    id: string;
    email: string;
    username?: string;
  };
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  image_count?: number;
}

/**
 * Wire-format DTO returned by `mapImageFields()` — snake_case fields,
 * narrower status union, all timestamps as ISO strings. Used internally by
 * `apiClient` for REST normalization. Components should prefer the
 * camelCase domain `ProjectImage` from `@/types`, which is a superset and
 * the de-facto canonical type (18+ consumers).
 */
export interface ProjectImageDTO {
  id: string;
  name: string;
  project_id: string;
  user_id: string;
  url?: string;
  image_url: string;
  thumbnail_url?: string;
  displayUrl?: string;
  width?: number | null;
  height?: number | null;
  segmentationThumbnailPath?: string;
  segmentationThumbnailUrl?: string; // New field for segmentation thumbnails
  segmentation_status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'no_segmentation';
  created_at: string;
  updated_at: string;
}

// Using unified retry system from retryUtils
// Legacy exponentialBackoff replaced with retryWithBackoff for consistency

export interface SegmentationRequest {
  imageId: string;
  model?: string;
  threshold?: number;
}

import type { SpermPartClass } from '@/lib/segmentation';

export interface SegmentationPolygon {
  id: string;
  points: Array<{ x: number; y: number }>;
  type: 'external' | 'internal';
  class?: string;
  parentIds?: string[]; // For tracking hierarchy
  confidence?: number;
  area?: number;
  geometry?: 'polygon' | 'polyline'; // absent = 'polygon' (backward compat)
  /** Sperm polyline part — shared with editor's SpermPartClass to avoid
   *  drift if the model's part vocabulary expands. */
  partClass?: SpermPartClass;
  instanceId?: string; // Groups polylines into instances, e.g. 'sperm_1'
  /** Cross-frame microtubule track ID populated by backend tracker after a
   *  video container's batch finishes segmentation. Sibling polylines for
   *  the same MT share the same value across frames. Used by the editor
   *  for stable colour-coding. */
  trackId?: string;
  /** Human-friendly label set in the editor. Mirrored across sibling
   *  frames by the BE on save when the polyline carries a trackId. */
  name?: string;
  /** Microcapsule completeness flag: `false` when the capsule is cut off by
   *  the image border. Drives grey rendering in the editor and exclusion from
   *  metrics. Absent for other project types. */
  complete?: boolean;
}

export interface SegmentationResultData {
  polygons: SegmentationPolygon[];
  imageWidth?: number;
  imageHeight?: number;
  modelUsed?: string;
  thresholdUsed?: number;
  confidence?: number;
  processingTime?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SegmentationResult {
  id: string;
  imageId: string;
  polygons: SegmentationPolygon[];
  model: string;
  threshold: number;
  confidence?: number;
  processingTime?: number;
  imageWidth: number;
  imageHeight: number;
  status: SegmentationStatus;
  createdAt: string;
  updatedAt: string;
}

/** Actual shape returned by POST /api/segmentation/batch — the
 *  controller wraps each image's outcome in this envelope and returns
 *  HTTP 200 even when EVERY image failed. The previous typing claimed
 *  `SegmentationResult` (a single result) which let the FE silently
 *  treat all-failed batches as successes (false-green toast). */
export interface BatchSegmentationResult {
  successful: number;
  failed: number;
  results: Array<{
    imageId: string;
    success: boolean;
    error?: string;
    result?: SegmentationResult;
  }>;
}

export interface QueueItem {
  id: string;
  imageId: string;
  projectId: string;
  model: string;
  threshold: number;
  priority: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface QueueStats {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface AddToQueueResponse {
  queueItem: QueueItem;
  message: string;
}

export interface BatchQueueResponse {
  queuedCount: number;
  queueItems: QueueItem[];
  message: string;
}

class ApiClient {
  private instance: AxiosInstance;
  private baseURL: string;

  constructor(baseURL: string = config.apiBaseUrl) {
    this.baseURL = baseURL;
    this.instance = axios.create({
      baseURL,
      timeout: TIMEOUTS.API_DEFAULT,
      headers: {
        'Content-Type': 'application/json',
      },
      // Send the httpOnly auth cookies on every request. This is the only
      // transport for the access/refresh tokens since the cookie cutover —
      // there is no Authorization header any more.
      withCredentials: true,
    });

    // Response interceptor to handle token refresh
    this.instance.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;

        // Don't try to refresh tokens for auth endpoints (login, register, refresh)
        const isAuthEndpoint =
          originalRequest?.url?.includes('/auth/login') ||
          originalRequest?.url?.includes('/auth/register') ||
          originalRequest?.url?.includes('/auth/refresh');

        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          !isAuthEndpoint
        ) {
          originalRequest._retry = true;

          // The init profile probe sets `X-Suppress-Auth-Events` so a
          // stale-hint/expired session on cold load is handled silently — no
          // "session expired" toast, no redirect, and the failed-refresh is a
          // debug log, not an error (it's an expected outcome there, not a bug).
          const suppressAuthEvents =
            originalRequest?.headers?.['X-Suppress-Auth-Events'] === '1';

          try {
            // The httpOnly refresh_token cookie is sent automatically; this
            // re-mints the access_token cookie. No token handling here.
            logger.debug('🔄 Attempting token refresh...');
            await this.refreshAccessToken();
            // Retry the original request — the new access_token cookie rides
            // along automatically.
            return this.instance(originalRequest);
          } catch (refreshError) {
            if (suppressAuthEvents) {
              logger.debug(
                'Token refresh failed during init probe',
                refreshError
              );
            } else {
              logger.error(
                'Token refresh failed, forcing logout:',
                refreshError
              );
            }
            // Fall through to signed-out handling below.
          }

          // Refresh failed → the session is unrecoverable.
          //
          // Note: this is reached for the POST /export/.../download-token
          // endpoint too. A previous version of this file tried to
          // special-case that endpoint to avoid logging the user out on
          // export failures, but that caused an infinite-loop bug: the
          // useSharedAdvancedExport hook would retry forever because its
          // useEffect re-fires whenever the download state changes, and
          // there was no auth-driven unmount to break the loop.
          if (!suppressAuthEvents) {
            logger.debug('🔒 Authentication failed - signing out');
            this.handleSignedOut();
          }

          return Promise.reject(error);
        }

        // Handle retryable errors (429, 502, 503, 504) with unified retry system
        const retryableStatuses = [429, 502, 503, 504];
        if (
          error.response?.status &&
          retryableStatuses.includes(error.response.status)
        ) {
          const status = error.response.status;
          const result = await retryWithBackoff(
            () => this.instance(originalRequest),
            {
              ...RETRY_CONFIGS.api,
              shouldRetry: (err, attempt) => {
                const errorWithResponse = err as {
                  response?: { status: number };
                };
                return (
                  retryableStatuses.includes(
                    errorWithResponse.response?.status || 0
                  ) && attempt < 3
                );
              },
              onRetry: (err, attempt, nextDelay) => {
                const statusText =
                  {
                    429: 'Rate limited',
                    502: 'Bad gateway',
                    503: 'Service unavailable',
                    504: 'Gateway timeout',
                  }[status] || 'Server error';

                logger.warn(
                  `🔄 ${statusText} (${status}), retrying in ${Math.round(nextDelay)}ms (attempt ${attempt}/3)`
                );
              },
            }
          );

          if (result.success) {
            return result.data;
          }
          throw result.error;
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Surface a signed-out state when the session is unrecoverable (a 401 that
   * even a token refresh couldn't fix). The server already cleared/expired
   * the auth cookies; here we just notify the app and route to sign-in.
   * Cookies are httpOnly, so there is nothing for the client to clear.
   */
  private handleSignedOut(): void {
    if (typeof window === 'undefined') {
      return;
    }

    import('./authEvents')
      .then(({ authEventEmitter }) => {
        authEventEmitter.emit({
          type: 'token_expired',
          data: {
            message: 'Session expired',
            description: 'Your session has expired. Please sign in again.',
          },
        });
      })
      .catch(err => {
        logger.error('Failed to emit auth event', err);
      });

    if (
      window.location.pathname !== '/sign-in' &&
      window.location.pathname !== '/sign-up' &&
      !window.location.pathname.startsWith('/public') &&
      !window.location.pathname.startsWith('/share')
    ) {
      setTimeout(() => {
        window.location.replace('/sign-in');
      }, 50);
    }
  }

  // Auth methods
  /**
   * Authenticates a user with email and password
   * @param {string} email - User's email address
   * @param {string} password - User's password
   * @param {boolean} rememberMe - Whether to persist the session (controls
   *   the refresh-cookie Max-Age server-side)
   * @returns {Promise<AuthResponse>} The authenticated user (tokens are set
   *   as httpOnly cookies by the server, not returned in the body)
   * @throws {Error} If authentication fails or network error occurs
   * @example
   * const response = await apiClient.login('user@example.com', 'securePass123', true);
   */
  async login(
    email: string,
    password: string,
    rememberMe: boolean = true
  ): Promise<AuthResponse> {
    const response = await this.instance.post('/auth/login', {
      email,
      password,
      rememberMe,
    });

    // The server set the access/refresh tokens as httpOnly cookies. The body
    // carries only the user — there are no tokens to extract or store.
    const backendData = response.data.data || response.data;
    const { user } = backendData;

    return { user };
  }

  /**
   * Registers a new user account
   * @param {RegisterRequest} request - Registration details
   * @param {string} request.email - User's email address
   * @param {string} request.password - User's password
   * @param {string} [request.username] - Optional username
   * @param {boolean} [request.consentToMLTraining] - Consent for ML training
   * @returns {Promise<AuthResponse>} The newly registered user (tokens are
   *   set as httpOnly cookies by the server, not returned in the body)
   * @throws {Error} If registration fails or email already exists
   * @example
   * const response = await apiClient.register({
   *   email: 'newuser@example.com',
   *   password: 'securePass123',
   *   username: 'newuser'
   * });
   */
  async register(
    email: string,
    password: string,
    username?: string,
    consentOptions?: {
      consentToMLTraining?: boolean;
      consentToAlgorithmImprovement?: boolean;
      consentToFeatureDevelopment?: boolean;
    }
  ): Promise<AuthResponse> {
    const response = await this.instance.post('/auth/register', {
      email,
      password,
      username,
      ...consentOptions,
    });

    // Registration logs the user in via httpOnly cookies set by the server.
    // The body carries only the user.
    const backendData = response.data.data || response.data;
    const { user } = backendData;

    return { user };
  }

  async logout(): Promise<void> {
    try {
      // The refresh_token cookie is sent automatically; the server revokes
      // the session and clears both auth cookies via Set-Cookie.
      await this.instance.post('/auth/logout');
    } catch (error) {
      logger.error('Logout error:', error);
    }
  }

  private refreshPromise: Promise<void> | null = null;

  async refreshAccessToken(): Promise<void> {
    // Deduplicate concurrent refresh attempts — all callers share one in-flight request
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async _doRefresh(): Promise<void> {
    // The backend route is /auth/refresh-token (see authRoutes.ts). A
    // stale /auth/refresh URL used to fall through to the `router.use(
    // authenticate)` catch-all below the POST routes, which returned 401
    // because the request carried an already-expired access token —
    // meaning the refresh flow was permanently broken and every
    // mid-session token expiry forced a full logout. Use the canonical
    // path. The backend also keeps a /refresh alias for safety.
    //
    // The refresh_token cookie (Path=/api/auth) is sent automatically; the
    // server rotates it and re-mints the access_token cookie via Set-Cookie.
    // There is nothing to read from the response body. A 401 here (missing or
    // expired refresh cookie) rejects, which the response interceptor treats
    // as an unrecoverable session.
    await this.instance.post('/auth/refresh-token');
  }

  async uploadAvatar(
    imageFile: File,
    cropData?: { x: number; y: number; width: number; height: number }
  ): Promise<{ avatarUrl: string; message: string }> {
    // Validate cropData dimensions if provided
    if (cropData) {
      if (cropData.width <= 0 || cropData.height <= 0) {
        throw new Error(
          'Invalid crop dimensions: width and height must be positive'
        );
      }
      if (cropData.x < 0 || cropData.y < 0) {
        throw new Error('Invalid crop position: x and y must be non-negative');
      }
    }

    const formData = new FormData();
    formData.append('image', imageFile);
    if (cropData) {
      formData.append('cropData', JSON.stringify(cropData));
    }

    const response = await this.instance.post('/auth/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return this.extractData(response);
  }

  /**
   * Submit an in-app bug report or feature request. The optional
   * `attachment` is sent as multipart/form-data; backend caps it at
   * 5 MB and image/png|jpeg.
   */
  async submitFeedback(
    data: { type: 'bug' | 'feature'; title: string; body: string },
    attachment?: File,
    onUploadProgress?: (progressPercent: number) => void
  ): Promise<{
    id: string;
    emailQueued: boolean;
    attachmentStored?: boolean;
  }> {
    const formData = new FormData();
    formData.append('type', data.type);
    formData.append('title', data.title);
    formData.append('body', data.body);
    if (attachment) {
      // Normalize the filename (NFC) so accented characters survive the
      // multipart boundary — same guard as uploadVideo.
      const normalizedName = attachment.name.normalize('NFC');
      const payload =
        normalizedName !== attachment.name
          ? new File([attachment], normalizedName, {
              type: attachment.type,
              lastModified: attachment.lastModified,
            })
          : attachment;
      formData.append('attachment', payload);
    }

    const response = await this.instance.post('/feedback', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // The attachment can be a multi-GB video/ND2 that takes a long time
      // to push over the wire — disable the client timeout (0 = no timeout)
      // so a slow but healthy upload isn't aborted mid-stream.
      timeout: 0,
      onUploadProgress: progressEvent => {
        if (onUploadProgress && progressEvent.total) {
          onUploadProgress(
            Math.round((progressEvent.loaded * 100) / progressEvent.total)
          );
        }
      },
    });

    return this.extractData(response);
  }

  // Helper method to extract data from backend response structure
  private extractData<T>(
    response: AxiosResponse<{ success: boolean; data: T; message?: string } | T>
  ): T {
    // Handle backend response structure: { success: true, data: actualData }
    const responseData = response.data as unknown;
    if (
      responseData &&
      typeof responseData === 'object' &&
      'success' in responseData &&
      'data' in responseData
    ) {
      return (responseData as { success: boolean; data: T; message?: string })
        .data;
    }
    // Fallback for direct data responses
    return response.data as T;
  }

  // Helper method to map backend project fields to frontend expectations
  private mapProjectFields(project: Record<string, unknown>): Project {
    // Defensive: validate type against the known enum, default to 'spheroid'
    // for legacy records or corrupt rows.
    const typeValue: ProjectType = isProjectType(project.type)
      ? project.type
      : 'spheroid';

    const result: Project = {
      id: project.id as string,
      name: (project.title as string) || (project.name as string), // Map title -> name
      description: project.description as string | undefined,
      type: typeValue,
      created_at:
        (project.createdAt as string) || (project.created_at as string),
      updated_at:
        (project.updatedAt as string) || (project.updated_at as string),
      user_id: (project.userId as string) || (project.user_id as string),
    };

    // Add optional fields only if they exist
    const imageCount =
      (project.imageCount as number) ||
      (project._count as { images?: number })?.images;
    if (imageCount !== undefined) {
      result.image_count = imageCount;
    }

    // Per-user folder placement. Backend returns `folderId: string | null`
    // on each project; the FE always reads the canonical camelCase name. We
    // explicitly copy `null` (not just truthy values) so callers can
    // distinguish "at root" (folderId === null) from "not loaded yet"
    // (folderId === undefined).
    if (project.folderId !== undefined) {
      result.folderId = (project.folderId as string | null) ?? null;
    }

    return result;
  }

  // Helper method to map multiple projects
  private mapProjectsFields(projects: Record<string, unknown>[]): Project[] {
    return projects.map(project => this.mapProjectFields(project));
  }

  // Helper method to map segmentation status values
  private mapSegmentationStatus(status: unknown): SegmentationStatus {
    // Safely coerce to string
    const statusStr =
      typeof status === 'string' ? status : String(status || '');

    // Map known backend statuses to frontend expectations
    switch (statusStr) {
      case 'no_segmentation':
      case 'queued':
        return 'pending';
      case 'segmented':
        return 'completed';
      case 'pending':
      case 'processing':
      case 'completed':
      case 'failed':
        return statusStr;
      case 'no_polygons':
        return 'completed';
      default:
        // Log unexpected values and return safe default
        if (process.env.NODE_ENV === 'development') {
          logger.warn('Unexpected segmentation status from backend:', status);
        }
        return 'failed';
    }
  }

  // Helper method to map backend image fields to frontend expectations
  private mapImageFields(image: Record<string, unknown>): ProjectImageDTO {
    let imageUrl =
      (image.originalUrl as string) || (image.image_url as string) || '';
    let thumbnailUrl =
      (image.thumbnailUrl as string) || (image.thumbnail_url as string);
    // Generate display URL using the image ID for browser-compatible endpoint
    const imageId = image.id as string;
    let displayUrl = imageId ? `/api/images/${imageId}/display` : imageUrl;

    // Ensure URLs are absolute for Docker environment
    const ensureAbsoluteUrl = (url: string): string => {
      if (!url) return url;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      // Ensure the URL starts with /uploads/ prefix for image URLs
      if (!url.startsWith('/uploads/') && !url.startsWith('/api/')) {
        url = `/uploads/${url}`;
      }
      // If it's a relative URL, prepend the base URL
      const baseUrl = this.baseURL.replace('/api', '');
      return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
    };

    imageUrl = ensureAbsoluteUrl(imageUrl);
    thumbnailUrl = thumbnailUrl ? ensureAbsoluteUrl(thumbnailUrl) : imageUrl;
    displayUrl = ensureAbsoluteUrl(displayUrl);

    // Get segmentation thumbnail fields
    const segmentationThumbnailPath = image.segmentationThumbnailPath as
      | string
      | undefined;
    const segmentationThumbnailUrl = segmentationThumbnailPath
      ? ensureAbsoluteUrl(segmentationThumbnailPath)
      : (image.segmentationThumbnailUrl as string | undefined);

    return {
      id: image.id as string,
      name: image.name as string,
      project_id: (image.projectId as string) || (image.project_id as string),
      user_id: (image.userId as string) || (image.user_id as string),
      url: displayUrl, // Use displayUrl for browser compatibility
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      displayUrl: displayUrl, // Explicit display URL field
      width: typeof image.width === 'number' ? image.width : null,
      height: typeof image.height === 'number' ? image.height : null,
      segmentation_status: this.mapSegmentationStatus(
        image.segmentationStatus || image.segmentation_status
      ),
      segmentationThumbnailPath: segmentationThumbnailPath,
      segmentationThumbnailUrl: segmentationThumbnailUrl,
      created_at: (image.createdAt as string) || (image.created_at as string),
      updated_at: (image.updatedAt as string) || (image.updated_at as string),
    };
  }

  // Helper method to map multiple images
  private mapImagesFields(
    images: Record<string, unknown>[]
  ): ProjectImageDTO[] {
    return images.map(image => this.mapImageFields(image));
  }

  // Project methods
  async getProjects(params?: {
    page?: number;
    limit?: number;
    search?: string;
    // "root" filters to projects without any folder placement; a uuid filters
    // to a specific folder owned by the caller; undefined means no filter.
    folderId?: string | 'root';
    _t?: number; // Cache-busting timestamp
  }): Promise<{
    projects: Project[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await this.instance.get('/projects', { params });
    const fullResponse = response.data;

    // Backend returns: { success: true, data: [...], pagination: {...} }
    // Frontend expects: { projects: [...], total: x, page: x, totalPages: x }
    if (
      fullResponse &&
      fullResponse.success &&
      fullResponse.data &&
      fullResponse.pagination
    ) {
      return {
        projects: this.mapProjectsFields(fullResponse.data),
        total: fullResponse.pagination.total,
        page: fullResponse.pagination.page,
        totalPages: fullResponse.pagination.totalPages,
      };
    }

    // Fallback for other response formats
    const data = this.extractData(response);

    // Handle null/undefined data safely
    if (!data) {
      return {
        projects: [],
        total: 0,
        page: 1,
        totalPages: 1,
      };
    }

    // Handle array data directly
    if (Array.isArray(data)) {
      return {
        projects: this.mapProjectsFields(data),
        total: data.length,
        page: 1,
        totalPages: 1,
      };
    }

    // Handle object data
    const dataProjects = data.projects || [];
    return {
      projects: this.mapProjectsFields(
        Array.isArray(dataProjects) ? dataProjects : []
      ),
      total:
        data.total || (Array.isArray(dataProjects) ? dataProjects.length : 0),
      page: data.page || 1,
      totalPages: data.totalPages || 1,
    };
  }

  /**
   * Creates a new project
   * @param {string} name - Project name
   * @param {string} [description] - Optional project description
   * @returns {Promise<Project>} The created project object
   * @throws {Error} If project creation fails or user is not authenticated
   * @example
   * const project = await apiClient.createProject('Cell Analysis', 'Research project for cell segmentation');
   */
  async createProject(data: {
    name: string;
    description?: string;
    type?: import('@/types').ProjectType;
  }): Promise<Project> {
    // Convert 'name' to 'title' to match backend validation schema
    const requestData = {
      title: data.name,
      description: data.description,
      type: data.type,
    };
    const response = await this.instance.post('/projects', requestData);
    const project = this.extractData(response);
    return this.mapProjectFields(project);
  }

  async getProject(id: string): Promise<Project> {
    const response = await this.instance.get(`/projects/${id}`);
    const project = this.extractData(response);
    return this.mapProjectFields(project);
  }

  async updateProject(
    id: string,
    data: {
      name?: string;
      description?: string;
      type?: import('@/types').ProjectType;
    }
  ): Promise<Project> {
    // Convert 'name' to 'title' if provided
    const requestData = {
      ...data,
      title: data.name || undefined,
      name: undefined, // Remove name to avoid backend confusion
    };
    const response = await this.instance.put(`/projects/${id}`, requestData);
    const project = this.extractData(response);
    return this.mapProjectFields(project);
  }

  async deleteProject(id: string): Promise<void> {
    await this.instance.delete(`/projects/${id}`);
  }

  // ---- Project folders --------------------------------------------------
  //
  // Folder tree is per-user (a placement of A's project in B's folder is B's
  // organisation only and never visible to A). All endpoints require auth.

  async getFolders(): Promise<import('@/types').ProjectFolder[]> {
    const response = await this.instance.get('/folders');
    const folders = this.extractData<unknown>(response);
    return Array.isArray(folders)
      ? (folders as import('@/types').ProjectFolder[])
      : [];
  }

  async createFolder(data: {
    name: string;
    parentId?: string | null;
  }): Promise<import('@/types').ProjectFolder> {
    const response = await this.instance.post('/folders', data);
    return this.extractData<import('@/types').ProjectFolder>(response);
  }

  async updateFolder(
    id: string,
    patch: { name?: string; parentId?: string | null }
  ): Promise<import('@/types').ProjectFolder> {
    const response = await this.instance.patch(`/folders/${id}`, patch);
    return this.extractData<import('@/types').ProjectFolder>(response);
  }

  async deleteFolder(id: string): Promise<{
    folderDeleted: boolean;
    deletedProjectIds: string[];
    unlinkedSharedProjectIds: string[];
    failedProjectIds: { id: string; error: string }[];
  }> {
    // Server returns 200 on full success and 207 on partial (some projects
    // failed to delete; folder kept in place). axios accepts both as
    // success by default. Either way the wire payload carries the
    // structured DeleteFolderResult; we extract from `data` (200) or read
    // directly from response.data (207 wraps it differently).
    const response = await this.instance.delete(`/folders/${id}`, {
      validateStatus: s => (s >= 200 && s < 300) || s === 207,
    });
    if (response.status === 207) {
      // 207 envelope: { success: false, message, data: DeleteFolderResult }
      return response.data?.data ?? response.data;
    }
    return this.extractData(response);
  }

  async previewFolder(id: string): Promise<{
    folderId: string;
    ownedProjectCount: number;
    sharedProjectCount: number;
    subfolderCount: number;
  }> {
    const response = await this.instance.get(`/folders/${id}/preview`);
    return this.extractData(response);
  }

  /** Move a set of projects into `folderId` (or `null` to send back to root). */
  async moveProjectsToFolder(
    folderId: string | null,
    projectIds: string[]
  ): Promise<{ movedProjectIds: string[]; skippedProjectIds: string[] }> {
    const path =
      folderId === null ? '/folders/root/items' : `/folders/${folderId}/items`;
    const response = await this.instance.post(path, { projectIds });
    return this.extractData(response);
  }
  // ----------------------------------------------------------------------

  // Sharing methods
  async shareProjectByEmail(
    projectId: string,
    data: { email: string }
  ): Promise<{
    id: string;
    email: string;
    status: string;
    createdAt: string;
  }> {
    const response = await this.instance.post(
      `/projects/${projectId}/share/email`,
      data
    );
    return this.extractData(response);
  }

  async shareProjectByLink(
    projectId: string,
    data: { expiryHours?: number } = {}
  ): Promise<{
    id: string;
    shareToken: string;
    shareUrl: string;
    tokenExpiry: string | null;
    createdAt: string;
  }> {
    const response = await this.instance.post(
      `/projects/${projectId}/share/link`,
      data
    );
    return this.extractData(response);
  }

  async getProjectShares(projectId: string): Promise<
    Array<{
      id: string;
      email: string | null;
      sharedWith: { id: string; email: string } | null;
      status: string;
      shareToken: string;
      shareUrl: string;
      tokenExpiry: string | null;
      createdAt: string;
    }>
  > {
    const response = await this.instance.get(`/projects/${projectId}/shares`);
    return this.extractData(response);
  }

  async revokeProjectShare(projectId: string, shareId: string): Promise<void> {
    await this.instance.delete(`/projects/${projectId}/shares/${shareId}`);
  }

  async getSharedProjects(params?: {
    _t?: number; // Cache-busting timestamp
  }): Promise<
    Array<{
      id: string;
      title: string;
      description: string | null;
      createdAt: string;
      updatedAt: string;
      owner: { id: string; email: string };
      share: { id: string; status: string; sharedAt: string };
      isShared: true;
    }>
  > {
    const response = await this.instance.get('/shared/projects', { params });
    return this.extractData(response);
  }

  async validateShareToken(token: string): Promise<{
    project: { id: string; title: string; description: string | null };
    sharedBy: { email: string };
    status: string;
    email: string | null;
    needsLogin: boolean;
  }> {
    const response = await this.instance.get(`/share/validate/${token}`);
    return this.extractData(response);
  }

  async acceptShareInvitation(token: string): Promise<{
    project: { id: string; title: string; description: string | null };
    sharedBy?: { email: string };
    needsLogin: boolean;
    accepted?: boolean;
  }> {
    const response = await this.instance.post(`/share/accept/${token}`);
    return this.extractData(response);
  }

  // Image methods
  /**
   * Get project images with optimized thumbnail data
   */
  async getProjectImagesWithThumbnails(
    projectId: string,
    params?: {
      page?: number;
      limit?: number;
      lod?: 'low' | 'medium' | 'high';
    }
  ): Promise<{
    images: ProjectImageDTO[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
    metadata: {
      levelOfDetail: 'low' | 'medium' | 'high';
      totalImages: number;
      imagesWithThumbnails: number;
      // Distinct channels across all video containers in this project.
      // Empty for non-video projects. Drives the Segment-All channel picker.
      projectChannels?: string[];
    };
  }> {
    const response = await this.instance.get(
      `/projects/${projectId}/images-with-thumbnails`,
      {
        params: {
          lod: 'low',
          ...params,
        },
      }
    );
    return response.data.data;
  }

  /**
   * Reorder images within a project (used for wound-healing time-series view).
   * The order of ``imageIds`` in the array sets ``displayOrder``: index 0 →
   * displayOrder 0, index 1 → 1, etc. The backend applies the change in a
   * single transaction.
   */
  async reorderProjectImages(
    projectId: string,
    imageIds: string[]
  ): Promise<void> {
    await this.instance.patch(`/projects/${projectId}/images/reorder`, {
      imageIds,
    });
  }

  async getProjectImages(
    projectId: string,
    params?: { page?: number; limit?: number }
  ): Promise<{
    images: ProjectImageDTO[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await this.instance.get(`/projects/${projectId}/images`, {
      params,
    });
    const data = this.extractData(response);

    // Ensure consistent response structure with defaults
    if (
      data &&
      typeof data === 'object' &&
      'images' in data &&
      'pagination' in data
    ) {
      const typedData = data as {
        images: Record<string, unknown>[];
        pagination: { total: number; page: number; totalPages: number };
      };
      return {
        images: this.mapImagesFields(typedData.images || []),
        total: typedData.pagination?.total || 0,
        page: typedData.pagination?.page || 1,
        totalPages: typedData.pagination?.totalPages || 1,
      };
    }

    // Fallback for unexpected response structure
    return {
      images: [],
      total: 0,
      page: 1,
      totalPages: 1,
    };
  }

  /**
   * Uploads multiple images to a project
   * @param {string} projectId - The project ID to upload images to
   * @param {FileList | File[]} files - Array or FileList of image files to upload
   * @param {Function} [onProgress] - Optional callback for upload progress
   * @returns {Promise<ProjectImageDTO[]>} Array of uploaded image objects
   * @throws {Error} If upload fails or files are invalid
   * @example
   * const images = await apiClient.uploadImages(
   *   'project-123',
   *   fileInput.files,
   *   (progress) => logger.info(`Upload progress: ${progress}%`)
   * );
   */
  async uploadImages(
    projectId: string,
    files: File[],
    onProgress?: (progressPercent: number) => void
  ): Promise<ProjectImageDTO[]> {
    const formData = new FormData();
    files.forEach(file => {
      // Normalize filename to NFC to ensure diacritics are properly composed
      // This prevents issues with decomposed Unicode (NFD) filenames
      const normalizedName = file.name.normalize('NFC');

      // If the filename needs normalization, create a new File with the normalized name
      // Otherwise, use the original file
      if (normalizedName !== file.name) {
        const normalizedFile = new File([file], normalizedName, {
          type: file.type,
          lastModified: file.lastModified,
        });
        formData.append('images', normalizedFile);
      } else {
        formData.append('images', file);
      }
    });

    const response = await this.instance.post(
      `/projects/${projectId}/images`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: TIMEOUTS.FILE_UPLOAD_LARGE,
        onUploadProgress: progressEvent => {
          if (onProgress && progressEvent.total) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            onProgress(percentCompleted);
          }
        },
      }
    );

    const data = this.extractData(response);

    // Backend returns { images: [...], count: number }, extract the images array
    if (data && typeof data === 'object' && 'images' in data) {
      const typedData = data as {
        images: Record<string, unknown>[];
        count: number;
      };
      return this.mapImagesFields(typedData.images || []);
    }

    // Fallback if response structure is unexpected
    return Array.isArray(data) ? this.mapImagesFields(data) : [];
  }

  /**
   * Uploads a single video / multi-page TIFF / ND2 stack to a project.
   *
   * Routes to POST /projects/:id/videos (separate multer with 100 GB cap +
   * server-side ffmpeg / nd2 / tifffile extraction). One file per call;
   * callers wanting to upload multiple videos should loop.
   *
   * Returns the backend's container-creation response so callers can
   * surface the frame count and channel list in the UI.
   */
  async uploadVideo(
    projectId: string,
    file: File,
    onProgress?: (progressPercent: number) => void
  ): Promise<{
    videoContainerId: string;
    frameCount: number;
    channels: Array<{
      name: string;
      type: 'irm' | 'fluorescent';
      wavelengthNm?: number;
      displayColor?: string;
      isSegmentationSource: boolean;
    }>;
  }> {
    const formData = new FormData();
    const normalizedName = file.name.normalize('NFC');
    const payload =
      normalizedName !== file.name
        ? new File([file], normalizedName, {
            type: file.type,
            lastModified: file.lastModified,
          })
        : file;
    formData.append('video', payload);

    const response = await this.instance.post(
      `/projects/${projectId}/videos`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Transfer + server-side extraction must both fit in this one request.
        // Scale the timeout to the file size (a fixed 20-min cap was timing out
        // multi-GB ND2 uploads mid-transfer); small clips still get a 20-min
        // floor, huge files up to a 4-hour ceiling.
        timeout: videoUploadTimeoutMs(payload.size),
        onUploadProgress: progressEvent => {
          if (onProgress && progressEvent.total) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            onProgress(percentCompleted);
          }
        },
      }
    );
    return this.extractData(response) as never;
  }

  /**
   * Uploads multiple images to a project using chunking for large batches
   * @param {string} projectId - The project ID to upload images to
   * @param {File[]} files - Array of image files to upload
   * @param {Function} [onProgress] - Optional callback for upload progress
   * @param {Function} [onChunkProgress] - Optional callback for chunk-level progress
   * @returns {Promise<ChunkedUploadResult<ProjectImageDTO[]>>} Chunked upload results
   * @throws {Error} If upload fails or files are invalid
   * @example
   * const result = await apiClient.uploadImagesChunked(
   *   'project-123',
   *   fileArray,
   *   (progress) => logger.info(`Overall progress: ${progress}%`),
   *   (chunkProgress) => logger.info(`Chunk ${chunkProgress.chunkIndex + 1}: ${chunkProgress.chunkProgress}%`)
   * );
   */
  async uploadImagesChunked(
    projectId: string,
    files: File[],
    onProgress?: (progressPercent: number) => void,
    onChunkProgress?: (progress: ChunkProgress) => void,
    signal?: AbortSignal
  ): Promise<ChunkedUploadResult<ProjectImageDTO[]>> {
    logger.info(
      `Starting chunked upload of ${files.length} files to project ${projectId}`
    );

    // Validate files first
    const validation = validateFiles(files);
    if (validation.invalid.length > 0) {
      logger.warn(
        `${validation.invalid.length} files failed validation:`,
        validation.invalid.map(v => `${v.file.name}: ${v.reason}`)
      );
    }

    const validFiles = validation.valid;
    if (validFiles.length === 0) {
      throw new Error('No valid files to upload');
    }

    // If we have a small number of files, use regular upload
    if (validFiles.length <= DEFAULT_CHUNKING_CONFIG.chunkSize) {
      logger.info(
        `Using regular upload for ${validFiles.length} files (under chunk limit)`
      );
      try {
        const result = await this.uploadImages(
          projectId,
          validFiles,
          onProgress
        );
        return {
          success: [result],
          failed: [],
          totalProcessed: validFiles.length,
        };
      } catch (error) {
        return {
          success: [],
          failed: [
            {
              files: validFiles,
              error: error as Error,
              chunkIndex: 0,
            },
          ],
          totalProcessed: 0,
        };
      }
    }

    // Split files into chunks
    const chunks = chunkFiles(validFiles, DEFAULT_CHUNKING_CONFIG.chunkSize);
    logger.info(
      `Split ${validFiles.length} files into ${chunks.length} chunks`
    );

    // Track overall progress
    let overallProgress = 0;
    const updateOverallProgress = (chunkProgress: ChunkProgress) => {
      overallProgress = chunkProgress.overallProgress;
      if (onProgress) {
        onProgress(overallProgress);
      }
      if (onChunkProgress) {
        onChunkProgress(chunkProgress);
      }
    };

    // Process chunks
    const result = await processChunksWithConcurrency(
      chunks,
      async (chunk: File[], chunkIndex: number) => {
        // Check if upload was cancelled
        if (signal?.aborted) {
          throw new Error('Upload cancelled by user');
        }

        logger.debug(
          `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} files`
        );

        // Create FormData for this chunk
        const formData = new FormData();
        chunk.forEach(file => {
          // Normalize filename to NFC to ensure diacritics are properly composed
          // This prevents issues with decomposed Unicode (NFD) filenames
          const normalizedName = file.name.normalize('NFC');

          // If the filename needs normalization, create a new File with the normalized name
          // Otherwise, use the original file
          if (normalizedName !== file.name) {
            const normalizedFile = new File([file], normalizedName, {
              type: file.type,
              lastModified: file.lastModified,
            });
            formData.append('images', normalizedFile);
          } else {
            formData.append('images', file);
          }
        });

        const response = await this.instance.post(
          `/projects/${projectId}/images`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            signal: signal, // Add abort signal support
            timeout: TIMEOUTS.FILE_UPLOAD_LARGE,
            onUploadProgress: progressEvent => {
              if (progressEvent.total) {
                const chunkProgressPercent = Math.round(
                  (progressEvent.loaded * 100) / progressEvent.total
                );

                // Calculate overall progress including current chunk progress
                const overallProgressValue = Math.round(
                  ((chunkIndex + chunkProgressPercent / 100) / chunks.length) *
                    100
                );

                // Create chunk progress data
                const chunkProgressData: ChunkProgress = {
                  chunkIndex,
                  totalChunks: chunks.length,
                  filesInChunk: chunk.length,
                  totalFiles: validFiles.length,
                  chunkProgress: chunkProgressPercent,
                  overallProgress: overallProgressValue,
                  currentOperation: `Uploading chunk ${chunkIndex + 1} of ${chunks.length}`,
                };

                // Update both overall and chunk progress
                updateOverallProgress(chunkProgressData);
              }
            },
          }
        );

        const data = this.extractData(response);

        // Extract images from backend response
        if (data && typeof data === 'object' && 'images' in data) {
          const typedData = data as {
            images: Record<string, unknown>[];
            count: number;
          };
          return this.mapImagesFields(typedData.images || []);
        }

        return Array.isArray(data) ? this.mapImagesFields(data) : [];
      },
      DEFAULT_CHUNKING_CONFIG,
      updateOverallProgress
    );

    // Log results
    const successfulUploads = result.success.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    );
    const failedUploads = result.failed.reduce(
      (sum, failure) => sum + failure.files.length,
      0
    );

    logger.info(
      `Chunked upload completed: ${successfulUploads} successful, ${failedUploads} failed`
    );

    if (result.failed.length > 0) {
      logger.warn(
        'Failed chunks:',
        result.failed.map(f => ({
          chunkIndex: f.chunkIndex,
          fileCount: f.files.length,
          error: f.error.message,
        }))
      );
    }

    return result;
  }

  async getImage(projectId: string, imageId: string): Promise<ProjectImageDTO> {
    const response = await this.instance.get(
      `/projects/${projectId}/images/${imageId}`
    );
    const data = this.extractData(response);

    // Handle backend response structure { image: {...} }
    if (data && typeof data === 'object' && 'image' in data) {
      const typedData = data as { image: Record<string, unknown> };
      return this.mapImageFields(typedData.image);
    }

    return this.mapImageFields(data);
  }

  async deleteImage(projectId: string, imageId: string): Promise<void> {
    await this.instance.delete(`/projects/${projectId}/images/${imageId}`);
  }

  // Segmentation methods
  async requestBatchSegmentation(
    imageIds: string[],
    model?: string,
    threshold?: number,
    detectHoles?: boolean,
    // Channel override for multi-channel video frames. Forwarded to
    // backend's `resolveChannelPath` so a TIRF_640 / TIRF_488 ND2
    // frame gets segmented on the user-picked channel instead of the
    // project's default `isSegmentationSource`.
    channel?: string
  ): Promise<BatchSegmentationResult> {
    const response = await this.instance.post(`/segmentation/batch`, {
      imageIds,
      model: model || 'hrnet',
      threshold: threshold || 0.5,
      detectHoles: detectHoles,
      ...(channel ? { channel } : {}),
    });
    return this.extractData(response);
  }

  /**
   * Retrieves segmentation results for an image
   * @param {string} projectId - The project ID
   * @param {string} imageId - The image ID
   * @returns {Promise<SegmentationResult>} Segmentation polygons and metadata
   * @throws {Error} If segmentation results not found or request fails
   * @example
   * const results = await apiClient.getSegmentationResults('project-123', 'image-456');
   * logger.info(`Found ${results.polygons.length} segmented cells`);
   */
  async getSegmentationResults(
    imageId: string,
    options?: { signal?: AbortSignal }
  ): Promise<SegmentationResultData | null> {
    try {
      const response = await this.instance.get(
        `/segmentation/images/${imageId}/results`,
        { signal: options?.signal }
      );
      const data = this.extractData(response);

      // If it's just an array of polygons (backward compatibility — check before object test
      // since arrays also satisfy typeof data === 'object')
      if (Array.isArray(data)) {
        return {
          polygons: data,
        };
      }

      // Return the full segmentation result data as received from backend
      if (data && typeof data === 'object') {
        // Ensure we have the required structure
        const result: SegmentationResultData = {
          polygons: Array.isArray(data.polygons) ? data.polygons : [],
          imageWidth: data.imageWidth,
          imageHeight: data.imageHeight,
          modelUsed: data.modelUsed,
          thresholdUsed: data.thresholdUsed,
          confidence: data.confidence,
          processingTime: data.processingTime,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
        return result;
      }

      return null;
    } catch (error) {
      if (
        (error as { response?: { status?: number } })?.response?.status === 404
      ) {
        return null; // No segmentation exists yet
      }
      throw error;
    }
  }

  /**
   * Batch fetch segmentation results for multiple images
   * Performance optimization: Fetches all results in a single API call
   * @param imageIds Array of image IDs to fetch segmentation for
   * @returns Map of imageId to segmentation results
   */
  async getBatchSegmentationResults(
    imageIds: string[]
  ): Promise<Record<string, SegmentationResultData | null>> {
    try {
      // Validate input
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        logger.warn(
          'getBatchSegmentationResults called with invalid imageIds:',
          imageIds
        );
        return {};
      }
      // Batch requests in chunks of 500 to avoid overwhelming the server
      const BATCH_SIZE = 500;
      const results: Record<string, SegmentationResultData | null> = {};

      for (let i = 0; i < imageIds.length; i += BATCH_SIZE) {
        const chunk = imageIds.slice(i, i + BATCH_SIZE);

        const response = await this.instance.post(
          '/segmentation/batch/results',
          { imageIds: chunk }
        );

        const batchData = this.extractData<Record<string, any>>(response);

        // Process each result in the batch
        for (const [imageId, data] of Object.entries(batchData)) {
          if (!data) {
            results[imageId] = null;
            continue;
          }

          results[imageId] = {
            polygons: data.polygons || [],
            imageWidth: data.imageWidth,
            imageHeight: data.imageHeight,
            modelUsed: data.modelUsed,
            confidence: data.confidence,
            processingTime: data.processingTime,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to batch fetch segmentation results', error);
      throw error;
    }
  }

  async updateSegmentationResults(
    imageId: string,
    polygons: SegmentationPolygon[],
    imageWidth?: number,
    imageHeight?: number
  ): Promise<SegmentationResultData> {
    const payload: any = { polygons };

    // Include image dimensions if provided and valid
    if (
      imageWidth &&
      imageHeight &&
      typeof imageWidth === 'number' &&
      typeof imageHeight === 'number' &&
      imageWidth > 0 &&
      imageHeight > 0
    ) {
      payload.imageWidth = imageWidth;
      payload.imageHeight = imageHeight;
    }

    const response = await this.instance.put(
      `/segmentation/images/${imageId}/results`,
      payload
    );
    const data = this.extractData(response);

    // Return the full segmentation result data
    if (data && typeof data === 'object') {
      const result: SegmentationResultData = {
        polygons: Array.isArray(data.polygons) ? data.polygons : polygons,
        imageWidth: data.imageWidth,
        imageHeight: data.imageHeight,
        modelUsed: data.modelUsed,
        thresholdUsed: data.thresholdUsed,
        confidence: data.confidence,
        processingTime: data.processingTime,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
      return result;
    }

    // If it's just an array of polygons (backward compatibility)
    if (Array.isArray(data)) {
      return {
        polygons: data,
      };
    }

    // Return what was sent if response is unexpected
    return {
      polygons,
    };
  }

  async deleteSegmentationResults(imageId: string): Promise<void> {
    await this.instance.delete(`/segmentation/images/${imageId}/results`);
  }

  async getImageWithSegmentation(
    imageId: string
  ): Promise<ProjectImageDTO & { segmentation?: SegmentationResult }> {
    const response = await this.instance.get(
      `/images/${imageId}?includeSegmentation=true`
    );
    const data = this.extractData(response);
    const image = this.mapImageFields(data);

    // Add segmentation data if available
    if (data.segmentation) {
      // Defensive validation and mapping of segmentation data
      const segData = data.segmentation as Record<string, unknown>;

      // Validate segmentation data structure
      if (!segData || typeof segData !== 'object') {
        logger.warn('Invalid segmentation data structure:', segData);
        return image;
      }

      const mappedSegmentation: SegmentationResult = {
        id: segData.id || `seg_${Date.now()}`,
        imageId: segData.imageId || image.id,
        polygons: Array.isArray(segData.polygons)
          ? segData.polygons
              .map((poly: Record<string, unknown>, index: number) => {
                if (!poly || typeof poly !== 'object') {
                  logger.warn(`Invalid polygon at index ${index}:`, poly);
                  return null;
                }

                // Validate and convert points
                let validPoints = [];
                if (Array.isArray(poly.points)) {
                  if (poly.points.length > 0 && Array.isArray(poly.points[0])) {
                    // Points are in [[x,y], [x,y]] format
                    validPoints = poly.points
                      .filter(
                        (point: unknown) =>
                          Array.isArray(point) && point.length >= 2
                      )
                      .map((point: number[]) => ({
                        x: Number(point[0]) || 0,
                        y: Number(point[1]) || 0,
                      }));
                  } else if (
                    poly.points.length > 0 &&
                    typeof poly.points[0] === 'object'
                  ) {
                    // Points are already in {x, y} format
                    validPoints = poly.points
                      .filter(
                        (point: unknown) =>
                          point &&
                          typeof point === 'object' &&
                          point !== null &&
                          typeof (point as Record<string, unknown>).x ===
                            'number' &&
                          typeof (point as Record<string, unknown>).y ===
                            'number'
                      )
                      .map((point: Record<string, unknown>) => ({
                        x: Number(point.x),
                        y: Number(point.y),
                      }));
                  }
                }

                if (validPoints.length < 3) {
                  logger.warn(
                    `Polygon ${poly.id} has insufficient valid points (${validPoints.length})`
                  );
                  return null;
                }

                return {
                  id: poly.id || `poly_${index}`,
                  points: validPoints,
                  type: poly.type || 'external',
                  class: poly.class || 'spheroid',
                  parentIds: Array.isArray(poly.parentIds)
                    ? poly.parentIds
                    : [],
                  confidence:
                    typeof poly.confidence === 'number'
                      ? poly.confidence
                      : undefined,
                  area: typeof poly.area === 'number' ? poly.area : undefined,
                  complete:
                    typeof poly.complete === 'boolean'
                      ? poly.complete
                      : undefined,
                };
              })
              .filter(Boolean)
          : [], // Remove null entries
        model: segData.model || 'unknown',
        threshold:
          typeof segData.threshold === 'number' ? segData.threshold : 0.5,
        confidence:
          typeof segData.confidence === 'number'
            ? segData.confidence
            : undefined,
        processingTime:
          typeof segData.processingTime === 'number'
            ? segData.processingTime
            : undefined,
        imageWidth: Number(segData.imageWidth) || 0,
        imageHeight: Number(segData.imageHeight) || 0,
        status: 'completed', // Backend always returns completed segmentation
        createdAt: segData.createdAt || new Date().toISOString(),
        updatedAt: segData.updatedAt || new Date().toISOString(),
      };

      return {
        ...image,
        segmentation: mappedSegmentation,
      };
    }

    return image;
  }

  // User profile methods
  /**
   * Fetch the current user's profile. When `suppressAuthErrors` is set (used
   * by the AuthContext init probe), a 401 that even a token refresh can't fix
   * is surfaced as a plain rejection — no "session expired" toast or redirect.
   * This keeps a never-logged-in visitor's first page load silent.
   */
  async getUserProfile(options?: {
    suppressAuthErrors?: boolean;
  }): Promise<Profile> {
    // Add cache-busting to ensure fresh data after avatar upload
    const response = await this.instance.get('/auth/profile', {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        ...(options?.suppressAuthErrors
          ? { 'X-Suppress-Auth-Events': '1' }
          : {}),
      },
      params: {
        _t: Date.now(), // Cache buster parameter
      },
    });
    return this.extractData(response);
  }

  async updateUserProfile(data: UpdateProfile): Promise<Profile> {
    const response = await this.instance.put('/auth/profile', data);
    return this.extractData(response);
  }

  /** Update the `channels` JSON on a video-container Image. Used by the
   *  editor's per-channel rename UI. The BE validates exactly the same
   *  channel shape it returned, so callers should send the full array
   *  with any modifications applied. */
  async updateImageChannels(
    imageId: string,
    channels: Array<{
      name: string;
      displayName?: string;
      type: 'irm' | 'fluorescent';
      wavelengthNm?: number;
      displayColor?: string;
      isSegmentationSource: boolean;
    }>
  ): Promise<void> {
    await this.instance.patch(`/images/${imageId}/channels`, { channels });
  }

  async changePassword(data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ message: string }> {
    const response = await this.instance.post('/auth/change-password', data);
    return this.extractData(response);
  }

  async getUserStorageStats(): Promise<{
    totalStorageBytes: number;
    totalStorageMB: number;
    totalStorageGB: number;
    totalImages: number;
    averageImageSizeMB: number;
  }> {
    const response = await this.instance.get('/auth/storage-stats');
    return this.extractData(response);
  }

  async deleteAccount(): Promise<void> {
    // Deleting the account invalidates the session server-side (the user row
    // is gone, so the access/refresh tokens stop verifying). Auth lives in
    // httpOnly cookies now — there is nothing for the client to clear. The
    // backend clears the auth cookies on success; AuthContext resets the
    // user state and navigates away.
    await this.instance.delete('/auth/profile');
  }

  // Queue management methods
  async addImageToQueue(
    imageId: string,
    model?: string,
    threshold?: number,
    priority?: number,
    detectHoles?: boolean
  ): Promise<AddToQueueResponse> {
    const response = await this.instance.post(`/queue/images/${imageId}`, {
      model,
      threshold,
      priority,
      detectHoles,
    });
    return this.extractData<AddToQueueResponse>(response);
  }

  async addBatchToQueue(
    imageIds: string[],
    projectId: string,
    model?: string,
    threshold?: number,
    priority?: number,
    forceResegment?: boolean,
    detectHoles?: boolean,
    channel?: string
  ): Promise<BatchQueueResponse> {
    const response = await this.instance.post('/queue/batch', {
      imageIds,
      projectId,
      model,
      threshold,
      priority,
      forceResegment,
      detectHoles,
      ...(channel !== undefined ? { channel } : {}),
    });
    return this.extractData<BatchQueueResponse>(response);
  }

  async deleteBatch(
    imageIds: string[],
    projectId: string
  ): Promise<{
    deletedCount: number;
    failedIds: string[];
    errors: string[];
  }> {
    // Backend caps each request at FILE_LIMITS.CHUNK_SIZE_FILES via
    // imageBatchDeleteSchema. Chunk sequentially so callers can pass any
    // size — a 301-frame MT video would otherwise 400 with
    // "Maximálně 100 obrázků může být smazáno najednou". Sequential (not
    // parallel) because the service runs each chunk inside a Prisma
    // transaction with sync storage deletes; parallel chunks would stress
    // the DB pool + S3 throttling without real wall-clock win.
    const chunkSize = FILE_LIMITS.CHUNK_SIZE_FILES;
    let deletedCount = 0;
    const failedIds: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < imageIds.length; i += chunkSize) {
      const chunk = imageIds.slice(i, i + chunkSize);
      try {
        const response = await this.instance.delete('/images/batch', {
          data: { imageIds: chunk, projectId },
        });
        const data = this.extractData<{
          deletedCount: number;
          failedIds: string[];
          errors: string[];
        }>(response);
        deletedCount += data.deletedCount;
        failedIds.push(...data.failedIds);
        errors.push(...data.errors);
      } catch (err) {
        // Chunk-level failure (network blip, 5xx) — preserve partial
        // progress instead of throwing away the whole operation.
        const msg = err instanceof Error ? err.message : String(err);
        failedIds.push(...chunk);
        errors.push(`Chunk ${Math.floor(i / chunkSize) + 1}: ${msg}`);
      }
    }

    return { deletedCount, failedIds, errors };
  }

  async getQueueStats(projectId: string): Promise<QueueStats> {
    const response = await this.instance.get(
      `/queue/projects/${projectId}/stats`
    );
    return this.extractData<QueueStats>(response);
  }

  async getQueueItems(projectId: string): Promise<QueueItem[]> {
    const response = await this.instance.get(
      `/queue/projects/${projectId}/items`
    );
    return this.extractData<QueueItem[]>(response);
  }

  async removeFromQueue(queueId: string): Promise<void> {
    await this.instance.delete(`/queue/items/${queueId}`);
  }

  async cancelAllUserSegmentations(): Promise<{
    success: boolean;
    cancelledCount: number;
    affectedProjects: string[];
    affectedBatches: string[];
  }> {
    const response = await this.instance.post('/queue/cancel-all-user');
    return this.extractData<{
      success: boolean;
      cancelledCount: number;
      affectedProjects: string[];
      affectedBatches: string[];
    }>(response);
  }

  // Generic HTTP methods for custom endpoints
  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.instance.post(url, data, config);
  }

  async get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.instance.get(url, config);
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.instance.put(url, data, config);
  }

  async delete<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.instance.delete(url, config);
  }

  /**
   * Request a short-lived signed download token for an export job.
   * The token is then attached to a native browser download URL so the
   * ZIP can stream straight to disk — bypassing the axios blob path that
   * fails for very large exports (memory + 5-min timeout).
   */
  async getExportDownloadToken(
    projectId: string,
    jobId: string
  ): Promise<{ token: string; expiresAt: number }> {
    const response = await this.instance.post<{
      token: string;
      expiresAt: number;
    }>(`/projects/${projectId}/export/${jobId}/download-token`);
    return response.data;
  }

  /**
   * Build the absolute URL the browser should navigate to in order to
   * download an export ZIP. Uses the apiClient's configured base URL so
   * it works in both dev and production.
   */
  buildExportDownloadUrl(
    projectId: string,
    jobId: string,
    token: string,
    filename?: string
  ): string {
    const params = new URLSearchParams({ token });
    if (filename) {
      params.set('filename', filename);
    }
    // Resolve against window.location so a relative baseURL (e.g. "/api")
    // becomes a fully-qualified URL the browser can navigate to.
    const path = `${this.baseURL}/projects/${projectId}/export/${jobId}/download?${params.toString()}`;
    if (typeof window !== 'undefined') {
      try {
        return new URL(path, window.location.origin).toString();
      } catch {
        return path;
      }
    }
    return path;
  }
}

// Create and export a singleton instance
export const apiClient = new ApiClient();
export default apiClient;

/**
 * Convert a wire `ProjectImageDTO` (snake_case, narrow status union) into
 * a domain `ProjectImage` (camelCase, superset status, Date instances).
 *
 * Use this at the seam between `apiClient.*` (which returns DTOs) and
 * UI/business code (which expects the domain shape from `@/types`).
 * Keeps snake_case field access from leaking into components — the
 * historical cause of subtle bugs when wire format changed without
 * consumer updates.
 *
 * Domain fields not present on the DTO (e.g. `segmentationResult`) are
 * left undefined; callers that need them should fetch via the dedicated
 * segmentation API.
 */
export function dtoToProjectImage(dto: ProjectImageDTO): ProjectImage {
  return {
    id: dto.id,
    name: dto.name,
    url: dto.url ?? dto.image_url,
    displayUrl: dto.displayUrl,
    width: dto.width,
    height: dto.height,
    createdAt: new Date(dto.created_at),
    updatedAt: new Date(dto.updated_at),
    segmentationStatus: dto.segmentation_status,
    project_id: dto.project_id,
    thumbnail_url: dto.thumbnail_url,
    segmentationThumbnailPath: dto.segmentationThumbnailPath,
    segmentationThumbnailUrl: dto.segmentationThumbnailUrl,
    image_url: dto.image_url,
    created_at: dto.created_at,
    updated_at: dto.updated_at,
    user_id: dto.user_id,
  };
}
