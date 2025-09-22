/**
 * WebGL Memory Usage Analyzer for Vertex Rendering
 * Analyzes GPU memory usage patterns and optimization opportunities
 */

export interface WebGLMemoryProfile {
  vertexBuffers: BufferMemoryUsage;
  indexBuffers: BufferMemoryUsage;
  textures: TextureMemoryUsage;
  shaders: ShaderMemoryUsage;
  total: TotalMemoryUsage;
  recommendations: MemoryOptimizationRecommendations;
}

export interface BufferMemoryUsage {
  staticBuffers: number; // bytes
  dynamicBuffers: number; // bytes
  streamBuffers: number; // bytes
  totalBuffers: number;
  averageBufferSize: number;
  largestBuffer: number;
  bufferCount: number;
  usage: {
    [key: string]: {
      size: number;
      type: 'STATIC_DRAW' | 'DYNAMIC_DRAW' | 'STREAM_DRAW';
      lastUsed: number;
    };
  };
}

export interface TextureMemoryUsage {
  totalTextureMemory: number; // bytes
  activeTextures: number;
  largestTexture: number;
  textureFormats: {
    [format: string]: {
      count: number;
      totalSize: number;
    };
  };
  compressionRatio: number;
  usage: {
    [id: string]: {
      width: number;
      height: number;
      format: string;
      size: number;
      lastUsed: number;
    };
  };
}

export interface ShaderMemoryUsage {
  programCount: number;
  compiledShaders: number;
  totalShaderMemory: number; // estimated
  programs: {
    [id: string]: {
      vertexShader: string;
      fragmentShader: string;
      uniformCount: number;
      attributeCount: number;
    };
  };
}

export interface TotalMemoryUsage {
  estimatedGPUMemory: number; // bytes
  systemMemoryUsed: number; // bytes
  memoryEfficiency: number; // 0-1 ratio
  fragmentationLevel: number; // 0-1 ratio
  availableMemory: number; // bytes remaining
  memoryPressure: 'low' | 'medium' | 'high' | 'critical';
}

export interface MemoryOptimizationRecommendations {
  priority: 'critical' | 'high' | 'medium' | 'low';
  bufferOptimizations: string[];
  textureOptimizations: string[];
  shaderOptimizations: string[];
  systemOptimizations: string[];
  memoryBudget: MemoryBudgetPlan;
}

export interface MemoryBudgetPlan {
  totalBudget: number; // MB
  vertexBuffers: number; // MB
  indexBuffers: number; // MB
  textures: number; // MB
  shaders: number; // MB
  overhead: number; // MB
  emergency: number; // MB reserved for critical operations
}

export interface WebGLResourceTracker {
  buffers: Map<WebGLBuffer, BufferInfo>;
  textures: Map<WebGLTexture, TextureInfo>;
  programs: Map<WebGLProgram, ProgramInfo>;
  totalAllocated: number;
  peakUsage: number;
  allocationHistory: AllocationEvent[];
}

export interface BufferInfo {
  size: number;
  type: number; // GL buffer type
  usage: number; // GL usage pattern
  created: number; // timestamp
  lastUsed: number; // timestamp
  id: string;
}

export interface TextureInfo {
  width: number;
  height: number;
  format: number;
  type: number;
  size: number;
  created: number;
  lastUsed: number;
  id: string;
}

export interface ProgramInfo {
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
  uniformCount: number;
  attributeCount: number;
  created: number;
  lastUsed: number;
  id: string;
}

export interface AllocationEvent {
  timestamp: number;
  type: 'buffer' | 'texture' | 'program';
  action: 'allocate' | 'deallocate';
  size: number;
  id: string;
}

export class WebGLMemoryAnalyzer {
  private gl: WebGLRenderingContext | null = null;
  private tracker: WebGLResourceTracker;
  private originalMethods: { [key: string]: any } = {};
  private isTracking = false;

  constructor() {
    this.tracker = {
      buffers: new Map(),
      textures: new Map(),
      programs: new Map(),
      totalAllocated: 0,
      peakUsage: 0,
      allocationHistory: [],
    };
  }

  public initializeTracking(gl: WebGLRenderingContext): void {
    this.gl = gl;
    this.isTracking = true;

    // Intercept WebGL allocation methods
    this.interceptBufferMethods(gl);
    this.interceptTextureMethods(gl);
    this.interceptProgramMethods(gl);
  }

