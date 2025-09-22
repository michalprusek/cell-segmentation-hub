/**
 * Vertex Performance Analysis Runner Script
 * Executes comprehensive performance analysis and generates reports
 */

import { runVertexPerformanceAnalysis } from '../lib/performance/vertexPerformanceTestRunner';
import { runCrossBrowserPerformanceAnalysis } from '../lib/performance/browserPerformanceAnalyzer';
import { WebGLMemoryAnalyzer } from '../lib/performance/webglMemoryAnalyzer';
import * as fs from 'fs';

interface AnalysisOptions {
  includeStressTests?: boolean;
  includeMemoryAnalysis?: boolean;
  includeBrowserAnalysis?: boolean;
  outputFormat?: 'json' | 'html' | 'console';
  saveToFile?: boolean;
  filename?: string;
}

export async function runPerformanceAnalysis(options: AnalysisOptions = {}) {
  const {
    includeStressTests = true,
    includeMemoryAnalysis = true,
    includeBrowserAnalysis = true,
    outputFormat = 'console',
    saveToFile = false,
    filename = 'vertex-performance-report',
  } = options;

  console.log('🚀 Starting Comprehensive Vertex Performance Analysis...\n');

  try {
    // 1. Run comprehensive performance analysis
    console.log('📊 Running vertex performance profiling...');
    const performanceReport = await runVertexPerformanceAnalysis();

    // 2. Browser capability analysis
    let browserAnalysis = null;
    if (includeBrowserAnalysis) {
      console.log('🌐 Analyzing browser capabilities...');
      browserAnalysis = await runCrossBrowserPerformanceAnalysis();
    }

    // 3. Memory analysis
    let memoryProfile = null;
    if (includeMemoryAnalysis) {
      console.log('💾 Analyzing WebGL memory usage...');
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');

      if (gl) {
        const memoryAnalyzer = new WebGLMemoryAnalyzer();
        memoryAnalyzer.initializeTracking(gl);

        // Simulate some WebGL operations for memory analysis
        await simulateWebGLOperations(gl, memoryAnalyzer);

        memoryProfile = memoryAnalyzer.analyzeMemoryUsage();
        memoryAnalyzer.dispose();
      }
    }

    // 4. Generate consolidated report
    const consolidatedReport = {
      timestamp: new Date().toISOString(),
      performance: performanceReport,
      browser: browserAnalysis,
      memory: memoryProfile,
      summary: generateSummary(
        performanceReport,
        browserAnalysis,
        memoryProfile
      ),
    };

    // 5. Output results
    switch (outputFormat) {
      case 'json':
        outputJSON(consolidatedReport, saveToFile, filename);
        break;
      case 'html':
        outputHTML(consolidatedReport, saveToFile, filename);
        break;
      default:
        outputConsole(consolidatedReport);
    }

    console.log('\n✅ Performance analysis completed successfully!');
    return consolidatedReport;
  } catch (error) {
    console.error('❌ Performance analysis failed:', error);
    throw error;
  }
}

async function simulateWebGLOperations(
  gl: WebGLRenderingContext,
  analyzer: WebGLMemoryAnalyzer
) {
  // Create some buffers and textures to simulate real usage
  const vertexData = new Float32Array(10000); // 10k vertices
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

  // Create a texture
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const textureData = new Uint8Array(1024 * 1024 * 4); // 1024x1024 RGBA
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1024,
    1024,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    textureData
  );

  // Create a shader program
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();

  if (vertexShader && fragmentShader && program) {
    gl.shaderSource(
      vertexShader,
      `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `
    );
    gl.shaderSource(
      fragmentShader,
      `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    `
    );

    gl.compileShader(vertexShader);
    gl.compileShader(fragmentShader);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
  }

  // Cleanup
  setTimeout(() => {
    gl.deleteBuffer(buffer);
    gl.deleteTexture(texture);
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }, 1000);
}

function generateSummary(performance: any, browser: any, memory: any) {
  const summary = {
    overallPerformance: 'unknown',
    webglSupport: false,
    memoryEfficiency: 'unknown',
    recommendations: [] as string[],
    priority: 'medium',
  };

  if (performance) {
    const avgFPS = performance.vertexPerformance?.summary?.avgFPS || 0;
    if (avgFPS >= 60) summary.overallPerformance = 'excellent';
    else if (avgFPS >= 45) summary.overallPerformance = 'good';
    else if (avgFPS >= 30) summary.overallPerformance = 'acceptable';
    else summary.overallPerformance = 'poor';

    if (avgFPS < 30) {
      summary.recommendations.push(
        'WebGL implementation is critical for performance'
      );
      summary.priority = 'critical';
    } else if (avgFPS < 60) {
      summary.recommendations.push(
        'WebGL implementation recommended for smoother experience'
      );
      summary.priority = 'high';
    }
  }

  if (browser) {
    summary.webglSupport = browser.capabilities?.webgl || false;
    if (!summary.webglSupport) {
      summary.recommendations.push(
        'WebGL not supported - focus on Canvas optimization'
      );
    }
  }

  if (memory) {
    const memoryPressure = memory.total?.memoryPressure || 'unknown';
    summary.memoryEfficiency = memoryPressure;

    if (memoryPressure === 'high' || memoryPressure === 'critical') {
      summary.recommendations.push('Implement aggressive memory management');
    }
  }

  return summary;
}

