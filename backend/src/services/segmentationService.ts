import { PrismaClient } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { ImageService } from './imageService';
import { ThumbnailService } from './thumbnailService';
import { getStorageProvider } from '../storage/index';

export interface SegmentationPoint {
  x: number;
  y: number;
}

export interface SegmentationPolygon {
  points: SegmentationPoint[];
  area: number;
  confidence: number;
}

export interface SegmentationRequest {
  imageId: string;
  model?: 'hrnet' | 'resunet_advanced' | 'resunet_small';
  threshold?: number;
  userId: string;
}

export interface SegmentationResponse {
  success: boolean;
  polygons: SegmentationPolygon[];
  model_used: string;
  threshold_used: number;
  processing_time: number | null;
  confidence?: number | null;
  image_size: {
    width: number;
    height: number;
  };
  error?: string;
}

export interface SegmentationTaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: SegmentationResponse;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface ModelInfo {
  name: string;
  description: string;
  parameters: number;
  input_size: number[];
  available: boolean;
}

export interface ModelsResponse {
  models: ModelInfo[];
}

export class SegmentationService {
  private httpClient: AxiosInstance;
  private pythonServiceUrl: string;
  private thumbnailService: ThumbnailService;
  
  constructor(
    private prisma: PrismaClient,
    private imageService: ImageService
  ) {
    this.thumbnailService = new ThumbnailService(prisma);
    // Python microservice URL - can be configured via environment
    this.pythonServiceUrl = process.env.SEGMENTATION_SERVICE_URL || process.env.PYTHON_SEGMENTATION_URL || 'http://localhost:8000';
    
    // Configure HTTP client for Python microservice
    this.httpClient = axios.create({
      baseURL: this.pythonServiceUrl,
      timeout: 300000, // 5 minutes timeout for segmentation
      headers: {
        'Accept': 'application/json',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    // Add request/response interceptors for logging
    this.httpClient.interceptors.request.use(
      (config) => {
        logger.info('Sending request to Python service', 'SegmentationService', {
          url: config.url,
          method: config.method,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        logger.error('Request interceptor error', error instanceof Error ? error : undefined, 'SegmentationService');
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        logger.info('Received response from Python service', 'SegmentationService', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        logger.error('Response interceptor error', error instanceof Error ? error : undefined, 'SegmentationService', {
          status: error.response?.status,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Check if Python segmentation service is healthy
   */
  async checkServiceHealth(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/api/v1/health');
      return response.data.status === 'healthy';
    } catch (error) {
      logger.error('Python segmentation service health check failed', error instanceof Error ? error : undefined, 'SegmentationService');
      return false;
    }
  }

  /**
   * Get available models from Python service
   */
  async getAvailableModels(): Promise<ModelsResponse> {
    try {
      const response = await this.httpClient.get('/api/v1/models');
      return response.data;
    } catch (error) {
      logger.error('Failed to get available models', error instanceof Error ? error : undefined, 'SegmentationService');
      throw new Error(`Chyba při načítání dostupných modelů: ${error instanceof Error ? error.message : 'Neznámá chyba'}`);
    }
  }

  /**
   * Request segmentation for an image
   */
  async requestSegmentation(request: SegmentationRequest): Promise<SegmentationResponse> {
    const { imageId, model = 'hrnet', threshold = 0.5, userId } = request;

    logger.info('Starting segmentation request', 'SegmentationService', {
      imageId,
      model,
      threshold,
      userId
    });

    // Get image details and verify ownership
    const image = await this.imageService.getImageById(imageId, userId);
    if (!image) {
      throw new Error('Obrázek nenalezen nebo nemáte oprávnění');
    }

    // Update image status to processing
    await this.imageService.updateSegmentationStatus(imageId, 'processing', userId);

    try {
      // Get image buffer from storage
      const storage = getStorageProvider();
      const imageBuffer = await storage.getBuffer(image.originalPath);

      if (!imageBuffer) {
        throw new Error('Nepodařilo se načíst obrázek ze storage');
      }

      // Prepare form data for Python service
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename: image.name,
        contentType: image.mimeType || 'image/jpeg'
      });

      logger.info('Sending segmentation request to ML service', 'SegmentationService', {
        imageId,
        imageName: image.name,
        imageSize: imageBuffer.length,
        model,
        threshold,
        mlServiceUrl: this.pythonServiceUrl
      });

      // Make request to Python segmentation service
      const response = await this.httpClient.post('/api/v1/segment', formData, {
        params: {
          model,
          threshold
        },
        headers: {
          ...formData.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      const segmentationResult: SegmentationResponse = response.data;

      // Validate segmentation results - check for empty polygon results
      const polygonCount = segmentationResult.polygons?.length || 0;
      if (polygonCount === 0) {
        logger.warn('Segmentation returned 0 polygons - this may indicate an issue', 'SegmentationService', {
          imageId,
          model: segmentationResult.model_used,
          threshold: segmentationResult.threshold_used,
          imageName: image.name,
          imageSize: segmentationResult.image_size
        });
        
        // Still save the results but with a warning flag
        segmentationResult.error = 'No polygons detected - image may not contain detectable cells or threshold may need adjustment';
      }

      // Save segmentation results to database
      await this.saveSegmentationResultsInternal(imageId, segmentationResult);

      // Update image status - use 'segmented' even with 0 polygons to allow user review
      await this.imageService.updateSegmentationStatus(imageId, 'segmented', userId);

      // Calculate vertices statistics for logging
      const verticesStats = segmentationResult.polygons.map(p => p.points?.length || 0);
      const totalVertices = verticesStats.reduce((sum, count) => sum + count, 0);
      const avgVertices = verticesStats.length > 0 ? totalVertices / verticesStats.length : 0;
      const maxVertices = Math.max(...verticesStats, 0);
      const minVertices = Math.min(...verticesStats, 0);

      logger.info('Segmentation completed successfully', 'SegmentationService', {
        imageId,
        model: segmentationResult.model_used,
        polygonCount: segmentationResult.polygons.length,
        processingTime: segmentationResult.processing_time,
        verticesStats: {
          total: totalVertices,
          average: Math.round(avgVertices),
          max: maxVertices,
          min: minVertices,
          perPolygon: verticesStats
        }
      });

      return segmentationResult;

    } catch (error) {
      // Update image status to failed
      await this.imageService.updateSegmentationStatus(imageId, 'failed', userId);

      logger.error('Segmentation failed', error instanceof Error ? error : undefined, 'SegmentationService', {
        imageId,
        userId
      });

      const axiosError = error as any;
      
      // Log detailed error information
      logger.error('ML service communication error', error instanceof Error ? error : undefined, 'SegmentationService', {
        imageId,
        userId,
        model,
        threshold,
        httpStatus: axiosError.response?.status,
        httpStatusText: axiosError.response?.statusText,
        responseData: axiosError.response?.data,
        requestUrl: axiosError.config?.url,
        requestMethod: axiosError.config?.method,
        mlServiceUrl: this.pythonServiceUrl
      });
      
      if (axiosError.response?.status === 400) {
        throw new Error(`Neplatný obrázek nebo parametry segmentace: ${axiosError.response?.data?.detail || 'Neznámá chyba'}`);
      } else if (axiosError.response?.status === 500) {
        throw new Error(`Chyba segmentační služby: ${axiosError.response?.data?.detail || 'Vnitřní chyba ML služby'}`);
      } else if (axiosError.code === 'ECONNREFUSED') {
        throw new Error('ML služba není dostupná - připojení odmítnuto');
      } else if (axiosError.code === 'ETIMEDOUT') {
        throw new Error('ML služba neodpovídá - timeout');
      } else {
        throw new Error(`Chyba při segmentaci: ${error instanceof Error ? error.message : 'Neznámá chyba'}`);
      }
    }
  }

  /**
   * Save segmentation results to database
   */
  public async saveSegmentationResults(
    imageId: string,
    polygons: any[],
    model: string,
    threshold: number,
    confidence: number | null = null,
    processingTime: number | null = null,
    imageWidth: number | null = null,
    imageHeight: number | null = null,
    userId: string
  ): Promise<void> {
    // Create compatible segmentation result object
    const segmentationResult: SegmentationResponse = {
      success: true,
      polygons: polygons,
      model_used: model,
      threshold_used: threshold,
      processing_time: processingTime ? processingTime / 1000 : null,
      image_size: {
        width: imageWidth || 0,
        height: imageHeight || 0
      }
    };

    return this.saveSegmentationResultsInternal(imageId, segmentationResult);
  }

  /**
   * Internal method to save segmentation results to database
   */
  private async saveSegmentationResultsInternal(
    imageId: string,
    segmentationResult: SegmentationResponse
  ): Promise<void> {
    try {
      // Log the full segmentation result for debugging
      logger.info('Received segmentation result for saving', 'SegmentationService', {
        imageId,
        hasImageSize: !!segmentationResult.image_size,
        imageSize: segmentationResult.image_size,
        polygonCount: segmentationResult.polygons?.length || 0,
        modelUsed: segmentationResult.model_used,
        thresholdUsed: segmentationResult.threshold_used
      });

      // Validate required fields
      if (!segmentationResult.image_size) {
        throw new Error('Missing image_size in segmentation result');
      }

      if (typeof segmentationResult.image_size.width !== 'number' || 
          typeof segmentationResult.image_size.height !== 'number') {
        throw new Error(`Invalid image size format: width=${segmentationResult.image_size.width}, height=${segmentationResult.image_size.height}`);
      }

      // Validate and clean polygons before storage
      const validPolygons = (segmentationResult.polygons || []).filter(polygon => {
        // Validate polygon structure
        if (!polygon || typeof polygon !== 'object') {
          logger.warn('Invalid polygon structure detected', 'SegmentationService', { polygon });
          return false;
        }

        // Validate points array
        if (!Array.isArray(polygon.points) || polygon.points.length < 3) {
          logger.warn('Polygon has insufficient points', 'SegmentationService', { 
            pointsLength: polygon.points?.length 
          });
          return false;
        }

        // Validate each point
        const validPoints = polygon.points.every(point => {
          return point !== null && 
                 point !== undefined && 
                 typeof point.x === 'number' && 
                 typeof point.y === 'number' && 
                 !isNaN(point.x) && 
                 !isNaN(point.y) &&
                 isFinite(point.x) &&
                 isFinite(point.y);
        });

        if (!validPoints) {
          logger.warn('Polygon has invalid points', 'SegmentationService', { 
            points: polygon.points 
          });
          return false;
        }

        return true;
      });

      logger.info('Polygon validation results', 'SegmentationService', {
        originalCount: segmentationResult.polygons?.length || 0,
        validCount: validPolygons.length,
        filteredOut: (segmentationResult.polygons?.length || 0) - validPolygons.length
      });

      // Convert polygons to JSON format for storage
      const segmentationData = {
        polygons: validPolygons,
        modelUsed: segmentationResult.model_used,
        thresholdUsed: segmentationResult.threshold_used,
        processingTime: segmentationResult.processing_time,
        imageSize: segmentationResult.image_size,
        createdAt: new Date(),
        polygonCount: validPolygons.length,
        averageConfidence: validPolygons.length > 0
          ? validPolygons.reduce((sum, p) => sum + (p.confidence || 0), 0) / validPolygons.length
          : 0
      };

      // Log upsert data
      const upsertData = {
        where: { imageId },
        update: {
          polygons: JSON.stringify(validPolygons),
          model: segmentationResult.model_used,
          threshold: segmentationResult.threshold_used,
          confidence: segmentationData.averageConfidence,
          processingTime: segmentationResult.processing_time ? Math.round(segmentationResult.processing_time * 1000) : null,
          imageWidth: segmentationResult.image_size.width,
          imageHeight: segmentationResult.image_size.height,
          updatedAt: new Date()
        },
        create: {
          id: uuidv4(),
          imageId,
          polygons: JSON.stringify(validPolygons),
          model: segmentationResult.model_used,
          threshold: segmentationResult.threshold_used,
          confidence: segmentationData.averageConfidence,
          processingTime: segmentationResult.processing_time ? Math.round(segmentationResult.processing_time * 1000) : null,
          imageWidth: segmentationResult.image_size.width,
          imageHeight: segmentationResult.image_size.height,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      logger.info('About to execute segmentation upsert', 'SegmentationService', {
        imageId,
        updateImageWidth: upsertData.update.imageWidth,
        updateImageHeight: upsertData.update.imageHeight,
        createImageWidth: upsertData.create.imageWidth,
        createImageHeight: upsertData.create.imageHeight
      });

      // Save to database - create or update segmentation data
      const result = await this.prisma.segmentation.upsert(upsertData);

      // Generate thumbnails asynchronously after segmentation save
      this.thumbnailService.generateThumbnails(result.id).catch(error => {
        logger.error(
          `Failed to generate thumbnails after ML segmentation for ${imageId}`,
          error instanceof Error ? error : new Error(String(error)),
          'SegmentationService'
        );
      });

      logger.info('Segmentation results saved to database', 'SegmentationService', {
        imageId,
        polygonCount: validPolygons.length,
        segmentationId: result.id
      });

    } catch (error) {
      logger.error('Failed to save segmentation results', error instanceof Error ? error : undefined, 'SegmentationService', {
        imageId
      });
      throw error;
    }
  }

  /**
   * Request batch segmentation for multiple images using ML service batch endpoint
   */
  async requestBatchSegmentation(
    images: any[], 
    model = 'hrnet', 
    threshold = 0.5
  ): Promise<SegmentationResponse[]> {
    logger.info('Starting batch segmentation request', 'SegmentationService', {
      batchSize: images.length,
      model,
      threshold,
      imageIds: images.map(img => img.id)
    });

    try {
      // Create FormData for batch request
      const formData = new FormData();
      const storage = getStorageProvider();

      // Add each image file to the form data
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const imageBuffer = await storage.getBuffer(image.originalPath);
        formData.append('files', imageBuffer, {
          filename: image.name,
          contentType: image.mimeType || 'image/jpeg'
        });
      }

      // Add model and threshold parameters
      formData.append('model', model);
      formData.append('threshold', threshold.toString());

      logger.info('Sending batch segmentation request to ML service', 'SegmentationService', {
        batchSize: images.length,
        model,
        threshold,
        mlServiceUrl: this.pythonServiceUrl
      });

      // Send request to ML service batch endpoint
      const response = await this.httpClient.post('/api/v1/batch-segment', formData, {
        headers: {
          ...formData.getHeaders(),
          'Content-Type': 'multipart/form-data'
        },
        timeout: 300000, // 5 minute timeout for batch processing
        maxBodyLength: 100 * 1024 * 1024, // 100MB
        maxContentLength: 100 * 1024 * 1024
      });

      if (!response.data || !response.data.results) {
        throw new Error('Invalid response from ML service');
      }

      const batchResult = response.data;
      const results: SegmentationResponse[] = [];

      // Process each result in the batch
      for (let i = 0; i < batchResult.results.length; i++) {
        const result = batchResult.results[i];
        const image = images[i];

        if (result.success && result.polygons) {
          // Calculate vertices statistics for logging
          const verticesStats = result.polygons.map((p: any) => p.points?.length || 0);
          const totalVertices = verticesStats.reduce((sum: number, count: number) => sum + count, 0);
          const avgVertices = verticesStats.length > 0 ? totalVertices / verticesStats.length : 0;
          const maxVertices = Math.max(...verticesStats, 0);

          logger.info('Batch segmentation completed successfully', 'SegmentationService', {
            imageId: image.id,
            batchIndex: i,
            model: result.model_used,
            polygonCount: result.polygons.length,
            processingTime: result.processing_time,
            verticesStats: {
              total: totalVertices,
              average: Math.round(avgVertices),
              max: maxVertices,
              perPolygon: verticesStats
            }
          });

          results.push({
            success: true,
            polygons: result.polygons,
            model_used: result.model_used,
            threshold_used: result.threshold_used,
            confidence: result.confidence,
            processing_time: result.processing_time,
            image_size: result.image_size
          });
        } else {
          logger.warn('Batch segmentation item failed', 'SegmentationService', {
            imageId: image.id,
            batchIndex: i,
            error: result.error || 'No polygons found'
          });

          results.push({
            success: false,
            polygons: [],
            model_used: model,
            threshold_used: threshold,
            confidence: null,
            processing_time: null,
            image_size: { width: image.width || 0, height: image.height || 0 }
          });
        }
      }

      logger.info('Batch segmentation completed', 'SegmentationService', {
        batchSize: images.length,
        successCount: results.filter(r => r.success).length,
        totalProcessingTime: batchResult.processing_time
      });

      return results;

    } catch (error) {
      logger.error('Batch segmentation failed', error instanceof Error ? error : undefined, 'SegmentationService', {
        batchSize: images.length,
        model,
        threshold,
        imageIds: images.map(img => img.id)
      });

      // Return failed results for all images
      return images.map((image, index) => ({
        success: false,
        polygons: [],
        model_used: model,
        threshold_used: threshold,
        confidence: null,
        processing_time: null,
        image_size: { width: image.width || 0, height: image.height || 0 },
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  /**
   * Get segmentation results for an image
   */
  async getSegmentationResults(imageId: string, userId: string): Promise<any | null> {
    logger.debug('Getting segmentation results', 'SegmentationService', { imageId, userId });

    // Verify image ownership
    const image = await this.imageService.getImageById(imageId, userId);
    if (!image) {
      logger.warn('Image not found or no access', 'SegmentationService', { imageId, userId });
      throw new Error('Obrázek nenalezen nebo nemáte oprávnění');
    }

    // Get segmentation data
    const segmentationData = await this.prisma.segmentation.findUnique({
      where: { imageId }
    });

    if (!segmentationData) {
      logger.debug('No segmentation data found for image', 'SegmentationService', { imageId });
      return null;
    }

    // Parse polygons from JSON and prepare result
    let polygons = [];
    try {
      polygons = JSON.parse(segmentationData.polygons);
    } catch (error) {
      logger.error('Failed to parse polygons JSON', error instanceof Error ? error : undefined, 'SegmentationService', { 
        imageId, 
        polygonsRaw: segmentationData.polygons 
      });
      polygons = [];
    }

    const result = {
      polygons: polygons,
      modelUsed: segmentationData.model,
      thresholdUsed: segmentationData.threshold,
      confidence: segmentationData.confidence,
      processingTime: segmentationData.processingTime,
      imageWidth: segmentationData.imageWidth,
      imageHeight: segmentationData.imageHeight,
      createdAt: segmentationData.createdAt,
      updatedAt: segmentationData.updatedAt
    };

    logger.debug('Successfully retrieved segmentation results', 'SegmentationService', {
      imageId,
      polygonCount: polygons.length,
      model: segmentationData.model,
      imageSize: `${segmentationData.imageWidth}x${segmentationData.imageHeight}`
    });

    return result;
  }

  /**
   * Update segmentation results for an image
   */
  async updateSegmentationResults(imageId: string, polygons: any[], userId: string): Promise<any> {
    // Verify image ownership
    const image = await this.imageService.getImageById(imageId, userId);
    if (!image) {
      throw new Error('Obrázek nenalezen nebo nemáte oprávnění');
    }

    // Check if segmentation exists
    const existingSegmentation = await this.prisma.segmentation.findUnique({
      where: { imageId }
    });

    const polygonsJson = JSON.stringify(polygons);
    
    // Calculate statistics from polygons
    const externalPolygons = polygons.filter((p: any) => p.type === 'external');
    const internalPolygons = polygons.filter((p: any) => p.type === 'internal');
    const avgConfidence = polygons.reduce((sum: number, p: any) => sum + (p.confidence || 0.8), 0) / polygons.length;

    if (existingSegmentation) {
      // Update existing segmentation
      const updated = await this.prisma.segmentation.update({
        where: { id: existingSegmentation.id },
        data: {
          polygons: polygonsJson,
          confidence: avgConfidence,
          updatedAt: new Date()
        }
      });

      // Generate thumbnails asynchronously after update
      this.thumbnailService.generateThumbnails(updated.id).catch(error => {
        logger.error(
          `Failed to generate thumbnails after segmentation update for ${imageId}`,
          error instanceof Error ? error : new Error(String(error)),
          'SegmentationService'
        );
      });

      logger.info('Segmentation results updated', 'SegmentationService', { 
        imageId, 
        userId,
        polygonCount: polygons.length,
        externalCount: externalPolygons.length,
        internalCount: internalPolygons.length
      });

      return {
        id: updated.id,
        imageId: updated.imageId,
        polygons: polygons,
        model: updated.model,
        threshold: updated.threshold,
        confidence: updated.confidence,
        imageWidth: updated.imageWidth,
        imageHeight: updated.imageHeight,
        status: 'completed',
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt
      };
    } else {
      // Create new segmentation record
      const created = await this.prisma.segmentation.create({
        data: {
          imageId,
          polygons: polygonsJson,
          model: 'manual', // Manual editing
          threshold: 0.5,
          confidence: avgConfidence
        }
      });

      // Update image segmentation status
      await this.imageService.updateSegmentationStatus(imageId, 'segmented', userId);

      // Generate thumbnails asynchronously after creation
      this.thumbnailService.generateThumbnails(created.id).catch(error => {
        logger.error(
          `Failed to generate thumbnails after segmentation creation for ${imageId}`,
          error instanceof Error ? error : new Error(String(error)),
          'SegmentationService'
        );
      });

      logger.info('Segmentation results created', 'SegmentationService', { 
        imageId, 
        userId,
        polygonCount: polygons.length,
        externalCount: externalPolygons.length,
        internalCount: internalPolygons.length
      });

      return {
        id: created.id,
        imageId: created.imageId,
        polygons: polygons,
        model: created.model,
        threshold: created.threshold,
        confidence: created.confidence,
        imageWidth: created.imageWidth,
        imageHeight: created.imageHeight,
        status: 'completed',
        createdAt: created.createdAt,
        updatedAt: created.updatedAt
      };
    }
  }

  /**
   * Delete segmentation results for an image
   */
  async deleteSegmentationResults(imageId: string, userId: string): Promise<void> {
    // Verify image ownership
    const image = await this.imageService.getImageById(imageId, userId);
    if (!image) {
      throw new Error('Obrázek nenalezen nebo nemáte oprávnění');
    }

    // Delete segmentation data
    await this.prisma.segmentation.deleteMany({
      where: { imageId }
    });

    // Reset image segmentation status
    await this.imageService.updateSegmentationStatus(imageId, 'no_segmentation', userId);

    logger.info('Segmentation results deleted', 'SegmentationService', { imageId, userId });
  }

  /**
   * Get segmentation statistics for a project
   */
  async getProjectSegmentationStats(projectId: string, userId: string): Promise<any> {
    // Verify project ownership
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId }
    });

    if (!project) {
      throw new Error('Projekt nenalezen nebo nemáte oprávnění');
    }

    // Get all segmentation data for the project
    const segmentationData = await this.prisma.segmentation.findMany({
      where: {
        image: {
          projectId
        }
      },
      include: {
        image: {
          select: {
            name: true,
            segmentationStatus: true
          }
        }
      }
    });

    // Calculate statistics
    const totalSegmented = segmentationData.length;
    
    // Calculate total polygons by parsing JSON data
    const totalPolygons = segmentationData.reduce((sum, data) => {
      try {
        const polygons = JSON.parse(data.polygons);
        return sum + (Array.isArray(polygons) ? polygons.length : 0);
      } catch {
        return sum;
      }
    }, 0);

    const averagePolygonsPerImage = totalSegmented > 0 ? totalPolygons / totalSegmented : 0;
    
    const averageConfidence = segmentationData.length > 0
      ? segmentationData.reduce((sum, data) => sum + (data.confidence || 0), 0) / segmentationData.length
      : 0;

    const modelUsage: Record<string, number> = {};
    segmentationData.forEach(data => {
      const model = data.model;
      if (model) {
        modelUsage[model] = (modelUsage[model] || 0) + 1;
      }
    });

    return {
      totalSegmented,
      totalPolygons,
      averagePolygonsPerImage,
      averageConfidence,
      modelUsage
    };
  }

  /**
   * Batch process multiple images
   */
  async batchProcess(
    imageIds: string[],
    model: 'hrnet' | 'resunet_advanced' | 'resunet_small' = 'hrnet',
    threshold = 0.5,
    userId: string
  ): Promise<{ successful: number; failed: number; results: any[] }> {
    const results = [];
    let successful = 0;
    let failed = 0;

    logger.info('Starting batch segmentation', 'SegmentationService', {
      imageCount: imageIds.length,
      model,
      threshold,
      userId
    });

    for (const imageId of imageIds) {
      try {
        const result = await this.requestSegmentation({
          imageId,
          model,
          threshold,
          userId
        });
        
        results.push({
          imageId,
          success: true,
          result
        });
        successful++;

      } catch (error) {
        results.push({
          imageId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        failed++;

        logger.error('Batch processing failed for image', error instanceof Error ? error : undefined, 'SegmentationService', {
          imageId
        });
      }
    }

    logger.info('Batch segmentation completed', 'SegmentationService', {
      successful,
      failed,
      userId
    });

    return {
      successful,
      failed,
      results
    };
  }
}