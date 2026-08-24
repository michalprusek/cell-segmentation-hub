/**
 * Unit tests for the WebGL2 multi-channel compositor.
 *
 * jsdom has no WebGL, so the suite is split in two:
 *
 *  1. ARITHMETIC — `computeChannelUniforms` / `evaluateChannelSample` are pure,
 *     so they are checked against the REAL `buildLut` the CPU composite runs,
 *     imported from `@/lib/windowLevel` rather than copied here. That import is
 *     the point: a copy would stay green after someone edited the production
 *     tone curve, and the two composite paths would drift apart unnoticed.
 *     Plus textual assertions that the GLSL contains the same expressions — the
 *     shader can only be verified by eye here, so those are the guard against
 *     someone "simplifying" `>> 8` into `/ 255`.
 *
 *  2. CALL SEQUENCING — `createCompositor` is driven against a hand-written
 *     fake WebGL2RenderingContext that appends every call to a shared log, so
 *     the tests can assert order and shape: program built once, one draw per
 *     channel, no re-upload when the samples are unchanged, blend state,
 *     disposal.
 *
 * WHAT THIS CANNOT PROVE: no pixels are rendered anywhere in this file. The
 * fake context proves the compositor issues the right calls in the right
 * order; it cannot prove the GPU produces the same image as the CPU path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCompositor,
  computeChannelUniforms,
  evaluateChannelSample,
  VERTEX_SHADER_SOURCE,
  FRAGMENT_SHADER_SOURCE,
  type ChannelUniforms,
  type CompositorChannel,
  type CompositorWindow,
} from '../webglCompositor';
import { buildLut } from '../windowLevel';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Reference implementation — the per-pixel expression only. It stays copied
// because in production it is INLINED inside the hot composite loop, and
// extracting it to share would put a call per pixel back into the very loop
// this compositor exists to remove. `buildLut` above is imported, not copied.
// ---------------------------------------------------------------------------

/** The CPU path's per-pixel expression, before the Uint8ClampedArray store. */
function cpuComposite(
  lut: Uint8ClampedArray,
  sample: number,
  color: [number, number, number],
  opacity: number
): [number, number, number] {
  const maxIdx = lut.length - 1;
  const v = lut[sample > maxIdx ? maxIdx : sample];
  const scale = opacity >= 1 ? 1 : opacity;
  return [
    ((v * color[0]) >> 8) * scale,
    ((v * color[1]) >> 8) * scale,
    ((v * color[2]) >> 8) * scale,
  ];
}

function makeChannel(
  overrides: Partial<CompositorChannel> = {}
): CompositorChannel {
  return {
    channel: 'DAPI',
    data: new Uint16Array(4 * 3),
    width: 4,
    height: 3,
    color: [255, 255, 255],
    opacity: 1,
    ...overrides,
  };
}

// Spies are torn down here, once, for the whole file. Two tests used to call
// vi.restoreAllMocks() from inside their own body, which restores EVERY spy in
// the file mid-run — harmless while each describe sets up its own, and a
// mystery failure in some unrelated test the moment a shared spy is added.
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fake WebGL2 context
// ---------------------------------------------------------------------------

/** Real GL enum values, so a mistaken constant in the implementation shows up
 *  as a wrong number in an assertion rather than as `undefined === undefined`. */
const GL_ENUMS = {
  TRIANGLES: 0x0004,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  FLOAT: 0x1406,
  TEXTURE_2D: 0x0de1,
  TEXTURE0: 0x84c0,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  CLAMP_TO_EDGE: 0x812f,
  R8UI: 0x8232,
  R16UI: 0x8234,
  RED_INTEGER: 0x8d94,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_SHORT: 0x1403,
  BLEND: 0x0be2,
  ONE: 1,
  ZERO: 0,
  COLOR_BUFFER_BIT: 0x00004000,
  UNPACK_ALIGNMENT: 0x0cf5,
};

interface GlCall {
  name: string;
  args: unknown[];
}

interface FakeGl {
  calls: GlCall[];
  state: {
    compileOk: boolean;
    linkOk: boolean;
    textureOk: boolean;
    /** Drives gl.isContextLost(). Set it to simulate a context that has died
     *  WITHOUT the webglcontextlost event having been dispatched yet — the
     *  window isAlive() exists to cover. */
    contextLost: boolean;
  };
  [key: string]: unknown;
}

