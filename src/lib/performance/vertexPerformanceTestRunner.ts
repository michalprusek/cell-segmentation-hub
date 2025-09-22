/**
 * Comprehensive vertex performance test runner
 * Orchestrates all performance tests and generates detailed reports
 */

import {
  VertexPerformanceProfiler,
  PerformanceReport,
  VERTEX_PERFORMANCE_SCENARIOS,
  PerformanceMetrics,
} from './vertexPerformanceProfiler';

import {
  BrowserPerformanceAnalyzer,
  CrossBrowserTestResult,
  runCrossBrowserPerformanceAnalysis,
} from './browserPerformanceAnalyzer';

export interface ComprehensivePerformanceReport {
  timestamp: string;
  testDuration: number;
  browser: string;
  system: SystemInfo;
  vertexPerformance: PerformanceReport;
  browserAnalysis: CrossBrowserTestResult;
  webglBaseline: WebGLBaselineResults;
  recommendations: WebGLImplementationRecommendations;
  performanceTargets: WebGLPerformanceTargets;
  stressTestResults: StressTestResults;
}

export interface SystemInfo {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  connection?: any;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  memoryInfo?: {
    totalJSHeapSize: number;
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export interface WebGLBaselineResults {
  maxSupportedVertices: number;
  maxTextureSizeSupported: number;
  maxDrawCallsPerFrame: number;
  bufferUploadRate: number; // MB/s
  textureUploadRate: number; // MB/s
  targetFrameTime: number; // ms for 60fps
  memoryBudget: number; // MB
  instancingSupported: boolean;
  floatTexturesSupported: boolean;
}

export interface WebGLPerformanceTargets {
  vertexCounts: {
    minimum: number; // Must handle smoothly
    target: number; // Should handle at 60fps
    maximum: number; // Acceptable with reduced quality
    stress: number; // Emergency fallback
  };
  frameTimeTargets: {
    render: number; // ms per render frame
    interaction: number; // ms per interaction frame
    zoom: number; // ms per zoom frame
    pan: number; // ms per pan frame
  };
  memoryTargets: {
    vertexBuffer: number; // MB per vertex buffer
    texture: number; // MB for texture memory
    total: number; // MB total WebGL memory
  };
  qualityLevels: {
    high: QualityLevelSpec;
    medium: QualityLevelSpec;
    low: QualityLevelSpec;
    emergency: QualityLevelSpec;
  };
}

export interface QualityLevelSpec {
  maxVerticesVisible: number;
  vertexDecimationStep: number;
  textureResolution: number;
  antialiasing: boolean;
  shadowing: boolean;
  instancingEnabled: boolean;
}

export interface WebGLImplementationRecommendations {
  priority: 'critical' | 'high' | 'medium' | 'low';
  architecture: {
    bufferManagement: string[];
    shaderOptimization: string[];
    textureStrategy: string[];
    cullingApproach: string[];
  };
  performance: {
    lodImplementation: string[];
    instancedRendering: string[];
    batchOptimization: string[];
    memoryManagement: string[];
  };
  fallbacks: {
    webglUnavailable: string;
    lowPerformance: string;
    memoryConstrained: string;
  };
  implementation: {
    shaderSpecs: ShaderSpecification[];
    bufferSpecs: BufferSpecification[];
    textureSpecs: TextureSpecification[];
  };
}

export interface ShaderSpecification {
  name: string;
  type: 'vertex' | 'fragment';
  purpose: string;
  optimizations: string[];
  fallbacks: string[];
}

export interface BufferSpecification {
  name: string;
  type: 'vertex' | 'index' | 'uniform';
  updateFrequency: 'static' | 'dynamic' | 'stream';
  size: string;
  optimizations: string[];
}

export interface TextureSpecification {
  name: string;
  format: string;
  size: string;
  purpose: string;
  compression: boolean;
}

export interface StressTestResults {
  maxStableVertexCount: number;
  degradationPoints: Array<{
    vertexCount: number;
    fps: number;
    frameTime: number;
    description: string;
  }>;
  memoryLeakDetected: boolean;
  browserCrashPoint?: number;
  recoveryMechanisms: string[];
}

export class VertexPerformanceTestRunner {
  private profiler: VertexPerformanceProfiler;
  private browserAnalyzer: BrowserPerformanceAnalyzer;