  private interceptBufferMethods(gl: WebGLRenderingContext): void {
    // Store original methods
    this.originalMethods.createBuffer = gl.createBuffer.bind(gl);
    this.originalMethods.deleteBuffer = gl.deleteBuffer.bind(gl);
    this.originalMethods.bufferData = gl.bufferData.bind(gl);

    // Override createBuffer
    gl.createBuffer = () => {
      const buffer = this.originalMethods.createBuffer();
      if (buffer) {
        const id = this.generateId();
        this.tracker.buffers.set(buffer, {
          size: 0,
          type: 0,
          usage: 0,
          created: performance.now(),
          lastUsed: performance.now(),
          id,
        });
      }
      return buffer;
    };

    // Override deleteBuffer
    gl.deleteBuffer = buffer => {
      if (buffer && this.tracker.buffers.has(buffer)) {
        const bufferInfo = this.tracker.buffers.get(buffer)!;
        this.tracker.totalAllocated -= bufferInfo.size;
        this.recordAllocation(
          'buffer',
          'deallocate',
          bufferInfo.size,
          bufferInfo.id
        );
        this.tracker.buffers.delete(buffer);
      }
      return this.originalMethods.deleteBuffer(buffer);
    };

    // Override bufferData
    gl.bufferData = (target, data, usage) => {
      const currentBuffer = this.getCurrentBuffer(gl, target);
      if (currentBuffer && this.tracker.buffers.has(currentBuffer)) {
        const bufferInfo = this.tracker.buffers.get(currentBuffer)!;
        const oldSize = bufferInfo.size;

        let newSize = 0;
        if (data instanceof ArrayBuffer) {
          newSize = data.byteLength;
        } else if (data && typeof data === 'object' && 'byteLength' in data) {
          newSize = (data as any).byteLength;
        } else if (typeof data === 'number') {
          newSize = data;
        }

        bufferInfo.size = newSize;
        bufferInfo.type = target;
        bufferInfo.usage = usage;
        bufferInfo.lastUsed = performance.now();

        this.tracker.totalAllocated += newSize - oldSize;
        this.updatePeakUsage();
        this.recordAllocation('buffer', 'allocate', newSize, bufferInfo.id);
      }

      return this.originalMethods.bufferData(target, data, usage);
    };
  }

  private interceptTextureMethods(gl: WebGLRenderingContext): void {
    this.originalMethods.createTexture = gl.createTexture.bind(gl);
    this.originalMethods.deleteTexture = gl.deleteTexture.bind(gl);
    this.originalMethods.texImage2D = gl.texImage2D.bind(gl);

    gl.createTexture = () => {
      const texture = this.originalMethods.createTexture();
      if (texture) {
        const id = this.generateId();
        this.tracker.textures.set(texture, {
          width: 0,
          height: 0,
          format: 0,
          type: 0,
          size: 0,
          created: performance.now(),
          lastUsed: performance.now(),
          id,
        });
      }
      return texture;
    };

    gl.deleteTexture = texture => {
      if (texture && this.tracker.textures.has(texture)) {
        const textureInfo = this.tracker.textures.get(texture)!;
        this.tracker.totalAllocated -= textureInfo.size;
        this.recordAllocation(
          'texture',
          'deallocate',
          textureInfo.size,
          textureInfo.id
        );
        this.tracker.textures.delete(texture);
      }
      return this.originalMethods.deleteTexture(texture);
    };

    gl.texImage2D = (
      target,
      level,
      internalFormat,
      width,
      height,
      border,
      format,
      type,
      data
    ) => {
      if (typeof width === 'number' && typeof height === 'number') {
        const currentTexture = this.getCurrentTexture(gl, target);
        if (currentTexture && this.tracker.textures.has(currentTexture)) {
          const textureInfo = this.tracker.textures.get(currentTexture)!;
          const oldSize = textureInfo.size;

          textureInfo.width = width;
          textureInfo.height = height;
          textureInfo.format = format;
          textureInfo.type = type;
          textureInfo.size = this.calculateTextureSize(
            width,
            height,
            format,
            type
          );
          textureInfo.lastUsed = performance.now();

          this.tracker.totalAllocated += textureInfo.size - oldSize;
          this.updatePeakUsage();
          this.recordAllocation(
            'texture',
            'allocate',
            textureInfo.size,
            textureInfo.id
          );
        }
      }

      // Handle overloaded signature
      if (arguments.length === 6) {
        return this.originalMethods.texImage2D(
          target,
          level,
          internalFormat,
          width,
          height,
          border
        );
      } else {
        return this.originalMethods.texImage2D(
          target,
          level,
          internalFormat,
          width,
          height,
          border,
          format,
          type,
          data
        );
      }
    };
  }