function createFakeGl(): FakeGl {
  const calls: GlCall[] = [];
  const state = {
    compileOk: true,
    linkOk: true,
    textureOk: true,
    contextLost: false,
  };
  let nextId = 0;
  const tag = (kind: string) => ({ kind, id: ++nextId });

  const fn = (name: string, impl?: (...args: any[]) => unknown) =>
    vi.fn((...args: any[]) => {
      calls.push({ name, args });
      return impl ? impl(...args) : undefined;
    });

  return {
    isContextLost: fn('isContextLost', () => state.contextLost),
    ...GL_ENUMS,
    calls,
    state,

    createShader: fn('createShader', () => tag('shader')),
    shaderSource: fn('shaderSource'),
    compileShader: fn('compileShader'),
    getShaderParameter: fn('getShaderParameter', () => state.compileOk),
    getShaderInfoLog: fn('getShaderInfoLog', () => 'compile log'),
    deleteShader: fn('deleteShader'),

    createProgram: fn('createProgram', () => tag('program')),
    attachShader: fn('attachShader'),
    linkProgram: fn('linkProgram'),
    getProgramParameter: fn('getProgramParameter', () => state.linkOk),
    getProgramInfoLog: fn('getProgramInfoLog', () => 'link log'),
    deleteProgram: fn('deleteProgram'),
    useProgram: fn('useProgram'),

    createBuffer: fn('createBuffer', () => tag('buffer')),
    bindBuffer: fn('bindBuffer'),
    bufferData: fn('bufferData'),
    deleteBuffer: fn('deleteBuffer'),

    createVertexArray: fn('createVertexArray', () => tag('vao')),
    bindVertexArray: fn('bindVertexArray'),
    deleteVertexArray: fn('deleteVertexArray'),

    getAttribLocation: fn('getAttribLocation', () => 0),
    enableVertexAttribArray: fn('enableVertexAttribArray'),
    vertexAttribPointer: fn('vertexAttribPointer'),

    getUniformLocation: fn('getUniformLocation', (_program, name: string) => ({
      kind: 'uniform',
      name,
    })),
    uniform1i: fn('uniform1i'),
    uniform1f: fn('uniform1f'),
    uniform3f: fn('uniform3f'),

    createTexture: fn('createTexture', () =>
      state.textureOk ? tag('texture') : null
    ),
    bindTexture: fn('bindTexture'),
    texParameteri: fn('texParameteri'),
    texImage2D: fn('texImage2D'),
    texSubImage2D: fn('texSubImage2D'),
    deleteTexture: fn('deleteTexture'),
    activeTexture: fn('activeTexture'),
    pixelStorei: fn('pixelStorei'),

    viewport: fn('viewport'),
    enable: fn('enable'),
    blendFuncSeparate: fn('blendFuncSeparate'),
    clearColor: fn('clearColor'),
    clear: fn('clear'),
    drawArrays: fn('drawArrays'),
    getExtension: fn('getExtension', () => null),
  };
}

function attachContext(gl: FakeGl | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // Instance property shadows the global prototype stub from test/setup.ts.
  canvas.getContext = vi.fn(
    () => gl
  ) as unknown as HTMLCanvasElement['getContext'];
  return canvas;
}

const named = (gl: FakeGl, name: string): GlCall[] =>
  gl.calls.filter(c => c.name === name);
const indexOfCall = (gl: FakeGl, name: string): number =>
  gl.calls.findIndex(c => c.name === name);
const countOf = (gl: FakeGl, name: string): number => named(gl, name).length;

/** uniform1f calls keyed by the uniform name they targeted. */
const floatUniforms = (gl: FakeGl): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const call of named(gl, 'uniform1f')) {
    out[(call.args[0] as { name: string }).name] = call.args[1] as number;
  }
  return out;
};

const WINDOW: CompositorWindow = { min: 0, max: 65535, rangeMax: 65535 };

// ---------------------------------------------------------------------------

