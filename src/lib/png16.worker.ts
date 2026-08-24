/**
 * Off-main-thread grayscale-PNG decoding.
 *
 * WHY. Measured on a real 1474x1412 16-bit frame from the microtubule editor:
 * inflate costs 15 ms (native, already async) but un-filtering the rows and
 * packing the 16-bit samples costs **36.6 ms of synchronous JavaScript**, per
 * channel. Two visible channels is ~73 ms of blocked main thread per displayed
 * frame. During video playback that is what froze the editor: the server logs
 * show the client firing a burst of frame requests and then going silent,
 * because the thread that would issue the next request is busy un-filtering.
 *
 * The work does not get cheaper here — it just stops blocking the UI, and it
 * can overlap with the network and with rendering.
 *
 * Blobs cross the worker boundary by reference, so the compressed bytes are
 * never copied on the way in. On the way out the sample buffer is TRANSFERRED,
 * so the 4 MB result is not copied either.
 */

import { decodeGrayPng } from './png16';
import type { DecodeRequest, DecodeResponse } from './png16Protocol';

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, blob } = event.data;
  try {
    const decoded = await decodeGrayPng(blob);
    if (!decoded) {
      // Not a grayscale 8/16-bit PNG we handle. Not an error — the caller has
      // an 8-bit fallback for exactly this.
      const miss: DecodeResponse = { id, ok: false, reason: 'unsupported' };
      (self as unknown as Worker).postMessage(miss);
      return;
    }
    const response: DecodeResponse = {
      id,
      ok: true,
      width: decoded.width,
      height: decoded.height,
      bitDepth: decoded.bitDepth,
      min: decoded.min,
      max: decoded.max,
      is16: decoded.data instanceof Uint16Array,
      buffer: decoded.data.buffer as ArrayBuffer,
    };
    // Transfer, not copy: after this the buffer is detached in the worker.
    (self as unknown as Worker).postMessage(response, [response.buffer]);
  } catch (err) {
    const failure: DecodeResponse = {
      id,
      ok: false,
      reason: err instanceof Error ? err.message : 'decode threw',
    };
    (self as unknown as Worker).postMessage(failure);
  }
};
