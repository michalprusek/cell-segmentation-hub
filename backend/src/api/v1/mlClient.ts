import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import { config } from '../../utils/config';
import type { MlItem } from './objects';

/**
 * The public API's own door to the ML service.
 *
 * It does not go through `SegmentationService.requestSegmentation`: that
 * method is welded to an `Image` row in a project (it loads one, checks the
 * project type, writes status and results), and a stateless request has none.
 *
 * ONE inference at a time, process-wide, with a short queue. The ML service
 * already serialises everything behind its own lock, so more parallelism here
 * would not finish anything sooner — it would only let this API put several
 * requests ahead of the app's own queue worker. A full queue is refused with
 * `MlBusyError` rather than left to pile up behind connections that nginx
 * will cut at 600 s anyway.
 */
export const ML_QUEUE_LIMIT = 8;

export interface MlSegmentRequest {
  image: Buffer;
  filename: string;
  model: string;
  threshold?: number;
  detectHoles?: boolean;
  page: number;
  maxPixels: number;
  timeoutMs: number;
}

export interface MlSegmentResponse {
  polygons?: MlItem[];
  polylines?: MlItem[];
  image_size?: { width: number; height: number };
  image_metrics?: Record<string, unknown>;
  warnings?: unknown;
  input_conversion?: {
    from_mode: string;
    method: string;
    low_percentile: number;
    high_percentile: number;
    low: number;
    high: number;
  };
  page?: number;
  page_count?: number;
  inference_time?: number;
  threshold_used?: number;
}

export class MlBusyError extends Error {}
export class MlTimeoutError extends Error {}
export class MlUnavailableError extends Error {}
/** The ML service judged the REQUEST wrong (4xx). `detail` is its own. */
export class MlRejectedError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown
  ) {
    super(`ML service rejected the request with ${status}`);
  }
}

let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 1) {
    if (waiting.length >= ML_QUEUE_LIMIT) {
      throw new MlBusyError('Too many segmentation requests are waiting');
    }
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  active++;
  try {
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Requests waiting for the slot. For tests and diagnostics. */
export const mlQueueDepth = (): number => waiting.length;

export async function segmentWithMl(
  request: MlSegmentRequest
): Promise<MlSegmentResponse> {
  return withSlot(async () => {
    const form = new FormData();
    form.append('file', request.image, {
      filename: request.filename,
      contentType: 'application/octet-stream',
    });
    form.append('model', request.model);
    if (request.threshold !== undefined) {
      form.append('threshold', String(request.threshold));
    }
    if (request.detectHoles !== undefined) {
      form.append('detect_holes', String(request.detectHoles));
    }
    form.append('page', String(request.page));
    form.append('max_pixels', String(request.maxPixels));

    try {
      const response = await axios.post<MlSegmentResponse>(
        `${config.SEGMENTATION_SERVICE_URL}/api/v1/segment`,
        form,
        {
          headers: form.getHeaders(),
          timeout: request.timeoutMs,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );
      return response.data;
    } catch (error) {
      const failure = error as AxiosError<{ detail?: unknown }>;
      if (failure.code === 'ECONNABORTED' || failure.response?.status === 504) {
        throw new MlTimeoutError('The segmentation did not finish in time');
      }
      const status = failure.response?.status;
      if (status !== undefined && status >= 400 && status < 500) {
        throw new MlRejectedError(status, failure.response?.data?.detail);
      }
      throw new MlUnavailableError(
        status === undefined
          ? `ML service unreachable (${failure.code ?? 'no response'})`
          : `ML service answered ${status}`
      );
    }
  });
}