describe('webglCompositor — shader source', () => {
  it('starts both shaders with the GLSL ES 3.00 directive on line 1', () => {
    // #version must be the very first token or the shader will not compile.
    expect(VERTEX_SHADER_SOURCE.startsWith('#version 300 es\n')).toBe(true);
    expect(FRAGMENT_SHADER_SOURCE.startsWith('#version 300 es\n')).toBe(true);
  });

  it('reads samples through a highp usampler2D (integer texture)', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('precision highp usampler2D;');
    expect(FRAGMENT_SHADER_SOURCE).toContain('uniform usampler2D uSamples;');
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      'float s = float(texture(uSamples, vTexCoord).r);'
    );
  });

  it('ports buildLut() literally: index clamp, <= lo, >= hi, round()', () => {
    // lut[s > size-1 ? size-1 : s]
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      'float i = s > uMaxIndex ? uMaxIndex : s;'
    );
    // i <= lo ? 0 : i >= hi ? 255 : ...
    expect(FRAGMENT_SHADER_SOURCE).toContain('if (i <= uLo)');
    expect(FRAGMENT_SHADER_SOURCE).toContain('} else if (i >= uHi) {');
    // Math.round(x) written as floor(x + 0.5)
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      'v = floor(((i - uLo) * 255.0) / uRange + 0.5);'
    );
  });

  it('ports the (v * c) >> 8 tint as a truncating divide by 256, not 255', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      'vec3 tinted = floor((v * uColor) / 256.0) * uScale;'
    );
    // The only /255 in the shader is the final 0-255 -> 0-1 framebuffer
    // conversion. A `/ 255.0` applied to uColor would be the classic
    // "improvement" that silently changes every low-intensity pixel.
    expect(FRAGMENT_SHADER_SOURCE).not.toContain('uColor) / 255.0');
    expect(FRAGMENT_SHADER_SOURCE).toContain('fragColor = vec4(tinted / 255.0');
  });

  it('flips V in the vertex shader (row 0 of the upload is the top row)', () => {
    expect(VERTEX_SHADER_SOURCE).toContain(
      'vTexCoord = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);'
    );
  });
});

describe('computeChannelUniforms', () => {
  it('swaps an inverted window (windowMin > windowMax)', () => {
    const u = computeChannelUniforms(
      { min: 900, max: 100, rangeMax: 1000 },
      makeChannel()
    );
    expect(u.lo).toBe(100);
    expect(u.hi).toBe(900);
    expect(u.range).toBe(800);
  });

  it('floors range at 1 when windowMin === windowMax', () => {
    const u = computeChannelUniforms(
      { min: 500, max: 500, rangeMax: 1000 },
      makeChannel()
    );
    expect(u.lo).toBe(500);
    expect(u.hi).toBe(500);
    expect(u.range).toBe(1);
  });

  it.each([
    // rangeMax, expected maxIndex (= buildLut size - 1)
    [0, 1],
    [1, 1],
    [255, 255],
    [4095, 4095],
    [65535, 65535],
    [100000, 65535],
    [0.4, 1], // rounds to 0, then max(1, 0)
    [254.6, 255], // rounds up
  ])('maxIndex for rangeMax=%p is %p (matches buildLut length)', (rm, want) => {
    const u = computeChannelUniforms(
      { min: 0, max: 10, rangeMax: rm },
      makeChannel()
    );
    expect(u.maxIndex).toBe(want);
    // Cross-check against the real table for the cheap cases.
    if (rm <= 4095) {
      expect(u.maxIndex).toBe(buildLut(0, 10, rm).length - 1);
    }
  });

  it('carries the tint through as 0-255 components', () => {
    const u = computeChannelUniforms(
      WINDOW,
      makeChannel({ color: [255, 128, 0] })
    );
    expect([u.colorR, u.colorG, u.colorB]).toEqual([255, 128, 0]);
  });

  it.each([
    [1, 1],
    [1.5, 1], // saturates, matching `opacity >= 1 ? 1 : opacity`
    [0.5, 0.5],
    [0, 0],
  ])('scale for opacity=%p is %p', (opacity, want) => {
    expect(computeChannelUniforms(WINDOW, makeChannel({ opacity })).scale).toBe(
      want
    );
  });

  it('fills the supplied out object and returns it (draw() allocates none)', () => {
    const out: ChannelUniforms = {
      lo: -1,
      hi: -1,
      range: -1,
      maxIndex: -1,
      colorR: -1,
      colorG: -1,
      colorB: -1,
      scale: -1,
    };
    const returned = computeChannelUniforms(
      { min: 10, max: 200, rangeMax: 4095 },
      makeChannel({ color: [1, 2, 3], opacity: 0.25 }),
      out
    );
    expect(returned).toBe(out);
    expect(out).toEqual({
      lo: 10,
      hi: 200,
      range: 190,
      maxIndex: 4095,
      colorR: 1,
      colorG: 2,
      colorB: 3,
      scale: 0.25,
    });
  });
});

