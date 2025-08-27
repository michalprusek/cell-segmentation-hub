import { PrismaClient, Prisma } from '@prisma/client';
import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { ImageService } from './imageService';
import { ThumbnailService } from './thumbnailService';
import { getStorageProvider } from '../storage/index';
import { 
  CrossServiceTraceLinker, 
  RequestIdGenerator,
  TraceCorrelatedLogger 
} from '../utils/traceCorrelation';
import { addSpanAttributes as _addSpanAttributes, addSpanEvent, markSpanError, injectTraceHeaders } from '../middleware/tracing';

export interface SegmentationPoint {
  x: number;
  y: number;
}

export interface SegmentationPolygon {
  points: SegmentationPoint[];
  area: number;
  confidence: number;
  type: 'external' | 'internal';
  parent_id?: string; // For internal polygons, references the parent external polygon
}

export interface SegmentationRequest {
  imageId: string;
  model?: 'hrnet' | 'resunet_advanced' | 'resunet_small';
  threshold?: number;
  userId: string;
  detectHoles?: boolean;
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
  imageWidth?: number;
  imageHeight?: number;
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

export interface ImageForSegmentation {
  id: string;
  name: string;
  originalPath: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
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
    this.pythonServiceUrl = config.SEGMENTATION_SERVICE_URL;
    
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

