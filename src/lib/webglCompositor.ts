/**
 * WebGL2 multi-channel compositor — the fragment-shader replacement for
 * MultiChannelCanvas's per-pixel JavaScript composite loop.
 *
 * WHAT IT REPLACES: the CPU path rebuilt a window/level LUT and then walked
 * width*height pixels with four typed-array writes ONCE PER CHANNEL, on the
 * main thread, on every frame change and every slider tick. At 1474x1412 with
 * three channels that is ~6.2 M iterations and ~25 M writes per frame. Here
 * the per-frame cost is a texture upload and the per-slider-tick cost is six
 * uniform writes; the arithmetic itself runs per fragment on the GPU. This is
 * the approach Viv (Nature Methods 2022) takes for the same problem.
 *
 * ARITHMETIC FIDELITY: the shader is a LITERAL port of the CPU expression, not
 * an "equivalent" rewrite, so the output is bit-comparable:
 *
 *   size  = min(65535, max(1, round(rangeMax))) + 1
 *   lo    = min(windowMin, windowMax)
 *   hi    = max(windowMin, windowMax)
 *   range = max(1, hi - lo)
 *   lut[i] = i <= lo ? 0 : i >= hi ? 255 : round(((i - lo) * 255) / range)
 *   v      = lut[s > size-1 ? size-1 : s]
 *   out.rgb = ((v * c) >> 8) * scale        // >>8 — DIVIDE BY 256, TRUNCATE
 *
 * `>> 8` is written as `floor(x / 256.0)` and `Math.round` as `floor(x + 0.5)`
 * (equivalent for the non-negative operands here). The `/256` truncation is
 * visible at low intensities — it is deliberately NOT "improved" to `/255`.
 *
 * SAMPLING: channels upload as single-channel INTEGER textures (R16UI / R8UI,
 * read through a `usampler2D`), so the raw sample value reaches the shader
 * undamaged. Integer textures are not filterable, hence NEAREST/CLAMP_TO_EDGE —
 * correct here because the canvas is drawn at the image's native pixel size and
 * zoom is applied to the canvas ELEMENT afterwards, so sampling is always 1:1.
 *
 * BLENDING: one draw call per channel with `blendFuncSeparate(ONE, ONE, ONE,
 * ZERO)`. RGB accumulates (matching the 2D path's `globalCompositeOperation =
 * 'lighter'`), while alpha takes the source value instead of summing to N.
 * One draw per channel also sidesteps MAX_TEXTURE_IMAGE_UNITS and shader loops.
 */

import { logger } from '@/lib/logger';
import type {
  Compositor,
  CompositorChannel,
  CompositorWindow,
  CreateCompositor,
} from './webglCompositor.types';

// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

/**
 * Full-viewport quad. The texture coordinate is derived from the clip-space
 * position rather than stored, so the vertex buffer carries positions only.
 *
 * The V flip (`0.5 - 0.5 * y`) is load-bearing: channel samples are uploaded
 * row-major TOP-first, but clip-space y runs bottom-up, so without it the
 * composite would be vertically mirrored. Do NOT also set UNPACK_FLIP_Y_WEBGL —
 * that would flip it back.
 */
export const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 aPosition;
out vec2 vTexCoord;