describe('evaluateChannelSample vs the CPU composite loop', () => {
  const windows: CompositorWindow[] = [
    { min: 0, max: 255, rangeMax: 255 }, // full 8-bit range
    { min: 40, max: 200, rangeMax: 255 }, // narrow window
    { min: 200, max: 40, rangeMax: 255 }, // INVERTED -> must swap
    { min: 100, max: 100, rangeMax: 255 }, // zero width -> range clamps to 1
    { min: 0, max: 4095, rangeMax: 4095 }, // 12-bit microscopy window
    { min: 0, max: 10, rangeMax: 0 }, // rangeMax 0 -> 2-entry LUT
    { min: 1000, max: 60000, rangeMax: 100000 }, // rangeMax clamps to 65535
  ];
  const colors: [number, number, number][] = [
    [255, 255, 255], // grayscale identity
    [255, 0, 0],
    [0, 255, 0],
    [17, 200, 91], // arbitrary hex tint
    [0, 0, 0],
  ];
  const opacities = [1, 0.5, 0.37, 0];

  it('matches for every sample of the 8-bit domain across the table', () => {
    for (const win of windows) {
      const lut = buildLut(win.min, win.max, win.rangeMax);
      const maxIdx = lut.length - 1;
      // Boundary-heavy sample set: below lo, exactly lo, inside, exactly hi,
      // above hi, at the LUT's last index, and past it (index clamp).
      const lo = Math.min(win.min, win.max);
      const hi = Math.max(win.min, win.max);
      const samples = [
        0,
        1,
        Math.max(0, lo - 1),
        lo,
        lo + 1,
        Math.floor((lo + hi) / 2),
        hi - 1,
        hi,
        hi + 1,
        maxIdx - 1,
        maxIdx,
        maxIdx + 1,
        maxIdx + 5000,
        65535,
      ].filter(s => s >= 0);

      for (const color of colors) {
        for (const opacity of opacities) {
          const channel = makeChannel({ color, opacity });
          const uniforms = computeChannelUniforms(win, channel);
          for (const sample of samples) {
            expect(
              evaluateChannelSample(uniforms, sample),
              `win=${JSON.stringify(win)} color=${color} opacity=${opacity} sample=${sample}`
            ).toEqual(cpuComposite(lut, sample, color, opacity));
          }
        }
      }
    }
  });

  it('is byte-exact against the CPU path over the whole 8-bit ramp', () => {
    const win: CompositorWindow = { min: 30, max: 220, rangeMax: 255 };
    const color: [number, number, number] = [255, 128, 33];
    const lut = buildLut(win.min, win.max, win.rangeMax);
    const uniforms = computeChannelUniforms(win, makeChannel({ color }));
    // scale === 1, so both sides are integers and the Uint8ClampedArray store
    // the CPU path performed is a no-op — this is a true byte comparison.
    const cpuBytes = new Uint8ClampedArray(4);
    for (let s = 0; s <= 255; s++) {
      const got = evaluateChannelSample(uniforms, s);
      const want = cpuComposite(lut, s, color, 1);
      cpuBytes[0] = want[0];
      cpuBytes[1] = want[1];
      cpuBytes[2] = want[2];
      expect([got[0], got[1], got[2]], `sample ${s}`).toEqual([
        cpuBytes[0],
        cpuBytes[1],
        cpuBytes[2],
      ]);
    }
  });

  it('reproduces the >>8 truncation exactly (254, not 255, for white)', () => {
    // The tell-tale of a literal port: (255*255)>>8 === 254. A /255 "fix"
    // would give 255 here and shift every intensity by one step.
    const uniforms = computeChannelUniforms(
      { min: 0, max: 255, rangeMax: 255 },
      makeChannel({ color: [255, 255, 255] })
    );
    expect(evaluateChannelSample(uniforms, 255)).toEqual([254, 254, 254]);
    // Low intensities truncate to zero rather than rounding up.
    expect(evaluateChannelSample(uniforms, 1)[0]).toBe(0);
  });

  it('clamps samples above the LUT domain to the last entry', () => {
    // rangeMax 4095 -> maxIndex 4095; a 16-bit sample of 60000 must read
    // lut[4095], i.e. saturate, not wrap or read out of range.
    const win: CompositorWindow = { min: 0, max: 4095, rangeMax: 4095 };
    const uniforms = computeChannelUniforms(win, makeChannel());
    expect(evaluateChannelSample(uniforms, 60000)).toEqual(
      evaluateChannelSample(uniforms, 4095)
    );
  });
});

