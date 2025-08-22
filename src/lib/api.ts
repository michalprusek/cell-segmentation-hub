import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Profile, UpdateProfile, PolygonData } from '@/types';
import { logger } from '@/lib/logger';
import config from '@/lib/config';

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
  accessToken: string;
  refreshToken: string;
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

export interface ProjectImage {
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

// Utility function for exponential backoff with retry logic
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const exponentialBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 10000
): Promise<T> => {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error as Error;

      // Don't retry if it's not a rate limit error or if it's the last attempt
      const errorWithResponse = error as { response?: { status: number } };
      if (
        errorWithResponse.response?.status !== 429 ||
        attempt === maxRetries
      ) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 0.1 * delay; // Add 10% jitter
      const finalDelay = delay + jitter;

      logger.warn(
        `🔄 Rate limited (429), retrying in ${Math.round(finalDelay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`
      );
      await sleep(finalDelay);
    }
  }

  throw lastError!;
};

export interface SegmentationRequest {
  imageId: string;
  model?: string;
  threshold?: number;
}

export interface SegmentationPolygon {
  id: string;
  points: Array<{ x: number; y: number }>;
  type: 'external' | 'internal';
  class?: string;
  parentIds?: string[]; // For tracking hierarchy
  confidence?: number;
  area?: number;
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
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
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
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private rememberMePreferred: boolean = true;
  private baseURL: string;

