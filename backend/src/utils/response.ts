import { Request, Response, NextFunction } from 'express';
import { ApiResponse, PaginatedResponse, ApiError } from '../types';
import { logger } from './logger';

export class ResponseHelper {
  /**
   * Send successful response
   */
  static success<T>(
    res: Response,
    data?: T,
    message?: string,
    statusCode: number = 200
  ): Response<ApiResponse<T>> {
    const response: ApiResponse<T> = {
      success: true,
      data,
      message
    };

    return res.status(statusCode).json(response);
  }

  /**
   * Send paginated response
   */
  static paginated<T>(
    res: Response,
    data: T[],
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    },
    message?: string,
    statusCode: number = 200
  ): Response<PaginatedResponse<T>> {
    const response: PaginatedResponse<T> = {
      success: true,
      data,
      pagination,
      message
    };

    return res.status(statusCode).json(response);
  }

  /**
   * Send error response
   */
  static error(
    res: Response,
    error: string | ApiError,
    statusCode: number = 400,
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
      error: apiError.message
    };

    return res.status(statusCode).json(response);
  }

  /**
   * Send bad request error
   */
  static badRequest(
    res: Response,
    message: string = 'Neplatný požadavek',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'BAD_REQUEST',
      message
    };

    return ResponseHelper.error(res, apiError, 400, undefined, context);
  }

  /**
   * Send validation error response
   */
  static validationError(
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
  }

  /**
   * Send unauthorized error
   */
  static unauthorized(
    res: Response,
    message: string = 'Unauthorized access',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'UNAUTHORIZED',
      message
    };

    return ResponseHelper.error(res, apiError, 401, undefined, context);
  }

  /**
   * Send forbidden error
   */
  static forbidden(
    res: Response,
    message: string = 'Insufficient permissions',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'FORBIDDEN',
      message
    };

    return ResponseHelper.error(res, apiError, 403, undefined, context);
  }

  /**
   * Send not found error
   */
  static notFound(
    res: Response,
    message: string = 'Zdroj nenalezen',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'NOT_FOUND',
      message
    };

    return ResponseHelper.error(res, apiError, 404, undefined, context);
  }

  /**
   * Send conflict error
   */
  static conflict(
    res: Response,
    message: string = 'Konflikt dat',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'CONFLICT',
      message
    };

    return ResponseHelper.error(res, apiError, 409, undefined, context);
  }

  /**
   * Send rate limit error
   */
  static rateLimit(
    res: Response,
    message: string = 'Too many requests',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'RATE_LIMIT_EXCEEDED',
      message
    };

    return ResponseHelper.error(res, apiError, 429, undefined, context);
  }

  /**
   * Send internal server error
   */
  static internalError(
    res: Response,
    error?: Error,
    message: string = 'Interní chyba serveru',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'INTERNAL_ERROR',
      message
    };

    return ResponseHelper.error(res, apiError, 500, error, context);
  }

  /**
   * Send service unavailable error
   */
  static serviceUnavailable(
    res: Response,
    message: string = 'Service unavailable',
    context?: string
  ): Response<ApiResponse> {
    const apiError: ApiError = {
      code: 'SERVICE_UNAVAILABLE',
      message
    };

    return ResponseHelper.error(res, apiError, 503, undefined, context);
  }
}

// Helper function for async error handling
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Helper function to calculate pagination
export const calculatePagination = (
  page: number = 1,
  limit: number = 10,
  total: number
) => {
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