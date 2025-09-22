/**
 * Browser-specific performance analysis for vertex rendering
 * Tests WebGL capabilities, GPU utilization, and cross-browser performance
 */

export interface BrowserCapabilities {
  webgl: boolean;
  webgl2: boolean;
  offscreenCanvas: boolean;
  performanceObserver: boolean;
  memory: boolean;
  gpu: GPUInfo | null;
  maxTextureSize: number;
  maxVertexAttribs: number;
  maxVaryingVectors: number;
  renderer: string;
  vendor: string;
}

export interface GPUInfo {
  vendor: string;
  renderer: string;
  version: string;
  shadingLanguageVersion: string;
  maxTextureSize: number;
  maxCombinedTextureImageUnits: number;
  maxVertexTextureImageUnits: number;
  maxFragmentUniformVectors: number;
  maxVertexUniformVectors: number;
  maxVertexAttribs: number;
  maxVaryingVectors: number;
  aliasedLineWidthRange: [number, number];
  aliasedPointSizeRange: [number, number];
}

export interface WebGLPerformanceTest {
  name: string;
  vertexCount: number;
  drawCalls: number;
  textureSize: number;
  result: {
    frameTime: number;
    drawCallTime: number;
    bufferUploadTime: number;
    textureUploadTime: number;
    success: boolean;
    error?: string;
  };
}

