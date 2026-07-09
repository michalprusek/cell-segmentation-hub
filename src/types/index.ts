import type { Polygon as _Polygon } from '@/lib/segmentation';
// Model identity + compatibility are derived from the frontend model registry
// SSOT (`@/lib/models/modelRegistry`), which mirrors the backend SSOT. They
// are re-exported below so existing `@/types` consumers stay untouched.
import {
  type ModelType as RegistryModelType,
  MODEL_TYPE_COMPATIBILITY as REGISTRY_MODEL_TYPE_COMPATIBILITY,
} from '@/lib/models/modelRegistry';

// Auth types
export interface User {
  id: string;
  email: string;
  username?: string;
}

export interface Profile {
  id: string;
  email: string;
  username?: string;
  organization?: string;
  bio?: string;
  avatarUrl?: string;
  location?: string;
  title?: string;
  publicProfile?: boolean;
  preferredModel?: string;
  modelThreshold?: number;
  preferredLang?: string;
  preferredTheme?: string;
  emailNotifications?: boolean;
  consentToMLTraining?: boolean;
  consentToAlgorithmImprovement?: boolean;
  consentToFeatureDevelopment?: boolean;
  consentUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  user?: User;
}

export interface ApiError {
  message: string;
  status?: number;
  response?: {
    data?: {
      message?: string;
    };
    status?: number;
  };
}

