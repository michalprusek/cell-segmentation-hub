/**
 * Message shapes shared by png16.worker and its client.
 *
 * Kept in their own module so the client can import the types without pulling
 * the worker's module graph into the main bundle.
 */

export interface DecodeRequest {
  /** Correlates the response; the client keys its pending map on this. */
  id: number;
  /** Compressed PNG bytes. Blobs cross the boundary by reference. */
  blob: Blob;
}

export type DecodeResponse =
  | {
      id: number;
      ok: true;
      width: number;
      height: number;
      bitDepth: number;
      min: number;
      max: number;
      /** Whether `buffer` should be read as Uint16Array or Uint8Array. The
       *  view type does not survive structured cloning; only the buffer does. */
      is16: boolean;
      buffer: ArrayBuffer;
    }
  | { id: number; ok: false; reason: string };