function outputConsole(report: any) {
  console.log('\n📋 VERTEX PERFORMANCE ANALYSIS REPORT');
  console.log('=====================================');

  if (report.summary) {
    console.log('\n📊 SUMMARY');
    console.log('---------');
    console.log(
      `Overall Performance: ${report.summary.overallPerformance.toUpperCase()}`
    );
    console.log(`WebGL Support: ${report.summary.webglSupport ? 'YES' : 'NO'}`);
    console.log(
      `Memory Efficiency: ${report.summary.memoryEfficiency.toUpperCase()}`
    );
    console.log(
      `Implementation Priority: ${report.summary.priority.toUpperCase()}`
    );

    if (report.summary.recommendations.length > 0) {
      console.log('\n💡 RECOMMENDATIONS:');
      report.summary.recommendations.forEach((rec: string, i: number) => {
        console.log(`  ${i + 1}. ${rec}`);
      });
    }
  }

  if (report.performance) {
    console.log('\n⚡ PERFORMANCE METRICS');
    console.log('--------------------');
    const summary = report.performance.vertexPerformance?.summary;
    if (summary) {
      console.log(`Average FPS: ${summary.avgFPS?.toFixed(1) || 'N/A'}`);
      console.log(
        `Average Frame Time: ${summary.avgFrameTime?.toFixed(1) || 'N/A'}ms`
      );
      console.log(
        `95th Percentile Frame Time: ${summary.p95FrameTime?.toFixed(1) || 'N/A'}ms`
      );
      console.log(
        `Memory Usage: ${(summary.avgMemoryUsage / 1024 / 1024)?.toFixed(1) || 'N/A'}MB`
      );
    }
  }

  if (report.browser) {
    console.log('\n🌐 BROWSER CAPABILITIES');
    console.log('----------------------');
    const caps = report.browser.capabilities;
    console.log(`WebGL 1.0: ${caps?.webgl ? '✅' : '❌'}`);
    console.log(`WebGL 2.0: ${caps?.webgl2 ? '✅' : '❌'}`);
    console.log(`Max Texture Size: ${caps?.maxTextureSize || 'Unknown'}px`);
    console.log(
      `Max Vertex Attributes: ${caps?.maxVertexAttribs || 'Unknown'}`
    );

    if (caps?.gpu) {
      console.log(`GPU Vendor: ${caps.gpu.vendor || 'Unknown'}`);
      console.log(`GPU Renderer: ${caps.gpu.renderer || 'Unknown'}`);
    }
  }

  if (report.memory) {
    console.log('\n💾 MEMORY ANALYSIS');
    console.log('-----------------');
    const memory = report.memory;
    console.log(
      `GPU Memory: ${(memory.total?.estimatedGPUMemory / 1024 / 1024)?.toFixed(1) || 'N/A'}MB`
    );
    console.log(
      `System Memory: ${(memory.total?.systemMemoryUsed / 1024 / 1024)?.toFixed(1) || 'N/A'}MB`
    );
    console.log(
      `Memory Pressure: ${memory.total?.memoryPressure?.toUpperCase() || 'UNKNOWN'}`
    );
    console.log(`Buffer Count: ${memory.vertexBuffers?.bufferCount || 'N/A'}`);
    console.log(`Texture Count: ${memory.textures?.activeTextures || 'N/A'}`);
  }

  console.log('\n🎯 WEBGL IMPLEMENTATION TARGETS');
  console.log('-------------------------------');
  console.log('Minimum Performance: 1000 vertices @ 60 FPS');
  console.log('Target Performance: 5000 vertices @ 60 FPS');
  console.log('Maximum Performance: 10000 vertices @ 30 FPS');
  console.log('Memory Budget: 256MB WebGL memory');
  console.log('Frame Time Target: <16.67ms for interactions');
}