    // Add request/response interceptors for logging (only if httpClient is properly initialized)
    if (this.httpClient && this.httpClient.interceptors) {
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
      throw new Error(`Error loading available models: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Request segmentation for an image
   */
  async requestSegmentation(request: SegmentationRequest): Promise<SegmentationResponse> {
    const tracer = trace.getTracer('segmentation-service', '1.0.0');
    const requestId = RequestIdGenerator.generateRequestId();
    
    return tracer.startActiveSpan('segmentation.request', {
      kind: SpanKind.INTERNAL,
      attributes: {
        'segmentation.image_id': request.imageId,
        'segmentation.model': request.model || 'hrnet',
        'segmentation.threshold': request.threshold || 0.5,
        'segmentation.detect_holes': request.detectHoles || false,
        'segmentation.user_id': request.userId,
        'request.id': requestId,
        'operation.name': 'segmentation_request',
      },
    }, async (span) => {
      const { imageId, model = 'hrnet', threshold = 0.5, userId, detectHoles } = request;
      const startTime = Date.now();

      try {
        TraceCorrelatedLogger.info('Starting segmentation request', {
          imageId,
          model,
          threshold,
          detectHoles,
          userId,
          requestId
        });

        addSpanEvent('segmentation.request.start', {
          'image_id': imageId,
          'model_name': model,
          'user_id': userId,
        });

        // Get image details and verify ownership
        span.addEvent('database.image.fetch.start');
        const image = await this.imageService.getImageById(imageId, userId);
        if (!image) {
          const error = new Error('Image not found or no access');
          markSpanError(error, {
            'error.type': 'authorization_error',
            'image_id': imageId,
            'user_id': userId,
          });
          throw error;
        }
        
        span.setAttributes({
          'image.name': image.name,
          'image.width': image.width || 0,
          'image.height': image.height || 0,
          'image.size_bytes': image.size || 0,
          'image.mime_type': image.mimeType || 'unknown',
        });
        
        span.addEvent('database.image.fetch.complete', {
          'image_name': image.name,
          'image_dimensions': `${image.width}x${image.height}`,
        });

        // Update image status to processing
        span.addEvent('database.status.update.start');
        await this.imageService.updateSegmentationStatus(imageId, 'processing', userId);
        span.addEvent('database.status.update.complete');

        // Get image buffer from storage
        span.addEvent('storage.image.fetch.start');
        const storage = getStorageProvider();
        const imageBuffer = await storage.getBuffer(image.originalPath);
        
        span.setAttributes({
          'storage.buffer_size': imageBuffer.length,
          'storage.path': image.originalPath,
        });
        
        span.addEvent('storage.image.fetch.complete', {
          'buffer_size': imageBuffer.length,
        });

        if (!imageBuffer) {
          const error = new Error('Failed to load image from storage');
          markSpanError(error, {
            'error.type': 'storage_error',
            'storage.path': image.originalPath,
          });
          throw error;
        }

        // Prepare form data for Python service
        span.addEvent('ml_service.request.prepare.start');
        const formData = new FormData();
        formData.append('file', imageBuffer, {
          filename: image.name,
          contentType: image.mimeType || 'image/jpeg'
        });

        // Add model, threshold and detect_holes parameters to form data
        formData.append('model', model);
        formData.append('threshold', threshold.toString());
        formData.append('detect_holes', (detectHoles ?? true).toString());

        span.addEvent('ml_service.request.prepare.complete', {
          'form_data.file_size': imageBuffer.length,
          'form_data.model': model,
          'form_data.threshold': threshold,
          'form_data.detect_holes': detectHoles ?? true,
        });

        TraceCorrelatedLogger.info('Sending segmentation request to ML service', {
          imageId,
          imageName: image.name,
          imageSize: imageBuffer.length,
          model,
          threshold,
          detectHoles,
          mlServiceUrl: this.pythonServiceUrl,
          requestId
        });

        // Create service call span within try/finally scope
        let mlCallSpan: unknown;
        const mlCallStartTime = Date.now();
        let response: unknown;
        
        try {
          mlCallSpan = CrossServiceTraceLinker.createServiceCallSpan({
            targetService: 'ml-service',
            operationName: 'segment',
            method: 'POST',
            endpoint: '/api/v1/segment',
            requestId,
          });

          // Inject trace headers for cross-service correlation
          const traceHeaders = injectTraceHeaders();
          
          // Make request to Python segmentation service
          response = await this.httpClient.post('/api/v1/segment', formData, {
            headers: {
              ...formData.getHeaders(),
              ...traceHeaders,
              'x-request-id': requestId,
              'x-user-id': userId,
              'x-operation': 'segmentation_request',
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
          });

          const mlCallDuration = Date.now() - mlCallStartTime;
          
          if (mlCallSpan) {
            mlCallSpan.setAttributes({
              'http.response.status_code': response.status,
              'ml.call.duration_ms': mlCallDuration,
              'ml.call.success': true,
              'response.size_bytes': JSON.stringify(response.data).length,
            });
            mlCallSpan.setStatus({ code: SpanStatusCode.OK });
          }

          span.addEvent('ml_service.request.complete', {
            'response.status': response.status,
            'response.duration_ms': mlCallDuration,
          });
        } catch (mlError) {
          const mlCallDuration = Date.now() - mlCallStartTime;
          
          if (mlCallSpan) {
            mlCallSpan.setAttributes({
              'ml.call.duration_ms': mlCallDuration,
              'ml.call.success': false,
            });
            
            mlCallSpan.setStatus({ 
              code: SpanStatusCode.ERROR, 
              message: (mlError as Error).message 
            });
          }
          
          markSpanError(mlError as Error, {
            'error.type': 'ml_service_error',
            'ml.service.url': this.pythonServiceUrl,
            'ml.call.duration_ms': mlCallDuration,
          });
          
          throw mlError;
        } finally {
          if (mlCallSpan) {
            mlCallSpan.end();
          }
        }

        // Validate response data exists before assignment
        if (!response || !response.data) {
          const error = new Error('Invalid response from ML service: missing data');
          logger.error('ML service response validation failed', { response, requestId });
          throw error;
        }

        const segmentationResult: SegmentationResponse = response.data;

        // Validate and trace segmentation results
        const polygonCount = segmentationResult.polygons?.length || 0;
        const totalDuration = Date.now() - startTime;
        
        span.setAttributes({
          'segmentation.result.polygon_count': polygonCount,
          'segmentation.result.model_used': segmentationResult.model_used,
          'segmentation.result.threshold_used': segmentationResult.threshold_used,
          'segmentation.result.processing_time_ms': segmentationResult.processing_time || 0,
          'segmentation.result.confidence': segmentationResult.confidence || 0,
          'segmentation.result.total_duration_ms': totalDuration,
          'segmentation.result.image_width': segmentationResult.image_size?.width || 0,
          'segmentation.result.image_height': segmentationResult.image_size?.height || 0,
        });
        
        span.addEvent('segmentation.results.validation.start');
        
        if (polygonCount === 0) {
          span.addEvent('segmentation.results.warning', {
            'warning.type': 'no_polygons_detected',
            'model_used': segmentationResult.model_used,
            'threshold_used': segmentationResult.threshold_used,
          });
          
          TraceCorrelatedLogger.warn('Segmentation returned 0 polygons - this may indicate an issue', {
            imageId,
            model: segmentationResult.model_used,
            threshold: segmentationResult.threshold_used,
            imageName: image.name,
            imageSize: segmentationResult.image_size,
            requestId
          });
          
          // Still save the results but with a warning flag
          segmentationResult.error = 'No polygons detected - image may not contain detectable cells or threshold may need adjustment';
        }

        // Save segmentation results to database
        span.addEvent('database.results.save.start');
        await this.saveSegmentationResultsInternal(imageId, segmentationResult);
        span.addEvent('database.results.save.complete');

        // Update image status - use 'segmented' even with 0 polygons to allow user review
        span.addEvent('database.status.final_update.start');
        await this.imageService.updateSegmentationStatus(imageId, 'segmented', userId);
        span.addEvent('database.status.final_update.complete');

        // Calculate vertices statistics for logging and tracing
        const verticesStats = segmentationResult.polygons.map(p => p.points?.length || 0);
        const totalVertices = verticesStats.reduce((sum, count) => sum + count, 0);
        const avgVertices = verticesStats.length > 0 ? totalVertices / verticesStats.length : 0;
        const maxVertices = Math.max(...verticesStats, 0);
        const minVertices = Math.min(...verticesStats, 0);

        span.setAttributes({
          'segmentation.vertices.total': totalVertices,
          'segmentation.vertices.average': Math.round(avgVertices),
          'segmentation.vertices.max': maxVertices,
          'segmentation.vertices.min': minVertices,
        });

        span.addEvent('segmentation.request.complete', {
          'success': true,
          'polygon_count': polygonCount,
          'total_duration_ms': totalDuration,
          'processing_time_ms': segmentationResult.processing_time || 0,
        });

        TraceCorrelatedLogger.info('Segmentation completed successfully', {
          imageId,
          model: segmentationResult.model_used,
          polygonCount: segmentationResult.polygons.length,
          processingTime: segmentationResult.processing_time,
          totalDuration,
          requestId,
          verticesStats: {
            total: totalVertices,
            average: Math.round(avgVertices),
            max: maxVertices,
            min: minVertices,
            perPolygon: verticesStats
          }
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return segmentationResult;

      } catch (error) {
        const totalDuration = Date.now() - startTime;
        const axiosError = error as AxiosError;
        
        // Add error attributes to span
        span.setAttributes({
          'segmentation.failed': true,
          'segmentation.error.type': axiosError.response?.status ? 'http_error' : 'network_error',
          'segmentation.error.status_code': axiosError.response?.status || 0,
          'segmentation.error.duration_ms': totalDuration,
        });
        
        span.addEvent('segmentation.request.failed', {
          'error_type': axiosError.response?.status ? 'http_error' : 'network_error',
          'status_code': axiosError.response?.status,
          'duration_ms': totalDuration,
        });
        
        // Mark span as error
        markSpanError(error as Error, {
          'segmentation.image_id': imageId,
          'segmentation.user_id': userId,
          'segmentation.model': model,
          'segmentation.threshold': threshold,
          'ml_service.url': this.pythonServiceUrl,
          'http.status_code': axiosError.response?.status,
          'http.status_text': axiosError.response?.statusText,
          'error.request_url': axiosError.config?.url,
          'error.request_method': axiosError.config?.method,
        });

        // Update image status to failed
        try {
          await this.imageService.updateSegmentationStatus(imageId, 'failed', userId);
          span.addEvent('database.status.failed_update.complete');
        } catch (statusError) {
          span.addEvent('database.status.failed_update.error', {
            'error': (statusError as Error).message,
          });
        }

        TraceCorrelatedLogger.error('Segmentation failed', error as Error, {
          imageId,
          userId,
          model,
          threshold,
          requestId,
          totalDuration,
          httpStatus: axiosError.response?.status,
          httpStatusText: axiosError.response?.statusText,
          responseData: axiosError.response?.data,
          requestUrl: axiosError.config?.url,
          requestMethod: axiosError.config?.method,
          mlServiceUrl: this.pythonServiceUrl
        });
        
        if (axiosError.response?.status === 400) {
          throw new Error(`Invalid image or segmentation parameters: ${(axiosError.response?.data as Record<string, unknown>)?.detail || 'Unknown error'}`)
        } else if (axiosError.response?.status === 500) {
          throw new Error(`Segmentation service error: ${(axiosError.response?.data as Record<string, unknown>)?.detail || 'Internal ML service error'}`);
        } else if (axiosError.code === 'ECONNREFUSED') {
          throw new Error('ML služba není dostupná - připojení odmítnuto');
        } else if (axiosError.code === 'ETIMEDOUT') {
          throw new Error('ML služba neodpovídá - timeout');
        } else {
          throw new Error(`Segmentation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    });
  }