// Helper function for safe error message extraction with HTTP status code mapping
export function getErrorMessage(
  error: unknown,
  t?: (key: string) => string,
  _context?: string
): string {
  // Extract status code if available
  let statusCode: number | undefined;
  let message: string | undefined;
  let url: string | undefined;

  if (error instanceof Error) {
    message = error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiError & { config?: { url?: string } };
    statusCode = apiError.response?.status || apiError.status;
    message = apiError.response?.data?.message || apiError.message;
    url = apiError.config?.url;

    // Special handling for authentication endpoints
    if (
      statusCode === 401 &&
      url &&
      (url.includes('/auth/login') || url.includes('/auth/signin'))
    ) {
      // For login endpoints, 401 means invalid credentials, not expired session
      if (t) {
        return t('errors.invalidCredentials');
      }
      return 'Invalid email or password. Please check your credentials and try again.';
    }

    // Special handling for registration endpoint conflicts
    if (
      statusCode === 409 &&
      url &&
      (url.includes('/auth/register') || url.includes('/auth/signup'))
    ) {
      // For registration endpoints, 409 means email already exists
      if (t) {
        return t('errors.emailAlreadyExists');
      }
      return 'This email is already registered. Try signing in or use a different email.';
    }

    // Map common HTTP status codes to user-friendly messages
    if (statusCode && t) {
      switch (statusCode) {
        case 400:
          return t('errors.validation');
        case 401:
          return t('errors.sessionExpired');
        case 403:
          return t('errors.forbidden');
        case 404:
          return t('errors.notFound');
        case 409:
          return t('errors.conflict');
        case 422:
          return t('errors.validation');
        case 429:
          return t('errors.tooManyRequests');
        case 500:
          return t('errors.server');
        case 502:
        case 503:
        case 504:
          return t('errors.serverUnavailable');
        default:
          if (statusCode >= 400 && statusCode < 500) {
            return t('errors.clientError');
          } else if (statusCode >= 500) {
            return t('errors.server');
          }
      }
    }

    // If no translation function provided, return basic messages
    if (statusCode && !t) {
      switch (statusCode) {
        case 400:
          return 'Invalid request. Please check your input.';
        case 401:
          return 'Your session has expired. Please sign in again.';
        case 403:
          return 'You do not have permission to perform this action.';
        case 404:
          return 'The requested resource was not found.';
        case 409:
          return 'A conflict occurred. Please refresh and try again.';
        case 422:
          return 'Validation error. Please check your input.';
        case 429:
          return 'Too many requests. Please wait a moment and try again.';
        case 500:
          return 'Server error. Please try again later.';
        case 502:
        case 503:
        case 504:
          return 'Service temporarily unavailable. Please try again later.';
        default:
          if (statusCode >= 400 && statusCode < 500) {
            return message || 'Request error. Please try again.';
          } else if (statusCode >= 500) {
            return 'Server error. Please try again later.';
          }
      }
    }

    if (message) {
      // Clean up technical messages
      if (message.includes('resource code')) {
        // Extract status code from messages like "resource code 401"
        const codeMatch = message.match(/resource code (\d+)/);
        if (codeMatch) {
          const code = parseInt(codeMatch[1]);
          // Map the extracted code directly to the appropriate message without recursion
          if (t) {
            switch (code) {
              case 400:
                return t('errors.validation');
              case 401:
                return t('errors.sessionExpired');
              case 403:
                return t('errors.forbidden');
              case 404:
                return t('errors.notFound');
              case 409:
                return t('errors.conflict');
              case 422:
                return t('errors.validation');
              case 429:
                return t('errors.tooManyRequests');
              case 500:
                return t('errors.server');
              case 502:
              case 503:
              case 504:
                return t('errors.serverUnavailable');
              default:
                if (code >= 400 && code < 500) {
                  return t('errors.clientError');
                } else if (code >= 500) {
                  return t('errors.server');
                }
            }
          } else {
            // Fallback messages when no translation function is available
            switch (code) {
              case 400:
                return 'Invalid request. Please check your input.';
              case 401:
                return 'Your session has expired. Please sign in again.';
              case 403:
                return 'You do not have permission to perform this action.';
              case 404:
                return 'The requested resource was not found.';
              case 409:
                return 'A conflict occurred. Please refresh and try again.';
              case 422:
                return 'Validation error. Please check your input.';
              case 429:
                return 'Too many requests. Please wait a moment and try again.';
              case 500:
                return 'Server error. Please try again later.';
              case 502:
              case 503:
              case 504:
                return 'Service temporarily unavailable. Please try again later.';
              default:
                if (code >= 400 && code < 500) {
                  return 'Request error. Please try again.';
                } else if (code >= 500) {
                  return 'Server error. Please try again later.';
                }
            }
          }
          // If no specific message found, return a generic one
          return 'An error occurred. Please try again.';
        }
      }

      // Convert camelCase to readable text
      if (/^[a-z]+([A-Z][a-z]+)+$/.test(message)) {
        return message
          .replace(/([A-Z])/g, ' $1')
          .toLowerCase()
          .replace(/^./, str => str.toUpperCase());
      }

      return message;
    }
  }

  if (typeof error === 'string') {
    // Clean up string errors
    if (error.includes('resource code')) {
      const codeMatch = error.match(/resource code (\d+)/);
      if (codeMatch) {
        const code = parseInt(codeMatch[1]);
        // Map the extracted code directly to the appropriate message without recursion
        if (t) {
          switch (code) {
            case 400:
              return t('errors.validation');
            case 401:
              return t('errors.sessionExpired');
            case 403:
              return t('errors.forbidden');
            case 404:
              return t('errors.notFound');
            case 409:
              return t('errors.conflict');
            case 422:
              return t('errors.validation');
            case 429:
              return t('errors.tooManyRequests');
            case 500:
              return t('errors.server');
            case 502:
            case 503:
            case 504:
              return t('errors.serverUnavailable');
            default:
              if (code >= 400 && code < 500) {
                return t('errors.clientError');
              } else if (code >= 500) {
                return t('errors.server');
              }
          }
        } else {
          // Fallback messages when no translation function is available
          switch (code) {
            case 400:
              return 'Invalid request. Please check your input.';
            case 401:
              return 'Your session has expired. Please sign in again.';
            case 403:
              return 'You do not have permission to perform this action.';
            case 404:
              return 'The requested resource was not found.';
            case 409:
              return 'A conflict occurred. Please refresh and try again.';
            case 422:
              return 'Validation error. Please check your input.';
            case 429:
              return 'Too many requests. Please wait a moment and try again.';
            case 500:
              return 'Server error. Please try again later.';
            case 502:
            case 503:
            case 504:
              return 'Service temporarily unavailable. Please try again later.';
            default:
              if (code >= 400 && code < 500) {
                return 'Request error. Please try again.';
              } else if (code >= 500) {
                return 'Server error. Please try again later.';
              }
          }
        }
        // If no specific message found, return a generic one
        return 'An error occurred. Please try again.';
      }
    }

    // Convert camelCase to readable text
    if (/^[a-z]+([A-Z][a-z]+)+$/.test(error)) {
      return error
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .replace(/^./, str => str.toUpperCase());
    }

    return error;
  }

  return t ? t('errors.unknown') : 'An unknown error occurred';
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

// Project types
export const PROJECT_TYPES = [
  'spheroid',
  'spheroid_invasive',
  'wound',
  'sperm',
  'microtubules',
  'microcapsule',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Coerce arbitrary input to a known ProjectType, defaulting to 'spheroid'.
 * Use at API boundary so consumers never have to defensively `?? 'spheroid'`.
 */
export const isProjectType = (v: unknown): v is ProjectType =>
  typeof v === 'string' && (PROJECT_TYPES as readonly string[]).includes(v);

/** True for microtubule projects. Prefer this shared predicate over a bare
 *  `t === 'microtubules'` literal: the project type is the PLURAL `microtubules`
 *  while the model id is the SINGULAR `microtubule`, and mixing them up has
 *  already shipped a bug (silently hiding the MT export section). */
export const isMicrotubuleProject = (t: string | undefined | null): boolean =>
  t === 'microtubules';

/** All known model identifiers, derived from the frontend model registry
 *  SSOT (`@/lib/models/modelRegistry`), which mirrors the backend SSOT.
 *  Re-exported as `KnownModelId` so existing `@/types` consumers are
 *  untouched and a removed model becomes a compile error everywhere. */
type KnownModelId = RegistryModelType;

/** Models compatible with each project type, derived (by inversion) from the
 * model registry SSOT. Cross-type segmentation is blocked at both frontend
 * (dropdown filter) and backend (400 on submit).
 *
 * - `spheroid_invasive` is locked to `unet_attention_aspp` because core
 *   detection is tied to that model's postprocessing path.
 * - `wound`, `sperm` and `microtubules` use their dedicated specialised
 *   models only. `microtubules` ships with the v7 DINOv3 + DPT + PySOAX
 *   pipeline producing per-instance polyline centerlines.
 * - Standard `spheroid` projects can use any of the general spheroid
 *   models, with `unet_attention_aspp` excluded so users wanting core
 *   detection are nudged toward marking the project disintegrated.
 */
export const MODEL_TYPE_COMPATIBILITY: Record<
  ProjectType,
  readonly KnownModelId[]
> = REGISTRY_MODEL_TYPE_COMPATIBILITY;

export const isModelCompatibleWithType = (
  model: string,
  projectType: ProjectType
): boolean =>
  (MODEL_TYPE_COMPATIBILITY[projectType] as readonly string[]).includes(model);

export interface Project {
  id: string;
  name: string;
  description?: string;
  // Required: DB column is NOT NULL DEFAULT 'spheroid'. API always returns it.
  type: ProjectType;
  created_at: string;
  updated_at: string;
  user_id: string;
  imageCount?: number;
  thumbnail?: string;
  // Per-user folder placement. `null` (or absent) means the project sits at
  // the caller's root level. Two users can see different folderId values for
  // the same shared project — see backend ProjectFolderItem model.
  folderId?: string | null;
}

export interface ProjectFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewProject {
  name: string;
  description?: string;
  type?: ProjectType;
}

// Image types
export interface Image {
  id: string;
  name: string;
  project_id: string;
  user_id: string;
  image_url: string;
  thumbnail_url?: string;
  segmentation_status: SegmentationStatus;
  created_at: string;
  updated_at: string;
}

export interface UpdateProfile {
  username?: string;
  organization?: string;
  bio?: string;
  avatarUrl?: string;
  location?: string;
  title?: string;
  publicProfile?: boolean;
  preferredModel?: string;
  modelThreshold?: number;
  preferredLang?: string;
  preferredTheme?: string;
  emailNotifications?: boolean;
  consentToMLTraining?: boolean;
  consentToAlgorithmImprovement?: boolean;
  consentToFeatureDevelopment?: boolean;
}

/**
 * Canonical segmentation/job status union for the frontend. The four base
 * states match what the backend returns over REST + WebSocket
 * (`segmentationService.ts`, `mapSegmentationStatus()` in `api.ts`).
 *
 * For export jobs that can additionally be cancelled, use `ExportJobStatus`
 * which is `SegmentationStatus | 'cancelled'`.
 *
 * Use these instead of writing the 4-variant union inline — auto-import
 * stays consistent and a future status addition is one edit, not seven.
 */
export type SegmentationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Status union for cancellable jobs (e.g. exports). Superset of
 * `SegmentationStatus` plus `'cancelled'`.
 */
export type ExportJobStatus = SegmentationStatus | 'cancelled';

// Segmentation types (can be extended as needed)
export interface PolygonData {
  id: string;
  points: Array<{ x: number; y: number }>;
  type: 'external' | 'internal';
  class: string;
  geometry?: 'polygon' | 'polyline'; // absent = 'polygon' (backward compat)
  partClass?: 'head' | 'midpiece' | 'tail'; // For sperm polyline parts
  instanceId?: string; // Groups polylines into instances, e.g. 'sperm_1'
  /** Microcapsule completeness flag: `false` when cut off by the image border.
   *  Excluded from metrics; absent for other project types. */
  complete?: boolean;
}

export interface SegmentationData {
  id?: string;
  imageSrc?: string;
  polygons: PolygonData[];
  status?: SegmentationStatus;
  timestamp?: Date;
  imageWidth?: number;
  imageHeight?: number;
}

export interface SegmentationResult {
  id: string;
  image_id: string;
  polygons: PolygonData[];
  status: SegmentationStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Domain `ProjectImage` — the de-facto canonical shape used across all UI
 * components, hooks, and exports (18+ import sites). Permissive: accepts
 * both camelCase and snake_case alt fields so it can wrap either the API
 * wire DTO from `@/lib/api` or freshly constructed objects. New code
 * should consume this type, not the wire DTO.
 */
export interface ProjectImage {
  id: string;
  name: string;
  url: string;
  displayUrl?: string; // Browser-compatible URL for display
  width?: number | null; // Image width in pixels
  height?: number | null; // Image height in pixels
  createdAt: Date;
  updatedAt: Date;
  segmentationStatus:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'segmented'
    | 'queued'
    | 'no_segmentation'
    | 'no_polygons';
  segmentationResult?: SegmentationData;
  project_id?: string;
  thumbnail_url?: string;
  segmentationThumbnailPath?: string; // New field for segmentation thumbnail (deprecated)
  segmentationThumbnailUrl?: string; // New field for segmentation thumbnail URL
  image_url?: string; // Alternative field for backward compatibility
  status?: string;
  created_at?: string; // Alternative date format
  updated_at?: string; // Alternative date format
  user_id?: string;
  // Video container fields (set on rows where isVideoContainer == true).
  // Frame children are filtered from the gallery on the backend; UI only
  // ever sees container rows here.
  isVideoContainer?: boolean;
  // Frame-row identifiers — set when the row IS a child frame; null on
  // containers and standalone images. Editor uses these to load polygons
  // for a specific frame inside a video.
  parentVideoId?: string | null;
  frameIndex?: number | null;
  frameCount?: number | null;
  videoDurationMs?: number | null;
  // Calibration metadata extracted from the upload (ND2 voxel size,
  // OME-TIFF Pixels, ImageJ finterval). Container rows only — frame
  // rows inherit by parent lookup. ``null`` when the source had no
  // calibration metadata.
  pixelSizeUm?: number | null;
  frameIntervalMs?: number | null;
  channels?: VideoChannel[] | null;
  // Storage key of the underlying file (e.g. frames/NNNN/<channel>.png).
  // Surfaced so the Segment-All channel picker can derive distinct channels
  // by regex over the path; not used by the canvas.
  originalPath?: string | null;
}

/** Shape of one entry in the ``channels`` JSON column on an Image row.
 *  Set only on rows where ``isVideoContainer == true``. */
export interface VideoChannel {
  /** Path-safe identifier used as both the per-frame PNG filename
   *  (`frames/NNNN/<name>.png`) and the API-level channel reference.
   *  Validated against `/^[A-Za-z0-9_-]{1,64}$/` everywhere it crosses
   *  a service boundary. */
  name: string;
  /** Human-friendly label sourced from the upload's metadata (TIFF
   *  ImageJ labels / ND2 channel names). Falls back to `"Channel N"`
   *  (1-based) when the format carries no metadata. UI components
   *  should render `displayName ?? name`. Older uploads (pre-2026-05-13)
   *  have this undefined; consumers must tolerate that. */
  displayName?: string;
  type: 'irm' | 'fluorescent';
  wavelengthNm?: number;
  displayColor?: string;
  isSegmentationSource: boolean;
  /** True for channels ADDED after upload ("Add channel"): pixels live only
   *  in the per-frame PNGs, and the channel may cover only some frames. */
  pngBacked?: boolean;
  /** Frame Image ids this channel actually covers, when it covers only SOME
   *  frames. Omitted => full coverage. The editor uses this to skip requesting
   *  the channel for frames it doesn't cover (avoids 404 noise). */
  frameIds?: string[];
}

// Metric types for XLSX export
export interface SpheroidMetric {
  imageId: string;
  imageName: string;
  contourNumber: number;
  area: number;
  perimeter: number;
  circularity: number;
  extent: number; // Renamed from compactness - ratio of area to bounding box area
  convexity: number;
  equivalentDiameter: number;
  aspectRatio: number;
  feretDiameterMax: number;
  feretDiameterOrthogonal: number; // Renamed - perpendicular to max Feret
  feretDiameterMin: number;
  boundingBoxWidth: number; // Renamed from lengthMajorDiameter for clarity
  boundingBoxHeight: number; // Renamed from lengthMinorDiameter for clarity
  solidity: number;
  // sphericity removed - it's a 3D metric, not applicable to 2D
}