  constructor() {
    this.profiler = new VertexPerformanceProfiler();
    this.browserAnalyzer = new BrowserPerformanceAnalyzer();
  }

  public async runComprehensivePerformanceAnalysis(): Promise<ComprehensivePerformanceReport> {
    const startTime = performance.now();
    console.log('🚀 Starting comprehensive vertex performance analysis...');

    // Gather system information
    console.log('📊 Gathering system information...');
    const systemInfo = this.getSystemInfo();

    // Run browser capability analysis
    console.log('🌐 Analyzing browser capabilities...');
    const browserAnalysis = await runCrossBrowserPerformanceAnalysis();

    // Run vertex performance profiling
    console.log('⚡ Profiling vertex rendering performance...');
    const vertexMetrics: PerformanceMetrics[] = [];

    for (const scenario of VERTEX_PERFORMANCE_SCENARIOS) {
      console.log(`  🧪 Running scenario: ${scenario.name}`);
      const metrics = await this.profiler.runVertexStressTest(scenario);
      vertexMetrics.push(...metrics);
    }

    const vertexPerformance = this.profiler.getPerformanceReport(vertexMetrics);

    // Establish WebGL baseline
    console.log('🎯 Establishing WebGL performance baseline...');
    const webglBaseline = await this.establishWebGLBaseline();

    // Generate performance targets
    console.log('📈 Generating WebGL performance targets...');
    const performanceTargets = this.generatePerformanceTargets(
      vertexPerformance,
      browserAnalysis,
      webglBaseline
    );

    // Run stress tests
    console.log('💪 Running stress tests...');
    const stressTestResults = await this.runStressTests();

    // Generate implementation recommendations
    console.log('💡 Generating implementation recommendations...');
    const recommendations = this.generateImplementationRecommendations(
      vertexPerformance,
      browserAnalysis,
      webglBaseline,
      stressTestResults
    );

    const testDuration = performance.now() - startTime;

    const report: ComprehensivePerformanceReport = {
      timestamp: new Date().toISOString(),
      testDuration,
      browser: this.getBrowserName(),
      system: systemInfo,
      vertexPerformance,
      browserAnalysis,
      webglBaseline,
      recommendations,
      performanceTargets,
      stressTestResults,
    };

    console.log(
      `✅ Performance analysis completed in ${(testDuration / 1000).toFixed(2)}s`
    );
    return report;
  }

  private getSystemInfo(): SystemInfo {
    const memoryInfo =
      'memory' in performance ? (performance as any).memory : undefined;

    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      connection: (navigator as any).connection,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      memoryInfo: memoryInfo
        ? {
            totalJSHeapSize: memoryInfo.totalJSHeapSize,
            usedJSHeapSize: memoryInfo.usedJSHeapSize,
            jsHeapSizeLimit: memoryInfo.jsHeapSizeLimit,
          }
        : undefined,
    };
  }

  private async establishWebGLBaseline(): Promise<WebGLBaselineResults> {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (!gl) {
      return {
        maxSupportedVertices: 0,
        maxTextureSizeSupported: 0,
        maxDrawCallsPerFrame: 0,
        bufferUploadRate: 0,
        textureUploadRate: 0,
        targetFrameTime: 16.67, // 60fps
        memoryBudget: 0,
        instancingSupported: false,
        floatTexturesSupported: false,
      };
    }

    // Test maximum supported vertices
    const maxVertices = await this.findMaxSupportedVertices(gl);

    // Test buffer upload rate
    const bufferUploadRate = await this.measureBufferUploadRate(gl);

    // Test texture upload rate
    const textureUploadRate = await this.measureTextureUploadRate(gl);

    // Test maximum draw calls per frame
    const maxDrawCalls = await this.findMaxDrawCallsPerFrame(gl);

    // Check extension support
    const instancing = gl.getExtension('ANGLE_instanced_arrays') !== null;
    const floatTextures = gl.getExtension('OES_texture_float') !== null;

    return {
      maxSupportedVertices: maxVertices,
      maxTextureSizeSupported: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxDrawCallsPerFrame: maxDrawCalls,
      bufferUploadRate,
      textureUploadRate,
      targetFrameTime: 16.67,
      memoryBudget: this.estimateWebGLMemoryBudget(),
      instancingSupported: instancing,
      floatTexturesSupported: floatTextures,
    };
  }

