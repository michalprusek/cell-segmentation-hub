import { Request, Response, NextFunction } from 'express';
import { ApiResponse, PaginatedResponse, ApiError } from '../types';
import { logger } from './logger';

export const ResponseHelper = {
  /**
   * Send successful response
   */
  success<T>(
    res: Response,
    data?: T,
    message?: string,
    statusCode = 200
  ): Response<ApiResponse<T>> {
    const response: ApiResponse<T> = {
      success: true,
      data,
      message
    };

    return res.status(statusCode).json(response);
  },

  /**
   * Send paginated response
   */
  paginated<T>(
    res: Response,
    data: T[],
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    },
    message?: string,
    statusCode = 200
  ): Response<PaginatedResponse<T>> {
    const response: PaginatedResponse<T> = {
      success: true,
      data,
      pagination,
      message
    };

    return res.status(statusCode).json(response);
  },

  /**
   * Send error response
   */
  error(
    res: Response,
    error: string | ApiError,
    statusCode = 400,
    logError?: Error,
    context?: string
  ): Response<ApiResponse> {
    let apiError: ApiError;

    if (typeof error === 'string') {
      apiError = {
        code: 'GENERIC_ERROR',
        message: error
      };
    } else {
      apiError = error;
    }

    // Log the error
    if (logError || statusCode >= 500) {
      logger.error(
        `API Error: ${apiError.message}`,
        logError,
        context,
        { code: apiError.code, statusCode }
      );
    } else {
      logger.warn(
        `API Warning: ${apiError.message}`,
        context,
        { code: apiError.code, statusCode }
      );
    }

    const response: ApiResponse = {
      success: false,
      error: apiError.message,
      code: apiError.code,
      details: apiError.details
    };

    return res.status(statusCode).json(response);
  },

  /**
   * Send bad request error
   */
  badRequest(
    res: Response,
    message = 'Neplatný požadavek',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'BAD_REQUEST',
      message
    };

    return ResponseHelper.error(res, apiError, 400, undefined, context);
  },

  /**
   * Send validation error response
   */
  validationError(
    res: Response,
    errors: Record<string, string[]> | string,
    context?: string
  ): Response<ApiResponse> {
    const message = typeof errors === 'string' 
      ? errors 
      : 'Validation error';

    const apiError: ApiError = {
      code: 'VALIDATION_ERROR',
      message,
      details: typeof errors === 'object' ? errors : undefined
    };

    return ResponseHelper.error(res, apiError, 400, undefined, context);
  },

  /**
   * Send unauthorized error
   */
  unauthorized(
    res: Response,
    message = 'Unauthorized access',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'UNAUTHORIZED',
      message
    };

    return ResponseHelper.error(res, apiError, 401, undefined, context);
  },

  /**
   * Send forbidden error
   */
  forbidden(
    res: Response,
    message = 'Insufficient permissions',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'FORBIDDEN',
      message
    };

    return ResponseHelper.error(res, apiError, 403, undefined, context);
  },

  /**
   * Send not found error
   */
  notFound(
    res: Response,
    message = 'Zdroj nenalezen',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'NOT_FOUND',
      message
    };

    return ResponseHelper.error(res, apiError, 404, undefined, context);
  },

  /**
   * Send conflict error
   */
  conflict(
    res: Response,
    message = 'Konflikt dat',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'CONFLICT',
      message
    };

    return ResponseHelper.error(res, apiError, 409, undefined, context);
  },

  /**
   * Send rate limit error
   */
  rateLimit(
    res: Response,
    message = 'Too many requests',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'RATE_LIMIT_EXCEEDED',
      message
    };

    return ResponseHelper.error(res, apiError, 429, undefined, context);
  },

  /**
   * Send internal server error
   */
  internalError(
    res: Response,
    error?: Error,
    message = 'Interní chyba serveru',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'INTERNAL_ERROR',
      message
    };

    return ResponseHelper.error(res, apiError, 500, error, context);
  },

  /**
   * Send service unavailable error
   */
  serviceUnavailable(
    res: Response,
    message = 'Service unavailable',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'SERVICE_UNAVAILABLE',
      message
    };

    return ResponseHelper.error(res, apiError, 503, undefined, context);
  }
};

// Helper function for async error handling
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Helper function to calculate pagination
export const calculatePagination = (
  page = 1,
  limit = 10,
  total: number
): {page: number; limit: number; total: number; totalPages: number; offset: number; hasNext: boolean; hasPrev: boolean} => {
  const offset = (page - 1) * limit;
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    offset,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
};