function outputJSON(report: any, saveToFile: boolean, filename: string) {
  const jsonOutput = JSON.stringify(report, null, 2);

  console.log('\n📄 JSON Report Generated');
  console.log(jsonOutput);

  if (saveToFile && typeof window === 'undefined') {
    // Node.js environment
    try {
      fs.writeFileSync(`${filename}.json`, jsonOutput);
      console.log(`💾 Report saved to ${filename}.json`);
    } catch (error) {
      console.warn('⚠️ Could not save file:', error);
    }
  } else if (saveToFile) {
    // Browser environment
    const blob = new Blob([jsonOutput], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('💾 Download initiated');
  }
}

function outputHTML(report: any, saveToFile: boolean, filename: string) {
  const htmlOutput = generateHTMLReport(report);

  console.log('\n📄 HTML Report Generated');

  if (saveToFile && typeof window === 'undefined') {
    // Node.js environment
    try {
      fs.writeFileSync(`${filename}.html`, htmlOutput);
      console.log(`💾 Report saved to ${filename}.html`);
    } catch (error) {
      console.warn('⚠️ Could not save file:', error);
    }
  } else if (saveToFile) {
    // Browser environment
    const blob = new Blob([htmlOutput], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.html`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('💾 Download initiated');
  }
}

function generateHTMLReport(report: any): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vertex Performance Analysis Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            border-radius: 8px;
            margin-bottom: 2rem;
        }
        .summary {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 8px;
            margin-bottom: 2rem;
            border-left: 4px solid #007bff;
        }
        .metric-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin: 1rem 0;
        }
        .metric-card {
            background: white;
            padding: 1rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-left: 4px solid #28a745;
        }
        .metric-value {
            font-size: 2rem;
            font-weight: bold;
            color: #007bff;
        }
        .metric-label {
            color: #6c757d;
            font-size: 0.9rem;
        }
        .status-excellent { border-left-color: #28a745; }
        .status-good { border-left-color: #ffc107; }
        .status-poor { border-left-color: #dc3545; }
        .recommendations {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 1rem;
            margin: 1rem 0;
        }
        .recommendations h3 {
            color: #856404;
            margin-top: 0;
        }
        .recommendations ul {
            margin: 0;
            padding-left: 1.5rem;
        }
        .section {
            margin: 2rem 0;
            padding: 1.5rem;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .json-data {
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.8rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Vertex Performance Analysis Report</h1>
        <p>Generated: ${report.timestamp}</p>
        <p>Comprehensive analysis of vertex rendering performance for WebGL implementation strategy</p>
    </div>

    ${
      report.summary
        ? `
    <div class="summary">
        <h2>📊 Executive Summary</h2>
        <div class="metric-grid">
            <div class="metric-card status-${report.summary.overallPerformance}">
                <div class="metric-value">${report.summary.overallPerformance.toUpperCase()}</div>
                <div class="metric-label">Overall Performance</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.webglSupport ? 'YES' : 'NO'}</div>
                <div class="metric-label">WebGL Support</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.priority.toUpperCase()}</div>
                <div class="metric-label">Implementation Priority</div>
            </div>
        </div>

        ${
          report.summary.recommendations.length > 0
            ? `
        <div class="recommendations">
            <h3>💡 Key Recommendations</h3>
            <ul>
                ${report.summary.recommendations.map((rec: string) => `<li>${rec}</li>`).join('')}
            </ul>
        </div>
        `
            : ''
        }
    </div>
    `
        : ''
    }

    <div class="section">
        <h2>📋 Complete Analysis Data</h2>
        <p>Detailed performance metrics, browser capabilities, and memory analysis:</p>
        <div class="json-data">
            <pre>${JSON.stringify(report, null, 2)}</pre>
        </div>
    </div>

    <div class="section">
        <h2>🎯 Next Steps</h2>
        <ol>
            <li><strong>Review Performance Metrics:</strong> Analyze current bottlenecks and degradation points</li>
            <li><strong>Implement WebGL Renderer:</strong> Focus on vertex buffer management and shader optimization</li>
            <li><strong>Set Up Performance Monitoring:</strong> Implement real-time performance tracking</li>
            <li><strong>Create Fallback Systems:</strong> Ensure graceful degradation for unsupported browsers</li>
            <li><strong>Test Across Devices:</strong> Validate performance on target hardware configurations</li>
        </ol>
    </div>
</body>
</html>
  `.trim();
}

// Export for use in other modules
export default runPerformanceAnalysis;

// CLI interface when run directly
if (typeof window === 'undefined' && require.main === module) {
  const args = process.argv.slice(2);
  const options: AnalysisOptions = {
    includeStressTests: !args.includes('--no-stress'),
    includeMemoryAnalysis: !args.includes('--no-memory'),
    includeBrowserAnalysis: !args.includes('--no-browser'),
    outputFormat: args.includes('--json')
      ? 'json'
      : args.includes('--html')
        ? 'html'
        : 'console',
    saveToFile: args.includes('--save'),
    filename:
      args.find(arg => arg.startsWith('--filename='))?.split('=')[1] ||
      'vertex-performance-report',
  };

  runPerformanceAnalysis(options).catch(console.error);
}