  private interceptProgramMethods(gl: WebGLRenderingContext): void {
    this.originalMethods.createProgram = gl.createProgram.bind(gl);
    this.originalMethods.deleteProgram = gl.deleteProgram.bind(gl);
    this.originalMethods.linkProgram = gl.linkProgram.bind(gl);

    gl.createProgram = () => {
      const program = this.originalMethods.createProgram();
      if (program) {
        const id = this.generateId();
        this.tracker.programs.set(program, {
          vertexShader: null as any,
          fragmentShader: null as any,
          uniformCount: 0,
          attributeCount: 0,
          created: performance.now(),
          lastUsed: performance.now(),
          id,
        });
      }
      return program;
    };

    gl.deleteProgram = program => {
      if (program && this.tracker.programs.has(program)) {
        const programInfo = this.tracker.programs.get(program)!;
        const estimatedSize = this.estimateProgramSize(programInfo);
        this.tracker.totalAllocated -= estimatedSize;
        this.recordAllocation(
          'program',
          'deallocate',
          estimatedSize,
          programInfo.id
        );
        this.tracker.programs.delete(program);
      }
      return this.originalMethods.deleteProgram(program);
    };

    gl.linkProgram = program => {
      const result = this.originalMethods.linkProgram(program);

      if (program && this.tracker.programs.has(program)) {
        const programInfo = this.tracker.programs.get(program)!;
        programInfo.uniformCount = gl.getProgramParameter(
          program,
          gl.ACTIVE_UNIFORMS
        );
        programInfo.attributeCount = gl.getProgramParameter(
          program,
          gl.ACTIVE_ATTRIBUTES
        );
        programInfo.lastUsed = performance.now();

        const estimatedSize = this.estimateProgramSize(programInfo);
        this.tracker.totalAllocated += estimatedSize;
        this.updatePeakUsage();
        this.recordAllocation(
          'program',
          'allocate',
          estimatedSize,
          programInfo.id
        );
      }

      return result;
    };
  }

  private getCurrentBuffer(
    gl: WebGLRenderingContext,
    target: number
  ): WebGLBuffer | null {
    // This is a simplified approach - in practice, you'd need to track bound buffers
    return gl.getParameter(
      target === gl.ARRAY_BUFFER
        ? gl.ARRAY_BUFFER_BINDING
        : gl.ELEMENT_ARRAY_BUFFER_BINDING
    );
  }

  private getCurrentTexture(
    gl: WebGLRenderingContext,
    target: number
  ): WebGLTexture | null {
    return gl.getParameter(gl.TEXTURE_BINDING_2D);
  }

  private calculateTextureSize(
    width: number,
    height: number,
    format: number,
    type: number
  ): number {
    if (!this.gl) return 0;

    let bytesPerPixel = 4; // Default RGBA

    // Estimate bytes per pixel based on format and type
    switch (format) {
      case this.gl.RGB:
        bytesPerPixel = type === this.gl.UNSIGNED_BYTE ? 3 : 6;
        break;
      case this.gl.RGBA:
        bytesPerPixel = type === this.gl.UNSIGNED_BYTE ? 4 : 8;
        break;
      case this.gl.ALPHA:
      case this.gl.LUMINANCE:
        bytesPerPixel = type === this.gl.UNSIGNED_BYTE ? 1 : 2;
        break;
      case this.gl.LUMINANCE_ALPHA:
        bytesPerPixel = type === this.gl.UNSIGNED_BYTE ? 2 : 4;
        break;
    }

    return width * height * bytesPerPixel;
  }

  private estimateProgramSize(programInfo: ProgramInfo): number {
    // Rough estimate: 1KB base + 100 bytes per uniform + 50 bytes per attribute
    return (
      1024 + programInfo.uniformCount * 100 + programInfo.attributeCount * 50
    );
  }

  private updatePeakUsage(): void {
    if (this.tracker.totalAllocated > this.tracker.peakUsage) {
      this.tracker.peakUsage = this.tracker.totalAllocated;
    }
  }

