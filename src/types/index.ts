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

// Helper function for safe error message extraction
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiError;
    return apiError.response?.data?.message || apiError.message || 'An error occurred';
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return 'An unknown error occurred';
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
  points: Array<{x: number, y: number}>;
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

