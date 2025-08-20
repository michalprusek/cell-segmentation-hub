import type { Polygon } from '@/lib/segmentation';

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

export interface PolygonMetrics {
  area: number;
  perimeter: number;
  centroid: { x: number; y: number };
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Helper function for safe error message extraction with HTTP status code mapping
export function getErrorMessage(
  error: unknown,
  t?: (key: string) => string,
  context?: string
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
export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  imageCount?: number;
  thumbnail?: string;
}

export interface NewProject {
  name: string;
  description?: string;
}

// Image types
export interface Image {
  id: string;
  name: string;
  project_id: string;
  user_id: string;
  image_url: string;
  thumbnail_url?: string;
  segmentation_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface NewImage {
  name: string;
  project_id: string;
  image_url: string;
  thumbnail_url?: string;
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

// Access request types
export interface AccessRequest {
  id: string;
  email: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface NewAccessRequest {
  email: string;
  reason: string;
}

// Segmentation types (can be extended as needed)
export interface PolygonData {
  id: string;
  points: Array<{ x: number; y: number }>;
  type: 'external' | 'internal';
  class: string;
}

export interface SegmentationData {
  id?: string;
  imageSrc?: string;
  polygons: PolygonData[];
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  timestamp?: Date;
  imageWidth?: number;
  imageHeight?: number;
}

export interface SegmentationResult {
  id: string;
  image_id: string;
  polygons: PolygonData[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

// ProjectImage type for use across components
export interface ProjectImage {
  id: string;
  name: string;
  url: string;
  displayUrl?: string; // Browser-compatible URL for display
  width?: number | null; // Image width in pixels
  height?: number | null; // Image height in pixels
  createdAt: Date;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationData;
  project_id?: string;
  thumbnail_url?: string;
  image_url?: string; // Alternative field for backward compatibility
  status?: string;
  created_at?: string; // Alternative date format
  updated_at?: string; // Alternative date format
  user_id?: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

// Metric types for XLSX export
export interface SpheroidMetric {
  imageId: string;
  imageName: string;
  contourNumber: number;
  area: number;
  perimeter: number;
  circularity: number;
  compactness: number;
  convexity: number;
  equivalentDiameter: number;
  aspectRatio: number;
  feretDiameterMax: number;
  feretDiameterMaxOrthogonal: number;
  feretDiameterMin: number;
  lengthMajorDiameter: number;
  lengthMinorDiameter: number;
  solidity: number;
  sphericity: number;
}

// Type guard for ApiError
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