export class BrowserPerformanceAnalyzer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private gl2: WebGL2RenderingContext | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 1024;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = '-9999px';
    this.canvas.style.top = '-9999px';
    document.body.appendChild(this.canvas);
  }

  public async analyzeBrowserCapabilities(): Promise<BrowserCapabilities> {
    const capabilities: BrowserCapabilities = {
      webgl: false,
      webgl2: false,
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      performanceObserver: typeof PerformanceObserver !== 'undefined',
      memory: 'memory' in performance,
      gpu: null,
      maxTextureSize: 0,
      maxVertexAttribs: 0,
      maxVaryingVectors: 0,
      renderer: 'unknown',
      vendor: 'unknown',
    };

    // Test WebGL capabilities
    try {
      this.gl =
        this.canvas.getContext('webgl') ||
        this.canvas.getContext('experimental-webgl');
      if (this.gl) {
        capabilities.webgl = true;
        capabilities.gpu = this.extractGPUInfo(this.gl);
        capabilities.maxTextureSize = this.gl.getParameter(
          this.gl.MAX_TEXTURE_SIZE
        );
        capabilities.maxVertexAttribs = this.gl.getParameter(
          this.gl.MAX_VERTEX_ATTRIBS
        );
        capabilities.maxVaryingVectors = this.gl.getParameter(
          this.gl.MAX_VARYING_VECTORS
        );

        const debugInfo = this.gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          capabilities.renderer =
            this.gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ||
            'unknown';
          capabilities.vendor =
            this.gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown';
        }
      }
    } catch (e) {
      console.warn('WebGL not supported:', e);
    }

    // Test WebGL2 capabilities
    try {
      this.gl2 = this.canvas.getContext('webgl2');
      if (this.gl2) {
        capabilities.webgl2 = true;
      }
    } catch (e) {
      console.warn('WebGL2 not supported:', e);
    }

    return capabilities;
  }

  private extractGPUInfo(gl: WebGLRenderingContext): GPUInfo {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

    return {
      vendor: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown'
        : gl.getParameter(gl.VENDOR) || 'unknown',
      renderer: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown'
        : gl.getParameter(gl.RENDERER) || 'unknown',
      version: gl.getParameter(gl.VERSION) || 'unknown',
      shadingLanguageVersion:
        gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || 'unknown',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxCombinedTextureImageUnits: gl.getParameter(
        gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS
      ),
      maxVertexTextureImageUnits: gl.getParameter(
        gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS
      ),
      maxFragmentUniformVectors: gl.getParameter(
        gl.MAX_FRAGMENT_UNIFORM_VECTORS
      ),
      maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
      maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
      aliasedLineWidthRange: gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE),
      aliasedPointSizeRange: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE),
    };
  }

  public async runWebGLPerformanceTests(): Promise<WebGLPerformanceTest[]> {
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }

    const tests: WebGLPerformanceTest[] = [];

    // Test scenarios with increasing complexity
    const scenarios = [
      {
        name: 'Basic Vertex Buffer',
        vertexCount: 1000,
        drawCalls: 1,
        textureSize: 0,
      },
      {
        name: 'Medium Complexity',
        vertexCount: 5000,
        drawCalls: 10,
        textureSize: 256,
      },
      {
        name: 'High Vertex Count',
        vertexCount: 10000,
        drawCalls: 1,
        textureSize: 0,
      },
      {
        name: 'Multiple Draw Calls',
        vertexCount: 2000,
        drawCalls: 50,
        textureSize: 0,
      },
      {
        name: 'Large Texture',
        vertexCount: 1000,
        drawCalls: 1,
        textureSize: 1024,
      },
      {
        name: 'Stress Test',
        vertexCount: 20000,
        drawCalls: 100,
        textureSize: 512,
      },
    ];

    for (const scenario of scenarios) {
      console.log(`Running WebGL test: ${scenario.name}`);
      const result = await this.runSingleWebGLTest(scenario);
      tests.push({
        ...scenario,
        result,
      });

      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return tests;
  }

  private async runSingleWebGLTest(scenario: {
    name: string;
    vertexCount: number;
    drawCalls: number;
    textureSize: number;
  }): Promise<WebGLPerformanceTest['result']> {
    if (!this.gl) {
      return {
        frameTime: 0,
        drawCallTime: 0,
        bufferUploadTime: 0,
        textureUploadTime: 0,
        success: false,
        error: 'WebGL not available',
      };
    }

    try {
      const gl = this.gl;
      const startTime = performance.now();

      // Create shader program
      const program = this.createShaderProgram(gl);
      if (!program) {
        throw new Error('Failed to create shader program');
      }

      // Generate vertex data
      const vertexData = this.generateVertexData(scenario.vertexCount);

      // Measure buffer upload time
      const bufferStartTime = performance.now();
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
      const bufferUploadTime = performance.now() - bufferStartTime;

      // Create texture if needed
      let textureUploadTime = 0;
      if (scenario.textureSize > 0) {
        const textureStartTime = performance.now();
        const texture = this.createTexture(gl, scenario.textureSize);
        textureUploadTime = performance.now() - textureStartTime;
      }

      // Setup rendering state
      gl.useProgram(program);

      const positionLocation = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      // Measure draw call performance
      const drawStartTime = performance.now();

      for (let i = 0; i < scenario.drawCalls; i++) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.POINTS, 0, scenario.vertexCount);
      }

      // Force GPU sync
      gl.finish();

      const drawCallTime = performance.now() - drawStartTime;
      const totalFrameTime = performance.now() - startTime;

      // Cleanup
      gl.deleteBuffer(vertexBuffer);
      gl.deleteProgram(program);

      return {
        frameTime: totalFrameTime,
        drawCallTime: drawCallTime,
        bufferUploadTime: bufferUploadTime,
        textureUploadTime: textureUploadTime,
        success: true,
      };
    } catch (error) {
      return {
        frameTime: 0,
        drawCallTime: 0,
        bufferUploadTime: 0,
        textureUploadTime: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private createShaderProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const vertexShaderSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        gl_PointSize = 2.0;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    `;

    const vertexShader = this.createShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource
    );
    const fragmentShader = this.createShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource
    );

    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        'Shader program link error:',
        gl.getProgramInfoLog(program)
      );
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  private createShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private generateVertexData(vertexCount: number): Float32Array {
    const data = new Float32Array(vertexCount * 2);

    for (let i = 0; i < vertexCount; i++) {
      // Generate vertices in a spiral pattern
      const angle = (i / vertexCount) * Math.PI * 8;
      const radius = (i / vertexCount) * 0.9;

      data[i * 2] = Math.cos(angle) * radius;
      data[i * 2 + 1] = Math.sin(angle) * radius;
    }

    return data;
  }

  private createTexture(
    gl: WebGLRenderingContext,
    size: number
  ): WebGLTexture | null {
    const texture = gl.createTexture();
    if (!texture) return null;

    // Generate texture data
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.floor(Math.random() * 256); // R
      data[i + 1] = Math.floor(Math.random() * 256); // G
      data[i + 2] = Math.floor(Math.random() * 256); // B
      data[i + 3] = 255; // A
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return texture;
  }

  public async measureCanvasPerformance(vertexCount: number): Promise<{
    renderTime: number;
    clearTime: number;
    pathTime: number;
    fillTime: number;
    success: boolean;
  }> {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return {
        renderTime: 0,
        clearTime: 0,
        pathTime: 0,
        fillTime: 0,
        success: false,
      };
    }

    const startTime = performance.now();

    // Measure clear time
    const clearStartTime = performance.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const clearTime = performance.now() - clearStartTime;

    // Generate vertices
    const vertices = [];
    for (let i = 0; i < vertexCount; i++) {
      const angle = (i / vertexCount) * Math.PI * 8;
      const radius = (i / vertexCount) * 400;
      vertices.push({
        x: 512 + Math.cos(angle) * radius,
        y: 512 + Math.sin(angle) * radius,
      });
    }

    // Measure path creation time
    const pathStartTime = performance.now();
    ctx.beginPath();
    vertices.forEach((vertex, i) => {
      if (i === 0) {
        ctx.moveTo(vertex.x, vertex.y);
      } else {
        ctx.lineTo(vertex.x, vertex.y);
      }
    });
    ctx.closePath();
    const pathTime = performance.now() - pathStartTime;

    // Measure fill time
    const fillStartTime = performance.now();
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.fill();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.stroke();
    const fillTime = performance.now() - fillStartTime;

    const totalRenderTime = performance.now() - startTime;

    return {
      renderTime: totalRenderTime,
      clearTime,
      pathTime,
      fillTime,
      success: true,
    };
  }

  public async measureSVGPerformance(vertexCount: number): Promise<{
    createTime: number;
    appendTime: number;
    styleTime: number;
    totalTime: number;
    success: boolean;
  }> {
    const startTime = performance.now();

    // Create SVG element
    const createStartTime = performance.now();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '1024');
    svg.setAttribute('height', '1024');
    svg.style.position = 'absolute';
    svg.style.left = '-9999px';
    svg.style.top = '-9999px';

    // Generate path data
    const vertices = [];
    for (let i = 0; i < vertexCount; i++) {
      const angle = (i / vertexCount) * Math.PI * 8;
      const radius = (i / vertexCount) * 400;
      vertices.push({
        x: 512 + Math.cos(angle) * radius,
        y: 512 + Math.sin(angle) * radius,
      });
    }

    const pathData =
      vertices
        .map((vertex, i) => `${i === 0 ? 'M' : 'L'} ${vertex.x} ${vertex.y}`)
        .join(' ') + ' Z';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    const createTime = performance.now() - createStartTime;

    // Measure append time
    const appendStartTime = performance.now();
    svg.appendChild(path);
    document.body.appendChild(svg);
    const appendTime = performance.now() - appendStartTime;

    // Measure style application time
    const styleStartTime = performance.now();
    path.setAttribute('fill', 'rgba(255, 0, 0, 0.5)');
    path.setAttribute('stroke', 'red');
    path.setAttribute('stroke-width', '2');
    const styleTime = performance.now() - styleStartTime;

    const totalTime = performance.now() - startTime;

    // Cleanup
    document.body.removeChild(svg);

    return {
      createTime,
      appendTime,
      styleTime,
      totalTime,
      success: true,
    };
  }

  public getBrowserInfo(): {
    userAgent: string;
    vendor: string;
    platform: string;
    language: string;
    cookieEnabled: boolean;
    onLine: boolean;
    hardwareConcurrency: number;
    deviceMemory?: number;
    connection?: any;
  } {
    return {
      userAgent: navigator.userAgent,
      vendor: navigator.vendor,
      platform: navigator.platform,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      connection: (navigator as any).connection,
    };
  }

  public dispose(): void {
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

export interface CrossBrowserTestResult {
  browser: string;
  capabilities: BrowserCapabilities;
  webglTests: WebGLPerformanceTest[];
  canvasPerformance: Array<{
    vertexCount: number;
    result: Awaited<
      ReturnType<BrowserPerformanceAnalyzer['measureCanvasPerformance']>
    >;
  }>;
  svgPerformance: Array<{
    vertexCount: number;
    result: Awaited<
      ReturnType<BrowserPerformanceAnalyzer['measureSVGPerformance']>
    >;
  }>;
  browserInfo: ReturnType<BrowserPerformanceAnalyzer['getBrowserInfo']>;
}

export async function runCrossBrowserPerformanceAnalysis(): Promise<CrossBrowserTestResult> {
  const analyzer = new BrowserPerformanceAnalyzer();

  try {
    console.log('Analyzing browser capabilities...');
    const capabilities = await analyzer.analyzeBrowserCapabilities();

    console.log('Running WebGL performance tests...');
    const webglTests = capabilities.webgl
      ? await analyzer.runWebGLPerformanceTests()
      : [];

    console.log('Testing Canvas 2D performance...');
    const canvasTests = [];
    for (const vertexCount of [500, 1000, 2000, 5000]) {
      const result = await analyzer.measureCanvasPerformance(vertexCount);
      canvasTests.push({ vertexCount, result });
    }

    console.log('Testing SVG performance...');
    const svgTests = [];
    for (const vertexCount of [500, 1000, 2000, 5000]) {
      const result = await analyzer.measureSVGPerformance(vertexCount);
      svgTests.push({ vertexCount, result });
    }

    const browserInfo = analyzer.getBrowserInfo();

    return {
      browser: getBrowserName(browserInfo.userAgent),
      capabilities,
      webglTests,
      canvasPerformance: canvasTests,
      svgPerformance: svgTests,
      browserInfo,
    };
  } finally {
    analyzer.dispose();
  }
}

function getBrowserName(userAgent: string): string {
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
    return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  if (userAgent.includes('Opera')) return 'Opera';
  return 'Unknown';
}