describe('createCompositor — construction failure', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  it('returns null when WebGL2 is unavailable', () => {
    expect(createCompositor(attachContext(null))).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null when getContext throws', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn(() => {
      throw new Error('context creation blocked');
    }) as unknown as HTMLCanvasElement['getContext'];
    expect(createCompositor(canvas)).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns null and cleans up when a shader fails to compile', () => {
    const gl = createFakeGl();
    gl.state.compileOk = false;
    expect(createCompositor(attachContext(gl))).toBeNull();
    expect(logger.error).toHaveBeenCalled();
    expect(countOf(gl, 'deleteShader')).toBe(1);
    expect(countOf(gl, 'createProgram')).toBe(0);
  });

  it('returns null and deletes the program when linking fails', () => {
    const gl = createFakeGl();
    gl.state.linkOk = false;
    expect(createCompositor(attachContext(gl))).toBeNull();
    expect(logger.error).toHaveBeenCalled();
    expect(countOf(gl, 'deleteProgram')).toBe(1);
    // Both shaders are released whether or not the link succeeded.
    expect(countOf(gl, 'deleteShader')).toBe(2);
  });

  it('registers no context listeners when construction fails', () => {
    const gl = createFakeGl();
    gl.state.linkOk = false;
    const canvas = attachContext(gl);
    const add = vi.spyOn(canvas, 'addEventListener');
    expect(createCompositor(canvas)).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('createCompositor — initialisation', () => {
  it('compiles the program once and configures integer sampling state', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl));
    expect(compositor).not.toBeNull();

    expect(countOf(gl, 'createProgram')).toBe(1);
    expect(countOf(gl, 'compileShader')).toBe(2);
    expect(countOf(gl, 'linkProgram')).toBe(1);
    // Rows of R8UI/R16UI data are not 4-byte aligned.
    expect(named(gl, 'pixelStorei')[0].args).toEqual([
      GL_ENUMS.UNPACK_ALIGNMENT,
      1,
    ]);
    // The sampler reads texture unit 0, bound once here.
    expect(named(gl, 'activeTexture')[0].args).toEqual([GL_ENUMS.TEXTURE0]);
    expect(named(gl, 'uniform1i')[0].args[1]).toBe(0);
    expect(compositor!.isAlive()).toBe(true);
  });

  it('uploads exactly one static quad buffer', () => {
    const gl = createFakeGl();
    createCompositor(attachContext(gl));
    expect(countOf(gl, 'createBuffer')).toBe(1);
    expect(countOf(gl, 'createVertexArray')).toBe(1);
    const bufferData = named(gl, 'bufferData')[0];
    expect(bufferData.args[1]).toBeInstanceOf(Float32Array);
    // Two triangles x 3 vertices x 2 components.
    expect((bufferData.args[1] as Float32Array).length).toBe(12);
  });

  it('passes the shader sources it exports', () => {
    const gl = createFakeGl();
    createCompositor(attachContext(gl));
    const sources = named(gl, 'shaderSource').map(c => c.args[1]);
    expect(sources).toContain(VERTEX_SHADER_SOURCE);
    expect(sources).toContain(FRAGMENT_SHADER_SOURCE);
  });
});