  /**
   * Save segmentation results to database
   */
  public async saveSegmentationResults(
    imageId: string,
    polygons: SegmentationPolygon[],
    model: string,
    threshold: number,
    _confidence: number | null = null,
    processingTime: number | null = null,
    imageWidth: number | null = null,
    imageHeight: number | null = null,
    _userId: string
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

        // Validate polygon type
        if (!polygon.type || !['external', 'internal'].includes(polygon.type)) {
          logger.warn('Polygon has invalid or missing type', 'SegmentationService', { 
            type: polygon.type 
          });
          return false;
        }

        // Validate parent_id for internal polygons
        if (polygon.type === 'internal' && polygon.parent_id && typeof polygon.parent_id !== 'string') {
          logger.warn('Internal polygon has invalid parent_id', 'SegmentationService', { 
            parent_id: polygon.parent_id 
          });
          return false;
        }

        return true;
      });

      // Count polygon types for logging
      const externalCount = validPolygons.filter(p => p.type === 'external').length;
      const internalCount = validPolygons.filter(p => p.type === 'internal').length;

      logger.info('Polygon validation results', 'SegmentationService', {
        originalCount: segmentationResult.polygons?.length || 0,
        validCount: validPolygons.length,
        externalCount,
        internalCount,
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
    images: ImageForSegmentation[], 
    model = 'hrnet', 
    threshold = 0.5,
    detectHoles = true
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
        if (!image || !image.originalPath) {
          logger.warn('Skipping invalid image at index', 'SegmentationService', { index: i });
          continue;
        }
        const imageBuffer = await storage.getBuffer(image.originalPath);
        formData.append('files', imageBuffer, {
          filename: image.name,
          contentType: image.mimeType || 'image/jpeg'
        });
      }

      // Add model, threshold and detectHoles parameters
      formData.append('model', model);
      formData.append('threshold', threshold.toString());
      formData.append('detect_holes', detectHoles.toString());

      logger.info('Sending batch segmentation request to ML service', 'SegmentationService', {
        batchSize: images.length,
        model,
        threshold,
        detectHoles,
        mlServiceUrl: this.pythonServiceUrl
      });

      // Send request to ML service batch endpoint
      const response = await this.httpClient.post('/api/v1/batch-segment', formData, {
        headers: {
          ...formData.getHeaders()
        },
        timeout: 300000, // 5 minute timeout for batch processing
        maxBodyLength: 100 * 1024 * 1024, // 100MB
        maxContentLength: 100 * 1024 * 1024
      });

      if (!response.data || !response.data.results) {
        logger.error('Invalid response from ML service', new Error(`Invalid ML service response: status ${response.status}, data: ${JSON.stringify(response.data)}`));
        throw new Error('Invalid response from ML service');
      }

      const batchResult = response.data;
      const results: SegmentationResponse[] = [];

      // Process each result in the batch
      for (let i = 0; i < batchResult.results.length && i < images.length; i++) {
        const result = batchResult.results[i];
        const image = images[i];

        if (!image || !image.originalPath) {
          logger.warn('Missing or invalid image for batch result', 'SegmentationService', { batchIndex: i });
          continue;
        }

        if (result.success && result.polygons) {
          // Calculate vertices statistics for logging
          const verticesStats = result.polygons.map((p: SegmentationPolygon) => p.points?.length || 0);
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
      // Enhanced error logging for debugging ML service issues
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as AxiosError;
        logger.error('ML service HTTP error', error, 'SegmentationService', {
          batchSize: images.length,
          model,
          threshold,
          imageIds: images.map(img => img.id),
          mlServiceUrl: this.pythonServiceUrl,
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          responseData: axiosError.response?.data,
          requestConfig: {
            url: axiosError.config?.url,
            method: axiosError.config?.method,
            contentType: axiosError.config?.headers?.['Content-Type']
          }
        });
      } else {
        logger.error('Batch segmentation failed', error instanceof Error ? error : undefined, 'SegmentationService', {
          batchSize: images.length,
          model,
          threshold,
          imageIds: images.map(img => img.id)
        });
      }

      // Return failed results for all images
      return images.map((image) => ({
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
  async getSegmentationResults(imageId: string, userId: string): Promise<SegmentationResponse | null> {
    logger.debug('Getting segmentation results', 'SegmentationService', { imageId, userId });

    // Verify image ownership
    const image = await this.imageService.getImageById(imageId, userId);
    if (!image) {
      logger.debug('Image not found or no access', 'SegmentationService', { imageId, userId });
      return null; // Return null instead of throwing error, controller will handle 404
    }

    // Get segmentation data
    const segmentationData = await this.prisma.segmentation.findUnique({
      where: { imageId }
    });

    if (!segmentationData) {
      logger.debug('No segmentation data found for image', 'SegmentationService', { imageId });
      return null;
    }

    // Always use full polygons - no simplification
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

    const result: SegmentationResponse = {
      success: true,
      polygons: polygons,
      model_used: segmentationData.model,
      threshold_used: segmentationData.threshold,
      confidence: segmentationData.confidence,
      processing_time: segmentationData.processingTime ? segmentationData.processingTime / 1000 : null,
      image_size: { 
        width: segmentationData.imageWidth || 0, 
        height: segmentationData.imageHeight || 0 
      },
      // Add image dimensions for frontend rendering
      imageWidth: segmentationData.imageWidth || 0,
      imageHeight: segmentationData.imageHeight || 0
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
  async updateSegmentationResults(
    imageId: string, 
    polygons: SegmentationPolygon[], 
    userId: string, 
    imageWidth?: number, 
    imageHeight?: number
  ): Promise<{
    id: string;
    imageId: string;
    polygons: SegmentationPolygon[];
    model: string;
    threshold: number;
    confidence: number | null;
    imageWidth: number | null;
    imageHeight: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }> {
    // Verify image ownership
    const image = await this.imageService.getImageById(imageId, userId);
    if (!image) {
      throw new Error('Image not found or no access');
    }

    // Check if segmentation exists
    const existingSegmentation = await this.prisma.segmentation.findUnique({
      where: { imageId }
    });

    const polygonsJson = JSON.stringify(polygons);
    
    // Calculate statistics from polygons
    const externalPolygons = polygons.filter((p: SegmentationPolygon) => p.type === 'external');
    const internalPolygons = polygons.filter((p: SegmentationPolygon) => p.type === 'internal');
    const avgConfidence = polygons.reduce((sum: number, p: SegmentationPolygon) => sum + (p.confidence || 0.8), 0) / polygons.length;

    if (existingSegmentation) {
      // Update existing segmentation
      const updateData: Prisma.SegmentationUpdateInput = {
        polygons: polygonsJson,
        confidence: avgConfidence,
        updatedAt: new Date()
      };
      
      // Update image dimensions if provided
      if (imageWidth && imageHeight) {
        updateData.imageWidth = imageWidth;
        updateData.imageHeight = imageHeight;
        logger.debug('Updating segmentation with new image dimensions', 'SegmentationService', {
          imageId,
          oldDimensions: `${existingSegmentation.imageWidth}x${existingSegmentation.imageHeight}`,
          newDimensions: `${imageWidth}x${imageHeight}`
        });
      }
      
      const updated = await this.prisma.segmentation.update({
        where: { id: existingSegmentation.id },
        data: updateData
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
      const createData: Prisma.SegmentationCreateInput = {
        image: {
          connect: { id: imageId }
        },
        polygons: polygonsJson,
        model: 'manual', // Manual editing
        threshold: 0.5,
        confidence: avgConfidence
      };
      
      // Include image dimensions if provided
      if (imageWidth && imageHeight) {
        createData.imageWidth = imageWidth;
        createData.imageHeight = imageHeight;
        logger.debug('Creating segmentation with image dimensions', 'SegmentationService', {
          imageId,
          dimensions: `${imageWidth}x${imageHeight}`
        });
      }
      
      const created = await this.prisma.segmentation.create({
        data: createData
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
      throw new Error('Image not found or no access');
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
  async getProjectSegmentationStats(projectId: string, userId: string): Promise<{ totalImages: number; processedImages: number; totalPolygons: number; averageConfidence: number; models: Record<string, number> }> {
    // Verify project ownership
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId }
    });

    if (!project) {
      throw new Error('Project not found or no access');
    }

    // Get total images count for the project
    const totalImages = await this.prisma.image.count({
      where: { projectId }
    });

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

    const _averagePolygonsPerImage = totalSegmented > 0 ? totalPolygons / totalSegmented : 0;
    
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
      totalImages: totalImages,
      processedImages: totalSegmented,
      totalPolygons,
      averageConfidence,
      models: modelUsage
    };
  }

  /**
   * Batch process multiple images
   */
  async batchProcess(
    imageIds: string[],
    model: 'hrnet' | 'resunet_advanced' | 'resunet_small' = 'hrnet',
    threshold = 0.5,
    userId: string,
    detectHoles?: boolean
  ): Promise<{ successful: number; failed: number; results: Array<{ imageId: string; success: boolean; error?: string; result?: SegmentationResponse }> }> {
    const results = [];
    let successful = 0;
    let failed = 0;

    logger.info('Starting batch segmentation', 'SegmentationService', {
      imageCount: imageIds.length,
      model,
      threshold,
      detectHoles,
      userId
    });

    for (const imageId of imageIds) {
      try {
        const result = await this.requestSegmentation({
          imageId,
          model,
          threshold,
          userId,
          detectHoles
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

export const segmentationService = new SegmentationService();