  constructor(baseURL: string = config.apiBaseUrl) {
    this.baseURL = baseURL;
    this.instance = axios.create({
      baseURL,
      timeout: 120000, // Increased to 2 minutes for batch operations
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Load tokens from localStorage
    this.loadTokensFromStorage();

    // Request interceptor to add auth token
    this.instance.interceptors.request.use(
      config => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      error => Promise.reject(error)
    );

    // Response interceptor to handle token refresh
    this.instance.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;

        // Don't try to refresh tokens for auth endpoints (login, register, refresh)
        const isAuthEndpoint =
          originalRequest.url?.includes('/auth/login') ||
          originalRequest.url?.includes('/auth/register') ||
          originalRequest.url?.includes('/auth/refresh');

        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          !isAuthEndpoint &&
          this.refreshToken
        ) {
          originalRequest._retry = true;

          try {
            logger.debug('🔄 Attempting token refresh...');
            await this.refreshAccessToken();
            // Retry the original request with new token
            originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.instance(originalRequest);
          } catch (refreshError) {
            // Refresh failed, logout user
            logger.debug('🔄 Token refresh failed, clearing tokens');
            this.clearTokensFromStorage();
            // Don't force redirect here, let the app handle it naturally
            return Promise.reject(refreshError);
          }
        }

        // Handle rate limiting with exponential backoff
        if (error.response?.status === 429) {
          return exponentialBackoff(() => this.instance(originalRequest));
        }

        return Promise.reject(error);
      }
    );
  }

  private loadTokensFromStorage(): void {
    // Try localStorage first (remember me), then sessionStorage (session only)
    this.accessToken =
      localStorage.getItem('accessToken') ||
      sessionStorage.getItem('accessToken');
    this.refreshToken =
      localStorage.getItem('refreshToken') ||
      sessionStorage.getItem('refreshToken');

    // Set rememberMePreferred based on where tokens were found
    this.rememberMePreferred = localStorage.getItem('accessToken') !== null;
  }

  private saveTokensToStorage(
    rememberMe: boolean = this.rememberMePreferred
  ): void {
    const storage = rememberMe ? localStorage : sessionStorage;
    if (this.accessToken) {
      storage.setItem('accessToken', this.accessToken);
    }
    if (this.refreshToken) {
      storage.setItem('refreshToken', this.refreshToken);
    }
  }

  private clearTokensFromStorage(): void {
    // Clear from both localStorage and sessionStorage
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    this.accessToken = null;
    this.refreshToken = null;
  }

  // Auth methods
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

    // Sanitize response before logging
    const sanitizedLoginResponse = {
      success: response.data?.success,
      status: response.status,
      data: response.data?.data
        ? {
            user: response.data.data.user,
            // Mask any token fields
            accessToken: response.data.data.accessToken
              ? '[REDACTED]'
              : undefined,
            refreshToken: response.data.data.refreshToken
              ? '[REDACTED]'
              : undefined,
            access_token: response.data.data.access_token
              ? '[REDACTED]'
              : undefined,
            refresh_token: response.data.data.refresh_token
              ? '[REDACTED]'
              : undefined,
            id_token: response.data.data.id_token ? '[REDACTED]' : undefined,
            token: response.data.data.token ? '[REDACTED]' : undefined,
          }
        : undefined,
    };
    logger.debug('🔍 Backend response:', sanitizedLoginResponse);

    // Handle backend response structure: { success: true, data: { user, accessToken, refreshToken } }
    const backendData = response.data.data || response.data;
    const { accessToken, refreshToken, user } = backendData;

    logger.debug('🔍 Extracted data:', {
      accessToken: !!accessToken,
      refreshToken: !!refreshToken,
      user: !!user,
    });

    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.rememberMePreferred = rememberMe;
    this.saveTokensToStorage(rememberMe);

    logger.debug('🔑 Tokens saved to localStorage and memory');
    logger.debug('🔍 isAuthenticated() now returns:', this.isAuthenticated());

    // Return in expected format
    return {
      accessToken,
      refreshToken,
      user,
    };
  }

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

    // Sanitize response before logging
    const sanitizedResponse = {
      ...response.data,
      data: response.data?.data
        ? {
            ...response.data.data,
            accessToken: response.data.data.accessToken
              ? '[REDACTED]'
              : undefined,
            refreshToken: response.data.data.refreshToken
              ? '[REDACTED]'
              : undefined,
            token: response.data.data.token ? '[REDACTED]' : undefined,
            apiKey: response.data.data.apiKey ? '[REDACTED]' : undefined,
            user: response.data.data.user,
          }
        : undefined,
    };
    logger.debug('🔍 Backend register response:', sanitizedResponse);

    // Handle backend response structure: { success: true, data: { user, accessToken, refreshToken } }
    const backendData = response.data.data || response.data;
    const { accessToken, refreshToken, user } = backendData;

    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.saveTokensToStorage();

    // Return in expected format
    return {
      accessToken,
      refreshToken,
      user,
    };
  }

  async logout(): Promise<void> {
    try {
      if (this.refreshToken) {
        await this.instance.post('/auth/logout', {
          refreshToken: this.refreshToken,
        });
      }
    } catch (error) {
      logger.error('Logout error:', error);
    } finally {
      this.clearTokensFromStorage();
    }
  }

  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.instance.post('/auth/refresh', {
      refreshToken: this.refreshToken,
    });

    const data = this.extractData<{ accessToken: string }>(response);
    this.accessToken = data.accessToken;
    this.saveTokensToStorage();
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
    const result: Project = {
      id: project.id as string,
      name: (project.title as string) || (project.name as string), // Map title -> name
      description: project.description as string | undefined,
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

    return result;
  }

  // Helper method to map multiple projects
  private mapProjectsFields(projects: Record<string, unknown>[]): Project[] {
    return projects.map(project => this.mapProjectFields(project));
  }

  // Helper method to map segmentation status values
  private mapSegmentationStatus(
    status: unknown
  ): 'pending' | 'processing' | 'completed' | 'failed' {
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
      default:
        // Log unexpected values and return safe default
        if (process.env.NODE_ENV === 'development') {
          logger.warn('Unexpected segmentation status from backend:', status);
        }
        return 'failed';
    }
  }

  // Helper method to map backend image fields to frontend expectations
  private mapImageFields(image: Record<string, unknown>): ProjectImage {
    let imageUrl =
      (image.originalUrl as string) || (image.image_url as string) || '';
    let thumbnailUrl =
      (image.thumbnailUrl as string) || (image.thumbnail_url as string);
    let displayUrl = (image.displayUrl as string) || imageUrl; // Fallback to original URL

    // Ensure URLs are absolute for Docker environment
    const ensureAbsoluteUrl = (url: string): string => {
      if (!url) return url;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      // If it's a relative URL, prepend the base URL
      const baseUrl = this.baseURL.replace('/api', '');
      return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
    };

    imageUrl = ensureAbsoluteUrl(imageUrl);
    thumbnailUrl = thumbnailUrl ? ensureAbsoluteUrl(thumbnailUrl) : imageUrl;
    displayUrl = ensureAbsoluteUrl(displayUrl);

    return {
      id: image.id as string,
      name: image.name as string,
      project_id: (image.projectId as string) || (image.project_id as string),
      user_id: (image.userId as string) || (image.user_id as string),
      url: displayUrl, // Use displayUrl for browser compatibility
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      displayUrl: displayUrl, // Explicit display URL field
      width: (image.width as number) || null,
      height: (image.height as number) || null,
      segmentation_status: this.mapSegmentationStatus(
        image.segmentationStatus || image.segmentation_status
      ),
      created_at: (image.createdAt as string) || (image.created_at as string),
      updated_at: (image.updatedAt as string) || (image.updated_at as string),
    };
  }

  // Helper method to map multiple images
  private mapImagesFields(images: Record<string, unknown>[]): ProjectImage[] {
    return images.map(image => this.mapImageFields(image));
  }

  // Project methods
  async getProjects(params?: {
    page?: number;
    limit?: number;
    search?: string;
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

  async createProject(data: {
    name: string;
    description?: string;
  }): Promise<Project> {
    // Convert 'name' to 'title' to match backend validation schema
    const requestData = {
      title: data.name,
      description: data.description,
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
    data: { name?: string; description?: string }
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

  // Sharing methods
  async shareProjectByEmail(
    projectId: string,
    data: { email: string; message?: string }
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

  async getSharedProjects(): Promise<
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
    const response = await this.instance.get('/shared/projects');
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
    images: ProjectImage[];
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

  async getProjectImages(
    projectId: string,
    params?: { page?: number; limit?: number }
  ): Promise<{
    images: ProjectImage[];
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

  async uploadImages(
    projectId: string,
    files: File[],
    onProgress?: (progressPercent: number) => void
  ): Promise<ProjectImage[]> {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('images', file);
    });

    const response = await this.instance.post(
      `/projects/${projectId}/images`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000, // 60 seconds for file uploads
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

  async getImage(projectId: string, imageId: string): Promise<ProjectImage> {
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
    detectHoles?: boolean
  ): Promise<SegmentationResult> {
    const response = await this.instance.post(`/segmentation/batch`, {
      imageIds,
      model: model || 'hrnet',
      threshold: threshold || 0.5,
      detectHoles: detectHoles,
    });
    return this.extractData(response);
  }

  async getSegmentationResults(
    imageId: string
  ): Promise<SegmentationResultData | null> {
    try {
      const response = await this.instance.get(
        `/segmentation/images/${imageId}/results`
      );
      const data = this.extractData(response);

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

      // If it's just an array of polygons (backward compatibility)
      if (Array.isArray(data)) {
        return {
          polygons: data,
        };
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
  ): Promise<ProjectImage & { segmentation?: SegmentationResult }> {
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
  async getUserProfile(): Promise<Profile> {
    const response = await this.instance.get('/auth/profile');
    return this.extractData(response);
  }

  async updateUserProfile(data: UpdateProfile): Promise<Profile> {
    const response = await this.instance.put('/auth/profile', data);
    return this.extractData(response);
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
    try {
      await this.instance.delete('/auth/profile');
      // Clear tokens after successful deletion
      this.clearTokensFromStorage();
    } catch (error) {
      // Clear tokens even if the request fails (user might want to logout anyway)
      this.clearTokensFromStorage();
      throw error;
    }
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
    detectHoles?: boolean
  ): Promise<BatchQueueResponse> {
    const response = await this.instance.post('/queue/batch', {
      imageIds,
      projectId,
      model,
      threshold,
      priority,
      forceResegment,
      detectHoles,
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
    const response = await this.instance.delete('/images/batch', {
      data: {
        imageIds,
        projectId,
      },
    });
    return this.extractData<{
      deletedCount: number;
      failedIds: string[];
      errors: string[];
    }>(response);
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

  // Utility methods
  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }
}

// Create and export a singleton instance
export const apiClient = new ApiClient();
export default apiClient;