describe('createCompositor — draw', () => {
  it('clears once, then issues exactly one draw call per channel', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    gl.calls.length = 0;

    compositor.draw(
      [
        makeChannel({ channel: 'DAPI' }),
        makeChannel({ channel: 'GFP' }),
        makeChannel({ channel: 'RFP' }),
      ],
      WINDOW
    );

    expect(countOf(gl, 'clear')).toBe(1);
    expect(countOf(gl, 'drawArrays')).toBe(3);
    // Clear must precede every channel, or the first channel is wiped out.
    expect(indexOfCall(gl, 'clear')).toBeLessThan(
      indexOfCall(gl, 'drawArrays')
    );
    expect(named(gl, 'clearColor')[0].args).toEqual([0, 0, 0, 0]);
    expect(named(gl, 'drawArrays')[0].args).toEqual([GL_ENUMS.TRIANGLES, 0, 6]);
  });

  it('enables additive blending with alpha pinned to the source', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    gl.calls.length = 0;
    compositor.draw([makeChannel()], WINDOW);

    expect(named(gl, 'enable')[0].args).toEqual([GL_ENUMS.BLEND]);
    // ONE/ONE for RGB accumulates ('lighter'); ONE/ZERO for alpha keeps it at
    // the fragment's 1.0 instead of summing to N across channels.
    expect(named(gl, 'blendFuncSeparate')[0].args).toEqual([
      GL_ENUMS.ONE,
      GL_ENUMS.ONE,
      GL_ENUMS.ONE,
      GL_ENUMS.ZERO,
    ]);
    expect(indexOfCall(gl, 'blendFuncSeparate')).toBeLessThan(
      indexOfCall(gl, 'drawArrays')
    );
  });

  it('uploads the derived uniforms for each channel', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    gl.calls.length = 0;

    compositor.draw([makeChannel({ color: [255, 0, 128], opacity: 0.5 })], {
      min: 900,
      max: 100,
      rangeMax: 100000,
    });

    expect(floatUniforms(gl)).toEqual({
      uLo: 100,
      uHi: 900,
      uRange: 800,
      uMaxIndex: 65535,
      uScale: 0.5,
    });
    expect(named(gl, 'uniform3f')[0].args.slice(1)).toEqual([255, 0, 128]);
  });

  it('allocates once and does NOT re-upload when the samples are unchanged', () => {
    // THE SLIDER-DRAG CASE. A window/level drag re-runs the whole composite at
    // pointer rate while the decoded samples stay the same object, so an
    // unconditional upload would copy 4.2 MB per channel per tick (12.5 MB for
    // three) into the driver for data already resident. Identity is the right
    // test: a different array only ever appears with a different decode.
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    const channel = makeChannel();

    compositor.draw([channel], WINDOW);
    expect(countOf(gl, 'createTexture')).toBe(1);
    expect(countOf(gl, 'texImage2D')).toBe(1);
    expect(countOf(gl, 'texSubImage2D')).toBe(0);

    compositor.draw([channel], WINDOW);
    expect(countOf(gl, 'createTexture')).toBe(1);
    expect(countOf(gl, 'texImage2D')).toBe(1);
    expect(countOf(gl, 'texSubImage2D')).toBe(0);
    // Still bound and drawn — skipping the UPLOAD must not skip the draw.
    expect(countOf(gl, 'drawArrays')).toBe(2);
  });

  it('re-fills the existing allocation when new samples arrive', () => {
    // The next frame of a video: same channel, same size, different pixels.
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;

    compositor.draw([makeChannel()], WINDOW);
    const nextFrame = makeChannel();
    compositor.draw([nextFrame], WINDOW);

    // makeChannel() builds a fresh array each call, so the second draw uploads
    // into the SAME texture rather than allocating another.
    expect(countOf(gl, 'createTexture')).toBe(1);
    expect(countOf(gl, 'texImage2D')).toBe(1);
    expect(countOf(gl, 'texSubImage2D')).toBe(1);
    expect(named(gl, 'texSubImage2D')[0].args).toEqual([
      GL_ENUMS.TEXTURE_2D,
      0,
      0,
      0,
      4,
      3,
      GL_ENUMS.RED_INTEGER,
      GL_ENUMS.UNSIGNED_SHORT,
      nextFrame.data,
    ]);
  });

  it('re-allocates when the same channel changes size', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;

    compositor.draw([makeChannel({ width: 4, height: 3 })], WINDOW);
    compositor.draw(
      [
        makeChannel({
          width: 8,
          height: 6,
          data: new Uint16Array(8 * 6),
        }),
      ],
      WINDOW
    );

    expect(countOf(gl, 'texImage2D')).toBe(2);
    expect(countOf(gl, 'createTexture')).toBe(2);
    // The stale allocation is released rather than leaked.
    expect(countOf(gl, 'deleteTexture')).toBe(1);
  });

  it('re-allocates when the same channel changes sample depth', () => {
    // Depth is read off the sample view, not off a separate field, so this is
    // what a 16-bit channel replaced by an 8-bit one actually looks like.
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;

    compositor.draw([makeChannel({ data: new Uint16Array(4 * 3) })], WINDOW);
    gl.calls.length = 0;
    compositor.draw([makeChannel({ data: new Uint8Array(4 * 3) })], WINDOW);

    expect(countOf(gl, 'deleteTexture')).toBe(1);
    expect(countOf(gl, 'texImage2D')).toBe(1);
  });

  it.each([
    [16, () => new Uint16Array(12), GL_ENUMS.R16UI, GL_ENUMS.UNSIGNED_SHORT],
    [8, () => new Uint8Array(12), GL_ENUMS.R8UI, GL_ENUMS.UNSIGNED_BYTE],
  ])(
    '%p-bit data uploads as an integer texture with the matching type',
    (_bits, makeData, internalFormat, type) => {
      const gl = createFakeGl();
      const compositor = createCompositor(attachContext(gl))!;
      compositor.draw(
        [makeChannel({ data: makeData() as Uint16Array })],
        WINDOW
      );
      const args = named(gl, 'texImage2D')[0].args;
      expect(args[2]).toBe(internalFormat);
      expect(args[6]).toBe(GL_ENUMS.RED_INTEGER);
      expect(args[7]).toBe(type);
    }
  );

  it('sets NEAREST/CLAMP_TO_EDGE (integer textures are not filterable)', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    compositor.draw([makeChannel()], WINDOW);
    const params = named(gl, 'texParameteri').map(c => c.args.slice(1));
    expect(params).toEqual([
      [GL_ENUMS.TEXTURE_MIN_FILTER, GL_ENUMS.NEAREST],
      [GL_ENUMS.TEXTURE_MAG_FILTER, GL_ENUMS.NEAREST],
      [GL_ENUMS.TEXTURE_WRAP_S, GL_ENUMS.CLAMP_TO_EDGE],
      [GL_ENUMS.TEXTURE_WRAP_T, GL_ENUMS.CLAMP_TO_EDGE],
    ]);
  });

  it('caches one texture per channel name and rebuilds no GPU objects across frames', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    const channels = [
      makeChannel({ channel: 'DAPI' }),
      makeChannel({ channel: 'GFP' }),
    ];

    for (let frame = 0; frame < 5; frame++) compositor.draw(channels, WINDOW);

    // Program/buffer/VAO built once; two textures total; 5 frames x 2 draws.
    expect(countOf(gl, 'createProgram')).toBe(1);
    expect(countOf(gl, 'compileShader')).toBe(2);
    expect(countOf(gl, 'createBuffer')).toBe(1);
    expect(countOf(gl, 'createVertexArray')).toBe(1);
    expect(countOf(gl, 'createTexture')).toBe(2);
    expect(countOf(gl, 'texImage2D')).toBe(2);
    // Zero, not eight: the same two arrays are redrawn five times, which is the
    // slider-drag shape. Only the draw calls repeat.
    expect(countOf(gl, 'texSubImage2D')).toBe(0);
    expect(countOf(gl, 'drawArrays')).toBe(10);
  });

  it('draws channels whose dimensions differ from the canvas', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const compositor = createCompositor(canvas)!;
    compositor.setSize(100, 100);
    gl.calls.length = 0;

    compositor.draw([makeChannel({ width: 4, height: 3 })], WINDOW);

    // The quad always maps the whole texture to the whole canvas; a mismatch
    // is a scale, not a crash.
    expect(countOf(gl, 'drawArrays')).toBe(1);
    expect(named(gl, 'viewport')[0].args).toEqual([0, 0, 100, 100]);
  });

  it('clears but issues no draw call for an empty channel list', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    gl.calls.length = 0;
    expect(() => compositor.draw([], WINDOW)).not.toThrow();
    expect(countOf(gl, 'clear')).toBe(1);
    expect(countOf(gl, 'drawArrays')).toBe(0);
  });

  it('skips a channel whose texture could not be created', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    gl.state.textureOk = false;
    gl.calls.length = 0;

    expect(() => compositor.draw([makeChannel()], WINDOW)).not.toThrow();
    expect(countOf(gl, 'drawArrays')).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('createCompositor — setSize', () => {
  it('resizes the drawing buffer and the viewport', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const compositor = createCompositor(canvas)!;
    gl.calls.length = 0;

    compositor.setSize(640, 480);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(named(gl, 'viewport')[0].args).toEqual([0, 0, 640, 480]);
  });

  it('is a no-op when the size is unchanged (resizing clears the canvas)', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const compositor = createCompositor(canvas)!;
    compositor.setSize(640, 480);
    gl.calls.length = 0;

    compositor.setSize(640, 480);

    expect(countOf(gl, 'viewport')).toBe(0);
  });

  it('ignores non-finite sizes', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const compositor = createCompositor(canvas)!;
    compositor.setSize(640, 480);
    gl.calls.length = 0;

    compositor.setSize(Number.NaN, 480);

    expect(canvas.width).toBe(640);
    expect(countOf(gl, 'viewport')).toBe(0);
  });
});

