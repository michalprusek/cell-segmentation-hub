/**
 * Contract between MultiChannelCanvas and the WebGL2 channel compositor.
 *
 * WHY THIS EXISTS AS A SEPARATE FILE: the compositor and its caller are built
 * against this file rather than against each other, so neither has to guess the
 * other's shape.
 *
 * WHAT THE COMPOSITOR REPLACES: the previous composite pass ran a per-pixel
 * JavaScript loop -- width*height iterations with four array writes, ONCE PER
 * CHANNEL, on the main thread, re-run on every frame change and on every slider
 * tick. At 1474x1412 with three channels that is ~6.2 M iterations and ~25 M
 * writes per frame, which is why playback stuttered. Moving the same arithmetic
 * into a fragment shader makes the per-frame cost a texture upload, and makes
 * window/colour/opacity changes a uniform update -- no CPU pass at all. This is
 * the approach Viv (Nature Methods 2022) takes for exactly this problem.
 */

/** One decoded channel, ready to composite. Mirrors MultiChannelCanvas's
 *  internal ChannelSamples plus the per-channel display settings. */
export interface CompositorChannel {
  /** Channel name — also the texture cache key. */
  channel: string;
  /** width*height grayscale samples, row-major, at native depth. */
  data: Uint16Array | Uint8Array;
  width: number;
  height: number;
  /** 8 or 16. Selects the texture internal format. */
  bitDepth: number;
  /** Display tint, each component 0-255, as produced by hexToRgb. */
  color: [number, number, number];
  /** 0-1. Multiplies the tinted result, matching the CPU path's `scale`. */
  opacity: number;
}

/** Window/level, in RAW SAMPLE UNITS (not normalised). Identical meaning to
 *  the arguments buildLut() took on the CPU path. */
export interface CompositorWindow {
  min: number;
  max: number;
  /** Largest sample value the LUT spanned. Retained so the shader can
   *  reproduce the CPU path's clamping behaviour exactly. */
  rangeMax: number;
}

export interface Compositor {
  /** Resize the drawing buffer. Cheap no-op when unchanged — resizing a
   *  canvas clears it, so callers must not do this per frame. */
  setSize(width: number, height: number): void;

  /**
   * Draw one composite. Channels are blended ADDITIVELY, matching the CPU
   * path's `globalCompositeOperation = 'lighter'`, so their order is
   * irrelevant. Safe to call on every frame and on every slider tick.
   */
  draw(channels: CompositorChannel[], window: CompositorWindow): void;

  /** Release textures, buffers, programs and the GL context. */
  dispose(): void;

  /** False once the GL context has been lost and not yet restored. The caller
   *  uses this to fall back to the 2D path rather than render nothing. */
  isAlive(): boolean;
}

/**
 * Build a compositor on `canvas`, or return null when WebGL2 is unavailable.
 *
 * Returning null rather than throwing is deliberate: the 2D path stays in
 * MultiChannelCanvas as the fallback, and a browser without WebGL2 must still
 * show images. NOTE that a canvas can only ever yield ONE context type, so the
 * caller has to decide which to request before it draws anything, and must
 * replace the canvas ELEMENT (not just the context) if it later needs to switch.
 */
export type CreateCompositor = (
  canvas: HTMLCanvasElement,
  onContextLost?: () => void
) => Compositor | null;
