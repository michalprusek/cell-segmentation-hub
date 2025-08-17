/**
 * Sdílené typy mezi frontend a backend
 */

// User types
export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile?: UserProfile;
}

export interface UserProfile {
  id: string;
  userId: string;
  username?: string;
  avatarUrl?: string;
  preferredModel: string;
  modelThreshold: number;
  preferredLang: string;
  preferredTheme: string;
  bio?: string;
}

// Auth types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  username?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface ResetPasswordRequest {
  email: string;
}

export interface ConfirmResetPasswordRequest {
  token: string;
  password: string;
}

// Project types
export interface Project {
  id: string;
  title: string;
  description?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  imageCount?: number;
  thumbnail?: string;
}

export interface CreateProjectRequest {
  title: string;
  description?: string;
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string;
}

// Image types
export interface ProjectImage {
  id: string;
  name: string;
  originalPath: string;
  thumbnailPath?: string;
  projectId: string;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  segmentation?: Segmentation;
  url?: string;
  thumbnailUrl?: string;
}

// Segmentation types
export interface Point {
  x: number;
  y: number;
}

export interface PolygonData {
  id: string;
  points: Point[];
  type: 'external' | 'internal';
  class: string;
}

export interface Segmentation {
  id: string;
  imageId: string;
  polygons: PolygonData[];
  model: string;
  threshold: number;
  createdAt: Date;
  updatedAt: Date;
  metrics?: SpheroidMetric[];
}

export interface SegmentationRequest {
  imageId: string;
  model?: string;
  threshold?: number;
}

// Metric types
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

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends Omit<ApiResponse<T>, 'data'> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Error types
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// File upload types
export interface UploadResponse {
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  path: string;
  url: string;
}

// COCO format types
export interface License {
  id: number;
  name: string;
  url?: string;
}

export interface CocoImage {
  id: number;
  width: number;
  height: number;
  file_name: string;
  license?: number;
  flickr_url?: string;
  coco_url?: string;
  date_captured?: string;
}

export interface CocoAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  segmentation: number[][];
  area: number;
  bbox: [number, number, number, number];
  iscrowd: number;
}

export interface CocoCategory {
  id: number;
  name: string;
  supercategory?: string;
}

// Export types
export interface ExportRequest {
  projectId: string;
  imageIds?: string[];
  format: 'coco' | 'excel';
  includeMetrics?: boolean;
}

export interface CocoExport {
  info: {
    description: string;
    version: string;
    year: number;
    date_created: string;
  };
  licenses: License[];
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
}

// Settings types
export interface UserSettings {
  preferredModel: string;
  modelThreshold: number;
  preferredLang: string;
  preferredTheme: string;
  emailNotifications: boolean;
}

export type UpdateSettingsRequest = Partial<UserSettings>;

// Available segmentation models
export const SEGMENTATION_MODELS = {
  hrnet: {
    id: 'hrnet',
    name: 'HRNetV2',
    description: 'High-Resolution Network for semantic segmentation',
    defaultThreshold: 0.5,
  },
  resunet_advanced: {
    id: 'resunet_advanced',
    name: 'ResUNet Advanced',
    description: 'Advanced ResUNet with attention mechanisms',
    defaultThreshold: 0.6,
  },
  resunet_small: {
    id: 'resunet_small',
    name: 'ResUNet Small',
    description: 'Efficient ResUNet for fast segmentation',
    defaultThreshold: 0.7,
  },
} as const;

export type SegmentationModelId = keyof typeof SEGMENTATION_MODELS;