describe('createCompositor — context loss', () => {
  it('reports dead as soon as the CONTEXT is, before the event arrives', () => {
    // webglcontextlost is dispatched asynchronously, so between the context
    // dying and the handler running there is a window in which our own flag
    // still says "alive". A composite scheduled in that window would draw into
    // a dead context and show nothing, with no fallback triggered — which is
    // the whole reason isAlive() asks gl.isContextLost() rather than trusting
    // its own bookkeeping.
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    expect(compositor.isAlive()).toBe(true);

    gl.state.contextLost = true; // context gone; no event dispatched yet

    expect(compositor.isAlive()).toBe(false);
  });

  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  it('prevents the default, notifies the caller and stops drawing', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const onContextLost = vi.fn();
    const compositor = createCompositor(canvas, onContextLost)!;
    expect(compositor.isAlive()).toBe(true);

    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);

    // preventDefault is what makes restoration possible at all.
    expect(event.defaultPrevented).toBe(true);
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(compositor.isAlive()).toBe(false);

    gl.calls.length = 0;
    expect(() => compositor.draw([makeChannel()], WINDOW)).not.toThrow();
    expect(gl.calls).toHaveLength(0);
  });

  it('stays dead after webglcontextrestored (no automatic restoration)', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const compositor = createCompositor(canvas)!;
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));

    // Every GL object died with the context; the caller must build a new
    // compositor rather than have this one silently half-work.
    expect(compositor.isAlive()).toBe(false);
  });

  it('notifies only once if the event fires repeatedly', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const onContextLost = vi.fn();
    createCompositor(canvas, onContextLost);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onContextLost).toHaveBeenCalledTimes(1);
  });

  it('survives an onContextLost callback that throws', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const compositor = createCompositor(canvas, () => {
      throw new Error('caller blew up');
    })!;
    expect(() =>
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    ).not.toThrow();
    expect(compositor.isAlive()).toBe(false);
  });
});