  private recordAllocation(
    type: 'buffer' | 'texture' | 'program',
    action: 'allocate' | 'deallocate',
    size: number,
    id: string
  ): void {
    this.tracker.allocationHistory.push({
      timestamp: performance.now(),
      type,
      action,
      size,
      id,
    });

    // Keep only last 1000 allocation events
    if (this.tracker.allocationHistory.length > 1000) {
      this.tracker.allocationHistory =
        this.tracker.allocationHistory.slice(-1000);
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  public analyzeMemoryUsage(): WebGLMemoryProfile {
    if (!this.gl || !this.isTracking) {
      throw new Error('Memory tracking not initialized');
    }

    const bufferUsage = this.analyzeBufferUsage();
    const textureUsage = this.analyzeTextureUsage();
    const shaderUsage = this.analyzeShaderUsage();
    const totalUsage = this.analyzeTotalUsage();
    const recommendations = this.generateRecommendations(
      bufferUsage,
      textureUsage,
      shaderUsage,
      totalUsage
    );

    return {
      vertexBuffers: bufferUsage,
      indexBuffers: bufferUsage, // Combined for simplicity
      textures: textureUsage,
      shaders: shaderUsage,
      total: totalUsage,
      recommendations,
    };
  }

  private analyzeBufferUsage(): BufferMemoryUsage {
    let staticBuffers = 0;
    let dynamicBuffers = 0;
    let streamBuffers = 0;
    let totalSize = 0;
    let largestBuffer = 0;
    const usage: BufferMemoryUsage['usage'] = {};

    for (const [buffer, info] of this.tracker.buffers) {
      totalSize += info.size;
      largestBuffer = Math.max(largestBuffer, info.size);

      if (info.usage === this.gl!.STATIC_DRAW) {
        staticBuffers += info.size;
      } else if (info.usage === this.gl!.DYNAMIC_DRAW) {
        dynamicBuffers += info.size;
      } else if (info.usage === this.gl!.STREAM_DRAW) {
        streamBuffers += info.size;
      }

      usage[info.id] = {
        size: info.size,
        type:
          info.usage === this.gl!.STATIC_DRAW
            ? 'STATIC_DRAW'
            : info.usage === this.gl!.DYNAMIC_DRAW
              ? 'DYNAMIC_DRAW'
              : 'STREAM_DRAW',
        lastUsed: info.lastUsed,
      };
    }

    return {
      staticBuffers,
      dynamicBuffers,
      streamBuffers,
      totalBuffers: totalSize,
      averageBufferSize:
        this.tracker.buffers.size > 0
          ? totalSize / this.tracker.buffers.size
          : 0,
      largestBuffer,
      bufferCount: this.tracker.buffers.size,
      usage,
    };
  }

  private analyzeTextureUsage(): TextureMemoryUsage {
    let totalMemory = 0;
    let largestTexture = 0;
    const formats: TextureMemoryUsage['textureFormats'] = {};
    const usage: TextureMemoryUsage['usage'] = {};

    for (const [texture, info] of this.tracker.textures) {
      totalMemory += info.size;
      largestTexture = Math.max(largestTexture, info.size);

      const formatName = this.getFormatName(info.format);
      if (!formats[formatName]) {
        formats[formatName] = { count: 0, totalSize: 0 };
      }
      formats[formatName].count++;
      formats[formatName].totalSize += info.size;

      usage[info.id] = {
        width: info.width,
        height: info.height,
        format: formatName,
        size: info.size,
        lastUsed: info.lastUsed,
      };
    }

    return {
      totalTextureMemory: totalMemory,
      activeTextures: this.tracker.textures.size,
      largestTexture,
      textureFormats: formats,
      compressionRatio: 1.0, // Simplified - would need actual compression analysis
      usage,
    };
  }

  private analyzeShaderUsage(): ShaderMemoryUsage {
    let totalMemory = 0;
    const programs: ShaderMemoryUsage['programs'] = {};

    for (const [program, info] of this.tracker.programs) {
      const estimatedSize = this.estimateProgramSize(info);
      totalMemory += estimatedSize;

      programs[info.id] = {
        vertexShader: '', // Simplified
        fragmentShader: '', // Simplified
        uniformCount: info.uniformCount,
        attributeCount: info.attributeCount,
      };
    }

    return {
      programCount: this.tracker.programs.size,
      compiledShaders: this.tracker.programs.size * 2, // Vertex + Fragment
      totalShaderMemory: totalMemory,
      programs,
    };
  }

  private analyzeTotalUsage(): TotalMemoryUsage {
    const systemMemory = this.getSystemMemoryUsage();
    const estimatedGPU = this.tracker.totalAllocated;
    const efficiency =
      this.tracker.peakUsage > 0
        ? this.tracker.totalAllocated / this.tracker.peakUsage
        : 1;

    // Simplified memory pressure calculation
    let memoryPressure: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (estimatedGPU > 256 * 1024 * 1024) memoryPressure = 'critical';
    else if (estimatedGPU > 128 * 1024 * 1024) memoryPressure = 'high';
    else if (estimatedGPU > 64 * 1024 * 1024) memoryPressure = 'medium';

    return {
      estimatedGPUMemory: estimatedGPU,
      systemMemoryUsed: systemMemory,
      memoryEfficiency: efficiency,
      fragmentationLevel: 0.1, // Simplified
      availableMemory: Math.max(0, 512 * 1024 * 1024 - estimatedGPU), // Assume 512MB budget
      memoryPressure,
    };
  }

  private getSystemMemoryUsage(): number {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0;
  }

  private getFormatName(format: number): string {
    if (!this.gl) return 'unknown';

    switch (format) {
      case this.gl.RGB:
        return 'RGB';
      case this.gl.RGBA:
        return 'RGBA';
      case this.gl.ALPHA:
        return 'ALPHA';
      case this.gl.LUMINANCE:
        return 'LUMINANCE';
      case this.gl.LUMINANCE_ALPHA:
        return 'LUMINANCE_ALPHA';
      default:
        return 'unknown';
    }
  }

  private generateRecommendations(
    buffers: BufferMemoryUsage,
    textures: TextureMemoryUsage,
    shaders: ShaderMemoryUsage,
    total: TotalMemoryUsage
  ): MemoryOptimizationRecommendations {
    const recommendations: MemoryOptimizationRecommendations = {
      priority:
        total.memoryPressure === 'critical'
          ? 'critical'
          : total.memoryPressure === 'high'
            ? 'high'
            : 'medium',
      bufferOptimizations: [],
      textureOptimizations: [],
      shaderOptimizations: [],
      systemOptimizations: [],
      memoryBudget: {
        totalBudget: 256, // MB
        vertexBuffers: 64,
        indexBuffers: 32,
        textures: 128,
        shaders: 16,
        overhead: 8,
        emergency: 8,
      },
    };

    // Buffer optimizations
    if (buffers.largestBuffer > 10 * 1024 * 1024) {
      // 10MB
      recommendations.bufferOptimizations.push(
        'Large buffer detected - consider buffer streaming'
      );
    }

    if (buffers.dynamicBuffers > buffers.staticBuffers) {
      recommendations.bufferOptimizations.push(
        'High dynamic buffer usage - consider buffer pooling'
      );
    }

    // Texture optimizations
    if (textures.largestTexture > 16 * 1024 * 1024) {
      // 16MB
      recommendations.textureOptimizations.push(
        'Large texture detected - consider compression or tiling'
      );
    }

    if (textures.activeTextures > 32) {
      recommendations.textureOptimizations.push(
        'High texture count - implement texture atlasing'
      );
    }

    // Shader optimizations
    if (shaders.programCount > 10) {
      recommendations.shaderOptimizations.push(
        'High shader program count - consider uber-shaders'
      );
    }

    // System optimizations
    if (total.memoryPressure !== 'low') {
      recommendations.systemOptimizations.push(
        'Implement automatic quality reduction'
      );
      recommendations.systemOptimizations.push(
        'Add memory usage monitoring and alerts'
      );
    }

    return recommendations;
  }

  public stopTracking(): void {
    if (!this.gl || !this.isTracking) return;

    // Restore original methods
    this.gl.createBuffer = this.originalMethods.createBuffer;
    this.gl.deleteBuffer = this.originalMethods.deleteBuffer;
    this.gl.bufferData = this.originalMethods.bufferData;
    this.gl.createTexture = this.originalMethods.createTexture;
    this.gl.deleteTexture = this.originalMethods.deleteTexture;
    this.gl.texImage2D = this.originalMethods.texImage2D;
    this.gl.createProgram = this.originalMethods.createProgram;
    this.gl.deleteProgram = this.originalMethods.deleteProgram;
    this.gl.linkProgram = this.originalMethods.linkProgram;

    this.isTracking = false;
  }

  public getTracker(): WebGLResourceTracker {
    return this.tracker;
  }

  public dispose(): void {
    this.stopTracking();
    this.tracker.buffers.clear();
    this.tracker.textures.clear();
    this.tracker.programs.clear();
    this.tracker.allocationHistory = [];
  }
}