  private async findMaxSupportedVertices(
    gl: WebGLRenderingContext
  ): Promise<number> {
    let maxVertices = 1000;
    let step = 1000;
    let lastSuccessful = 1000;

    // Binary search for maximum vertex count
    for (let attempts = 0; attempts < 20; attempts++) {
      try {
        const buffer = gl.createBuffer();
        const data = new Float32Array(maxVertices * 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

        // Check for GL errors
        if (gl.getError() === gl.NO_ERROR) {
          lastSuccessful = maxVertices;
          maxVertices += step;
        } else {
          maxVertices -= Math.floor(step / 2);
          step = Math.floor(step / 2);
        }

        gl.deleteBuffer(buffer);

        if (step < 100) break;
      } catch (e) {
        maxVertices -= Math.floor(step / 2);
        step = Math.floor(step / 2);
        if (step < 100) break;
      }
    }

    return lastSuccessful;
  }

  private async measureBufferUploadRate(
    gl: WebGLRenderingContext
  ): Promise<number> {
    const testSizes = [1024, 2048, 4096, 8192]; // Number of vertices
    const results = [];

    for (const size of testSizes) {
      const data = new Float32Array(size * 2); // x, y coordinates
      const buffer = gl.createBuffer();

      const startTime = performance.now();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const endTime = performance.now();

      const sizeInMB = data.byteLength / (1024 * 1024);
      const timeInSeconds = (endTime - startTime) / 1000;
      const rate = sizeInMB / timeInSeconds;

      results.push(rate);
      gl.deleteBuffer(buffer);
    }

    // Return average upload rate in MB/s
    return results.reduce((a, b) => a + b, 0) / results.length;
  }

  private async measureTextureUploadRate(
    gl: WebGLRenderingContext
  ): Promise<number> {
    const testSizes = [256, 512, 1024];
    const results = [];

    for (const size of testSizes) {
      const data = new Uint8Array(size * size * 4); // RGBA
      const texture = gl.createTexture();

      const startTime = performance.now();
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
      const endTime = performance.now();

      const sizeInMB = data.byteLength / (1024 * 1024);
      const timeInSeconds = (endTime - startTime) / 1000;
      const rate = sizeInMB / timeInSeconds;

      results.push(rate);
      gl.deleteTexture(texture);
    }

    return results.reduce((a, b) => a + b, 0) / results.length;
  }

  private async findMaxDrawCallsPerFrame(
    gl: WebGLRenderingContext
  ): Promise<number> {
    // Create a simple shader program for testing
    const program = this.createTestShaderProgram(gl);
    if (!program) return 0;

    const buffer = gl.createBuffer();
    const data = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    gl.useProgram(program);
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    let maxDrawCalls = 0;
    const targetFrameTime = 16.67; // 60fps

    // Test increasing draw call counts
    for (let drawCalls = 10; drawCalls <= 1000; drawCalls += 10) {
      const startTime = performance.now();

      gl.clear(gl.COLOR_BUFFER_BIT);
      for (let i = 0; i < drawCalls; i++) {
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.finish(); // Force GPU sync

      const frameTime = performance.now() - startTime;

      if (frameTime < targetFrameTime) {
        maxDrawCalls = drawCalls;
      } else {
        break;
      }
    }

    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);

    return maxDrawCalls;
  }

  private createTestShaderProgram(
    gl: WebGLRenderingContext
  ): WebGLProgram | null {
    const vertexShaderSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
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

    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
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
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private estimateWebGLMemoryBudget(): number {
    // Estimate based on system memory and typical WebGL limits
    const deviceMemory = (navigator as any).deviceMemory;
    if (deviceMemory) {
      // Use 10% of device memory as WebGL budget, capped at 512MB
      return Math.min(deviceMemory * 1024 * 0.1, 512);
    }

    // Default conservative estimate
    return 128; // MB
  }

  private generatePerformanceTargets(
    vertexPerformance: PerformanceReport,
    browserAnalysis: CrossBrowserTestResult,
    webglBaseline: WebGLBaselineResults
  ): WebGLPerformanceTargets {
    // Analyze current performance to set realistic targets
    const currentPerformance = vertexPerformance.summary;

    return {
      vertexCounts: {
        minimum: 1000, // Must handle smoothly
        target: Math.min(webglBaseline.maxSupportedVertices * 0.5, 5000),
        maximum: Math.min(webglBaseline.maxSupportedVertices * 0.8, 10000),
        stress: webglBaseline.maxSupportedVertices,
      },
      frameTimeTargets: {
        render: 8.33, // 120fps for smooth rendering
        interaction: 16.67, // 60fps for interactions
        zoom: 33.33, // 30fps acceptable for zoom
        pan: 16.67, // 60fps for smooth panning
      },
      memoryTargets: {
        vertexBuffer: webglBaseline.memoryBudget * 0.3,
        texture: webglBaseline.memoryBudget * 0.4,
        total: webglBaseline.memoryBudget * 0.8,
      },
      qualityLevels: {
        high: {
          maxVerticesVisible: 5000,
          vertexDecimationStep: 1,
          textureResolution: 1024,
          antialiasing: true,
          shadowing: true,
          instancingEnabled: true,
        },
        medium: {
          maxVerticesVisible: 2000,
          vertexDecimationStep: 2,
          textureResolution: 512,
          antialiasing: true,
          shadowing: false,
          instancingEnabled: true,
        },
        low: {
          maxVerticesVisible: 1000,
          vertexDecimationStep: 4,
          textureResolution: 256,
          antialiasing: false,
          shadowing: false,
          instancingEnabled: false,
        },
        emergency: {
          maxVerticesVisible: 500,
          vertexDecimationStep: 8,
          textureResolution: 128,
          antialiasing: false,
          shadowing: false,
          instancingEnabled: false,
        },
      },
    };
  }

  private async runStressTests(): Promise<StressTestResults> {
    const results: StressTestResults = {
      maxStableVertexCount: 0,
      degradationPoints: [],
      memoryLeakDetected: false,
      recoveryMechanisms: [],
    };

    // Test increasing vertex counts until degradation
    const testCounts = [1000, 2000, 5000, 10000, 20000, 50000];

    for (const vertexCount of testCounts) {
      try {
        console.log(`  🧪 Stress testing ${vertexCount} vertices...`);

        const startMemory = this.getCurrentMemoryUsage();
        this.profiler.startProfiling();

        // Simulate intensive operations
        await this.profiler.runVertexStressTest({
          name: `Stress Test ${vertexCount}`,
          vertexCounts: [vertexCount],
          operations: ['render', 'drag', 'zoom'],
          duration: 2000,
          renderModes: ['svg', 'canvas'],
        });

        const metrics = this.profiler.stopProfiling();
        const endMemory = this.getCurrentMemoryUsage();

        const summary = this.profiler.getPerformanceReport(metrics).summary;

        results.degradationPoints.push({
          vertexCount,
          fps: summary.avgFPS,
          frameTime: summary.avgFrameTime,
          description: `${summary.avgFPS < 30 ? 'Poor' : summary.avgFPS < 60 ? 'Acceptable' : 'Good'} performance`,
        });

        // Check for memory leaks
        if (endMemory - startMemory > 50 * 1024 * 1024) {
          // 50MB increase
          results.memoryLeakDetected = true;
        }

        // Update max stable count
        if (summary.avgFPS >= 30) {
          results.maxStableVertexCount = vertexCount;
        }
      } catch (error) {
        results.browserCrashPoint = vertexCount;
        break;
      }
    }

    // Generate recovery mechanisms
    results.recoveryMechanisms = [
      'Automatic quality reduction when FPS drops below 30',
      'Progressive vertex loading for large datasets',
      'Emergency fallback to simplified rendering',
      'Memory cleanup and garbage collection triggers',
      'User notification for performance issues',
    ];

    return results;
  }

  private getCurrentMemoryUsage(): number {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0;
  }

  private generateImplementationRecommendations(
    vertexPerformance: PerformanceReport,
    browserAnalysis: CrossBrowserTestResult,
    webglBaseline: WebGLBaselineResults,
    stressResults: StressTestResults
  ): WebGLImplementationRecommendations {
    const avgFPS = vertexPerformance.summary.avgFPS;
    const webglSupported = browserAnalysis.capabilities.webgl;

    // Determine priority based on current performance
    let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    if (avgFPS < 30) priority = 'critical';
    else if (avgFPS < 60) priority = 'high';
    else if (stressResults.maxStableVertexCount < 2000) priority = 'high';

    return {
      priority,
      architecture: {
        bufferManagement: [
          'Use static vertex buffers for unchanging geometry',
          'Implement dynamic buffer updates for interactive vertices',
          'Pool vertex buffers to reduce allocation overhead',
          'Use interleaved vertex attributes for better cache performance',
        ],
        shaderOptimization: [
          'Write specialized shaders for vertex rendering',
          'Use uniform buffers for shared transformation data',
          'Implement instanced rendering for similar vertices',
          'Optimize shader compilation and caching',
        ],
        textureStrategy: [
          'Use texture atlases for vertex icons/markers',
          'Implement texture streaming for large datasets',
          'Compress textures where possible',
          'Use appropriate texture formats for each use case',
        ],
        cullingApproach: [
          'Implement frustum culling for off-screen vertices',
          'Use spatial indexing for efficient culling',
          'Implement distance-based LOD culling',
          'Cache culling results when possible',
        ],
      },
      performance: {
        lodImplementation: [
          'Progressive vertex decimation based on zoom level',
          'Distance-based level of detail switching',
          'Temporal LOD for animation smoothness',
          'User-configurable quality settings',
        ],
        instancedRendering: [
          'Group similar vertices for instanced drawing',
          'Use instanced arrays for position offsets',
          'Batch state changes to minimize draw calls',
          'Implement automatic batching system',
        ],
        batchOptimization: [
          'Sort vertices by render state',
          'Minimize texture and shader changes',
          'Use vertex buffer objects efficiently',
          'Implement draw call reduction strategies',
        ],
        memoryManagement: [
          'Implement vertex buffer pooling',
          'Use typed arrays for better performance',
          'Implement automatic garbage collection',
          'Monitor and limit memory usage',
        ],
      },
      fallbacks: {
        webglUnavailable: webglSupported
          ? 'Not needed - WebGL is supported'
          : 'Fall back to optimized Canvas 2D rendering with LOD',
        lowPerformance: 'Automatic quality reduction and vertex decimation',
        memoryConstrained: 'Progressive loading and vertex streaming',
      },
      implementation: {
        shaderSpecs: [
          {
            name: 'VertexRenderer',
            type: 'vertex',
            purpose: 'Transform and position vertices',
            optimizations: ['Vertex attribute compression', 'Matrix caching'],
            fallbacks: ['Fixed-function pipeline', 'Software transform'],
          },
          {
            name: 'VertexFragment',
            type: 'fragment',
            purpose: 'Render vertex appearance',
            optimizations: [
              'Early fragment discard',
              'Texture sampling optimization',
            ],
            fallbacks: ['Simpler fragment shader', 'Fixed color rendering'],
          },
        ],
        bufferSpecs: [
          {
            name: 'VertexPositions',
            type: 'vertex',
            updateFrequency: 'dynamic',
            size: 'Based on vertex count * 8 bytes (vec2)',
            optimizations: ['Buffer subdata updates', 'Double buffering'],
          },
          {
            name: 'VertexIndices',
            type: 'index',
            updateFrequency: 'static',
            size: 'Based on polygon complexity',
            optimizations: [
              '16-bit indices when possible',
              'Index buffer compression',
            ],
          },
        ],
        textureSpecs: [
          {
            name: 'VertexAtlas',
            format: 'RGBA8',
            size: '1024x1024 or smaller based on GPU limits',
            purpose: 'Vertex icons and markers',
            compression: true,
          },
        ],
      },
    };
  }

  private getBrowserName(): string {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
      return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  }

  public dispose(): void {
    this.profiler.dispose();
    this.browserAnalyzer.dispose();
  }
}

// Utility function to run the complete analysis
export async function runVertexPerformanceAnalysis(): Promise<ComprehensivePerformanceReport> {
  const runner = new VertexPerformanceTestRunner();
  try {
    return await runner.runComprehensivePerformanceAnalysis();
  } finally {
    runner.dispose();
  }
}