describe('createCompositor — dispose', () => {
  it('deletes every object it created and detaches its listeners', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const onContextLost = vi.fn();
    const compositor = createCompositor(canvas, onContextLost)!;
    compositor.draw(
      [makeChannel({ channel: 'DAPI' }), makeChannel({ channel: 'GFP' })],
      WINDOW
    );

    compositor.dispose();

    expect(countOf(gl, 'deleteTexture')).toBe(2);
    expect(countOf(gl, 'deleteBuffer')).toBe(1);
    expect(countOf(gl, 'deleteVertexArray')).toBe(1);
    expect(countOf(gl, 'deleteProgram')).toBe(1);
    expect(compositor.isAlive()).toBe(false);

    // Listeners are gone, so a later loss cannot call back into a disposed
    // caller.
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onContextLost).not.toHaveBeenCalled();
  });

  it('is safe to call twice and deletes nothing a second time', () => {
    const gl = createFakeGl();
    const compositor = createCompositor(attachContext(gl))!;
    compositor.draw([makeChannel()], WINDOW);

    compositor.dispose();
    const after = {
      texture: countOf(gl, 'deleteTexture'),
      buffer: countOf(gl, 'deleteBuffer'),
      vao: countOf(gl, 'deleteVertexArray'),
      program: countOf(gl, 'deleteProgram'),
    };
    expect(() => compositor.dispose()).not.toThrow();

    expect(countOf(gl, 'deleteTexture')).toBe(after.texture);
    expect(countOf(gl, 'deleteBuffer')).toBe(after.buffer);
    expect(countOf(gl, 'deleteVertexArray')).toBe(after.vao);
    expect(countOf(gl, 'deleteProgram')).toBe(after.program);
  });

  it('makes draw() and setSize() no-ops afterwards', () => {
    const gl = createFakeGl();
    const canvas = attachContext(gl);
    const compositor = createCompositor(canvas)!;
    compositor.dispose();
    gl.calls.length = 0;

    expect(() => compositor.draw([makeChannel()], WINDOW)).not.toThrow();
    expect(() => compositor.setSize(800, 600)).not.toThrow();
    expect(gl.calls).toHaveLength(0);
    expect(canvas.width).not.toBe(800);
  });

  it('releases the GL context, but never after it was already lost', () => {
    const alive = createFakeGl();
    createCompositor(attachContext(alive))!.dispose();
    expect(countOf(alive, 'getExtension')).toBe(1);
    expect(named(alive, 'getExtension')[0].args).toEqual([
      'WEBGL_lose_context',
    ]);

    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const lost = createFakeGl();
    const canvas = attachContext(lost);
    const compositor = createCompositor(canvas)!;
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    compositor.dispose();
    expect(countOf(lost, 'getExtension')).toBe(0);
  });
});