void main() {
  vTexCoord = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * The ported CPU composite, one fragment per pixel.
 *
 * `uMaxIndex` is `size - 1` from buildLut(), reproducing the CPU path's index
 * clamp; `uLo`/`uHi`/`uRange` are the LUT's own parameters, so the table is
 * evaluated on the fly instead of being uploaded. Colour arrives 0-255 (as
 * hexToRgb produced it) precisely so `(v * c) >> 8` can be reproduced verbatim.
 *
 * `highp` is required: sample indices reach 65535 and `(i - lo) * 255` reaches
 * ~16.7 M, both exactly representable in fp32 but not in mediump.
 */
export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uSamples;
uniform float uLo;
uniform float uHi;
uniform float uRange;
uniform float uMaxIndex;
uniform vec3 uColor;
uniform float uScale;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
  float s = float(texture(uSamples, vTexCoord).r);
  float i = s > uMaxIndex ? uMaxIndex : s;

  float v;
  if (i <= uLo) {
    v = 0.0;
  } else if (i >= uHi) {
    v = 255.0;
  } else {
    v = floor(((i - uLo) * 255.0) / uRange + 0.5);
  }

  vec3 tinted = floor((v * uColor) / 256.0) * uScale;
  fragColor = vec4(tinted / 255.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Pure uniform derivation (testable without a GL context)
// ---------------------------------------------------------------------------

/** Largest index buildLut() would ever produce (size caps at 65536 entries). */
const MAX_LUT_INDEX = 65535;

/** Clip-space positions for two triangles covering the viewport. */
const QUAD_VERTICES = new Float32Array([
  -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
]);

/** Uniform values for one channel's draw call. Flat scalars, never nested
 *  objects/arrays, so `draw()` can fill a single reused instance and upload it
 *  with `uniform1f`/`uniform3f` without allocating. */
export interface ChannelUniforms {
  /** min(windowMin, windowMax). */
  lo: number;
  /** max(windowMin, windowMax). */
  hi: number;
  /** max(1, hi - lo) — the LUT denominator, never zero. */
  range: number;
  /** buildLut()'s `size - 1`; samples above it are clamped down to it. */
  maxIndex: number;
  /** Tint components, 0-255, as hexToRgb produced them. */
  colorR: number;
  colorG: number;
  colorB: number;
  /** The CPU path's `scale`: opacity, saturated at 1. */
  scale: number;
}

/**
 * Derive one channel's shader uniforms from the display window.
 *
 * Pure and allocation-free when `out` is supplied — `draw()` passes a reused
 * scratch object so a slider drag allocates nothing.
 */
export function computeChannelUniforms(
  win: CompositorWindow,
  channel: CompositorChannel,
  out?: ChannelUniforms
): ChannelUniforms {
  // buildLut(): lo/hi swap when the caller passes them inverted, and `range`
  // floors at 1 so a zero-width window divides by 1 rather than by 0.
  const lo = Math.min(win.min, win.max);
  const hi = Math.max(win.min, win.max);
  const range = Math.max(1, hi - lo);
  // buildLut() sized the table `min(65535, max(1, round(rangeMax))) + 1`, and
  // the CPU path indexed it as `lut[s > size - 1 ? size - 1 : s]`.
  const maxIndex = Math.min(
    MAX_LUT_INDEX,
    Math.max(1, Math.round(win.rangeMax))
  );

  // Indexed reads, not destructuring: `const [r, g, b] = tuple` goes through
  // the iterator protocol and allocates an iterator on every draw.
  const color = channel.color;
  const opacity = channel.opacity;

  const target: ChannelUniforms = out ?? {
    lo: 0,
    hi: 0,
    range: 1,
    maxIndex: 0,
    colorR: 0,
    colorG: 0,
    colorB: 0,
    scale: 1,
  };
  target.lo = lo;
  target.hi = hi;
  target.range = range;
  target.maxIndex = maxIndex;
  target.colorR = color[0];
  target.colorG = color[1];
  target.colorB = color[2];
  // CPU path: `const scale = opacity >= 1 ? 1 : opacity`. Values below zero are
  // deliberately not clamped — the CPU path did not either, and both the GL
  // framebuffer and Uint8ClampedArray clamp the negative result to 0 anyway.
  target.scale = opacity >= 1 ? 1 : opacity;
  return target;
}

/**
 * Executable spec for FRAGMENT_SHADER_SOURCE's main(): maps one raw sample to
 * the tinted RGB triple, in the CPU path's 0-255 output units (i.e. the value
 * that landed in `out[p]`, before the shader's final `/ 255.0`).
 *
 * `draw()` does NOT call this — the GPU does the work. It exists so the ported
 * arithmetic can be diffed against a JavaScript reference in a test, which is
 * the only verification available in jsdom (which has no WebGL). KEEP IT IN
 * SYNC WITH THE GLSL ABOVE, statement for statement.
 */
export function evaluateChannelSample(
  uniforms: ChannelUniforms,
  sample: number
): [number, number, number] {
  const i = sample > uniforms.maxIndex ? uniforms.maxIndex : sample;
  let v: number;
  if (i <= uniforms.lo) {
    v = 0;
  } else if (i >= uniforms.hi) {
    v = 255;
  } else {
    v = Math.floor(((i - uniforms.lo) * 255) / uniforms.range + 0.5);
  }
  return [
    Math.floor((v * uniforms.colorR) / 256) * uniforms.scale,
    Math.floor((v * uniforms.colorG) / 256) * uniforms.scale,
    Math.floor((v * uniforms.colorB) / 256) * uniforms.scale,
  ];
}

// ---------------------------------------------------------------------------
// GL plumbing
// ---------------------------------------------------------------------------

/** A cached channel texture plus the allocation it was created for. Any change
 *  to these forces a re-allocation; otherwise the texture is re-filled with
 *  texSubImage2D, which does not reallocate GPU storage. */
interface TextureEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
  bitDepth: number;
  /** gl.UNSIGNED_SHORT or gl.UNSIGNED_BYTE. */
  type: number;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    logger.error(`webglCompositor: could not create ${label} shader`);
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    logger.error(
      `webglCompositor: ${label} shader failed to compile`,
      gl.getShaderInfoLog(shader)
    );
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Build a compositor on `canvas`, or return null when WebGL2 is unavailable or
 * the program cannot be built.
 *
 * Returning null rather than throwing is deliberate: MultiChannelCanvas keeps
 * its 2D path as the fallback. Note that a canvas yields exactly ONE context
 * type for its lifetime, so a caller that falls back must replace the canvas
 * ELEMENT, not just re-request a context.
 */
export const createCompositor: CreateCompositor = (
  canvas: HTMLCanvasElement,
  onContextLost?: () => void
): Compositor | null => {
  let rawContext: RenderingContext | null = null;
  try {
    rawContext = canvas.getContext('webgl2', {
      // Straight (non-premultiplied) alpha: the shader emits `vec4(rgb, 1.0)`.
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
  } catch (err) {
    logger.error('webglCompositor: getContext("webgl2") threw', err);
    return null;
  }
  if (!rawContext) {
    logger.warn('webglCompositor: WebGL2 unavailable — caller must fall back');
    return null;
  }
  const gl = rawContext as WebGL2RenderingContext;

  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    VERTEX_SHADER_SOURCE,
    'vertex'
  );
  if (!vertexShader) return null;
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
    'fragment'
  );
  if (!fragmentShader) {
    gl.deleteShader(vertexShader);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    logger.error('webglCompositor: could not create program');
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  // The shaders are no longer needed once linked, whether or not linking
  // succeeded — the program holds its own copy.
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    logger.error(
      'webglCompositor: program failed to link',
      gl.getProgramInfoLog(program)
    );
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  if (!buffer || !vao) {
    logger.error('webglCompositor: could not create quad buffer/VAO');
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    return null;
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const uSamples = gl.getUniformLocation(program, 'uSamples');
  const uLo = gl.getUniformLocation(program, 'uLo');
  const uHi = gl.getUniformLocation(program, 'uHi');
  const uRange = gl.getUniformLocation(program, 'uRange');
  const uMaxIndex = gl.getUniformLocation(program, 'uMaxIndex');
  const uColor = gl.getUniformLocation(program, 'uColor');
  const uScale = gl.getUniformLocation(program, 'uScale');

  // Single-channel integer rows are not 4-byte aligned (R8UI is 1 byte/texel,
  // R16UI is 2), so any odd width would be misread at the default alignment.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(uSamples, 0);

  const textures = new Map<string, TextureEntry>();
  // Reused across every channel of every draw — see ChannelUniforms.
  const scratch: ChannelUniforms = {
    lo: 0,
    hi: 0,
    range: 1,
    maxIndex: 0,
    colorR: 0,
    colorG: 0,
    colorB: 0,
    scale: 1,
  };

  let disposed = false;
  let contextLost = false;

  const handleContextLost = (event: Event): void => {
    // Without preventDefault the context is never restorable and no
    // `webglcontextrestored` ever fires.
    event.preventDefault();
    if (contextLost) return;
    contextLost = true;
    logger.warn(
      'webglCompositor: WebGL2 context lost — compositor is no longer alive'
    );
    try {
      onContextLost?.();
    } catch (err) {
      logger.error('webglCompositor: onContextLost callback threw', err);
    }
  };

  const handleContextRestored = (): void => {
    // Every texture, buffer and program died with the context. Rebuilding them
    // here would race the caller's own fallback, so the compositor stays dead
    // and the caller decides whether to construct a fresh one.
    logger.warn(
      'webglCompositor: WebGL2 context restored — recreate the compositor to use it'
    );
  };

  // Registered only now that construction has succeeded: listeners added before
  // a `return null` above would outlive a compositor that never existed and
  // could still fire onContextLost at the caller.
  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', handleContextRestored);

  /** Upload one channel's samples, reusing its texture when the allocation
   *  still matches. Returns null only if texture creation fails. */
  const uploadChannel = (channel: CompositorChannel): WebGLTexture | null => {
    // The GL type must match the ArrayBufferView actually passed — a
    // UNSIGNED_SHORT upload of a Uint8Array is an INVALID_OPERATION that leaves
    // the texture incomplete (every sample reads 0). Deriving it from the view
    // rather than from `bitDepth` is both safer and numerically identical.
    const isShort = channel.data instanceof Uint16Array;
    const type = isShort ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;
    const internalFormat = isShort ? gl.R16UI : gl.R8UI;

    let entry = textures.get(channel.channel);
    if (
      entry &&
      (entry.width !== channel.width ||
        entry.height !== channel.height ||
        entry.bitDepth !== channel.bitDepth ||
        entry.type !== type)
    ) {
      gl.deleteTexture(entry.texture);
      textures.delete(channel.channel);
      entry = undefined;
    }

    if (!entry) {
      const texture = gl.createTexture();
      if (!texture) {
        logger.error(
          `webglCompositor: could not create texture for channel '${channel.channel}'`
        );
        return null;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Integer textures are not filterable; NEAREST is mandatory, and correct
      // because the canvas is drawn at native pixel size (zoom is applied to
      // the canvas element), so sampling is 1:1.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internalFormat,
        channel.width,
        channel.height,
        0,
        gl.RED_INTEGER,
        type,
        channel.data
      );
      textures.set(channel.channel, {
        texture,
        width: channel.width,
        height: channel.height,
        bitDepth: channel.bitDepth,
        type,
      });
      return texture;
    }

    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      channel.width,
      channel.height,
      gl.RED_INTEGER,
      type,
      channel.data
    );
    return entry.texture;
  };

  return {
    setSize(width: number, height: number): void {
      if (disposed) return;
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      // Assigning canvas.width/height CLEARS the drawing buffer even when the
      // value is unchanged, so a per-frame caller must not pay for a no-op.
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      if (!contextLost) gl.viewport(0, 0, w, h);
    },

    draw(channels: CompositorChannel[], win: CompositorWindow): void {
      if (disposed || contextLost) return;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      // RGB accumulates (the 2D path's 'lighter'); alpha takes the source term
      // only, so N channels leave alpha at 1 instead of summing to N.
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ZERO);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Indexed loop, reused scratch uniforms, scalar uniform setters: this
      // body runs on every frame and every slider tick and allocates nothing.
      for (let i = 0; i < channels.length; i++) {
        const channel = channels[i];
        const texture = uploadChannel(channel);
        if (!texture) continue;
        computeChannelUniforms(win, channel, scratch);
        gl.uniform1f(uLo, scratch.lo);
        gl.uniform1f(uHi, scratch.hi);
        gl.uniform1f(uRange, scratch.range);
        gl.uniform1f(uMaxIndex, scratch.maxIndex);
        gl.uniform3f(uColor, scratch.colorR, scratch.colorG, scratch.colorB);
        gl.uniform1f(uScale, scratch.scale);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      gl.bindVertexArray(null);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Removed BEFORE loseContext() below, so releasing the context cannot
      // fire our own handler and call onContextLost at the caller.
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);

      textures.forEach(entry => gl.deleteTexture(entry.texture));
      textures.clear();
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);

      if (!contextLost) {
        // Frees the GPU context promptly instead of waiting for the canvas to
        // be collected. Absent in some environments, hence the optional calls.
        gl.getExtension('WEBGL_lose_context')?.loseContext?.();
      }
    },

    isAlive(): boolean {
      return !disposed && !contextLost;
    },
  };
};
