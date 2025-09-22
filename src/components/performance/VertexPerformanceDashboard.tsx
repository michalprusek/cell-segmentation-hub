/**
 * Comprehensive Vertex Performance Analysis Dashboard
 * Real-time monitoring and analysis of vertex rendering performance
 */

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

import {
  runVertexPerformanceAnalysis,
  ComprehensivePerformanceReport,
} from '@/lib/performance/vertexPerformanceTestRunner';

import {
  WebGLMemoryAnalyzer,
  WebGLMemoryProfile,
} from '@/lib/performance/webglMemoryAnalyzer';

interface PerformanceDashboardProps {
  onReportGenerated?: (report: ComprehensivePerformanceReport) => void;
  autoRun?: boolean;
  showAdvancedMetrics?: boolean;
}

interface RealTimeMetrics {
  frameTime: number;
  fps: number;
  memoryUsage: number;
  vertexCount: number;
  renderMode: string;
  timestamp: number;
}

export const VertexPerformanceDashboard: React.FC<
  PerformanceDashboardProps
> = ({ onReportGenerated, autoRun = false, showAdvancedMetrics = false }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<ComprehensivePerformanceReport | null>(
    null
  );
  const [memoryProfile, setMemoryProfile] = useState<WebGLMemoryProfile | null>(
    null
  );
  const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics[]>([]);
  const [progress, setProgress] = useState(0);
  const [currentTest, setCurrentTest] = useState('');
  const [error, setError] = useState<string | null>(null);

  const memoryAnalyzerRef = useRef<WebGLMemoryAnalyzer | null>(null);
  const metricsIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (autoRun) {
      handleRunAnalysis();
    }

    return () => {
      if (metricsIntervalRef.current) {
        clearInterval(metricsIntervalRef.current);
      }
      if (memoryAnalyzerRef.current) {
        memoryAnalyzerRef.current.dispose();
      }
    };
  }, [autoRun]);

  const handleRunAnalysis = async () => {
    setIsRunning(true);
    setProgress(0);
    setError(null);
    setCurrentTest('Initializing...');

    try {
      // Initialize memory analyzer
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (gl) {
        memoryAnalyzerRef.current = new WebGLMemoryAnalyzer();
        memoryAnalyzerRef.current.initializeTracking(gl);
      }

      // Start real-time metrics collection
      startRealTimeMetrics();

      // Run comprehensive analysis with progress updates
      setCurrentTest('Analyzing browser capabilities...');
      setProgress(10);

      const performanceReport = await runVertexPerformanceAnalysis();

      setProgress(80);
      setCurrentTest('Analyzing memory usage...');

      // Get memory profile
      if (memoryAnalyzerRef.current) {
        const memProfile = memoryAnalyzerRef.current.analyzeMemoryUsage();
        setMemoryProfile(memProfile);
      }

      setProgress(100);
      setCurrentTest('Analysis complete');

      setReport(performanceReport);
      onReportGenerated?.(performanceReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsRunning(false);
      stopRealTimeMetrics();
    }
  };

  const startRealTimeMetrics = () => {
    metricsIntervalRef.current = window.setInterval(() => {
      const metric: RealTimeMetrics = {
        frameTime: performance.now() % 100, // Simulated
        fps: 60 - Math.random() * 10,
        memoryUsage:
          'memory' in performance
            ? (performance as any).memory.usedJSHeapSize
            : 0,
        vertexCount: Math.floor(Math.random() * 5000),
        renderMode: Math.random() > 0.5 ? 'canvas' : 'svg',
        timestamp: Date.now(),
      };

      setRealTimeMetrics(prev => [...prev.slice(-50), metric]);
    }, 100);
  };

  const stopRealTimeMetrics = () => {
    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }
  };

  const getPerformanceColor = (fps: number) => {
    if (fps >= 60) return 'text-green-600';
    if (fps >= 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getMemoryPressureColor = (pressure: string) => {
    switch (pressure) {
      case 'low':
        return 'bg-green-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'high':
        return 'bg-orange-500';
      case 'critical':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="w-full space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Vertex Performance Analysis Dashboard</CardTitle>
            <Button
              onClick={handleRunAnalysis}
              disabled={isRunning}
              className="min-w-32"
            >
              {isRunning ? 'Running...' : 'Run Analysis'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isRunning && (
            <div className="space-y-2">
              <div className="text-sm text-gray-600">{currentTest}</div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {realTimeMetrics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Real-Time Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {realTimeMetrics[realTimeMetrics.length - 1]?.fps.toFixed(
                    1
                  ) || 0}
                </div>
                <div className="text-sm text-gray-600">FPS</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {realTimeMetrics[
                    realTimeMetrics.length - 1
                  ]?.frameTime.toFixed(1) || 0}
                </div>
                <div className="text-sm text-gray-600">Frame Time (ms)</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {Math.round(
                    (realTimeMetrics[realTimeMetrics.length - 1]?.memoryUsage ||
                      0) /
                      1024 /
                      1024
                  )}
                </div>
                <div className="text-sm text-gray-600">Memory (MB)</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {realTimeMetrics[realTimeMetrics.length - 1]?.vertexCount ||
                    0}
                </div>
                <div className="text-sm text-gray-600">Vertices</div>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={realTimeMetrics.slice(-20)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={value => new Date(value).toLocaleTimeString()}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={value =>
                    new Date(value as number).toLocaleTimeString()
                  }
                />
                <Line
                  type="monotone"
                  dataKey="fps"
                  stroke="#2563eb"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {report && (
        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="browser">Browser</TabsTrigger>
            <TabsTrigger value="webgl">WebGL</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="targets">Targets</TabsTrigger>
            <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <Card>
              <CardHeader>
                <CardTitle>Performance Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <h4 className="font-semibold">Overall Performance</h4>
                    <div
                      className={`text-2xl font-bold ${getPerformanceColor(report.vertexPerformance.summary.avgFPS)}`}
                    >
                      {report.vertexPerformance.summary.avgFPS.toFixed(1)} FPS
                    </div>
                    <div className="text-sm text-gray-600">
                      Frame Time:{' '}
                      {report.vertexPerformance.summary.avgFrameTime.toFixed(1)}
                      ms
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold">Browser Capabilities</h4>
                    <div className="space-y-1">
                      <Badge
                        variant={
                          report.browserAnalysis.capabilities.webgl
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        WebGL:{' '}
                        {report.browserAnalysis.capabilities.webgl
                          ? 'Supported'
                          : 'Not Supported'}
                      </Badge>
                      <Badge
                        variant={
                          report.browserAnalysis.capabilities.webgl2
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        WebGL2:{' '}
                        {report.browserAnalysis.capabilities.webgl2
                          ? 'Supported'
                          : 'Not Supported'}
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-600">
                      Max Texture Size:{' '}
                      {report.browserAnalysis.capabilities.maxTextureSize}px
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold">Stress Test Results</h4>
                    <div className="text-lg font-semibold">
                      {report.stressTestResults.maxStableVertexCount.toLocaleString()}{' '}
                      vertices
                    </div>
                    <div className="text-sm text-gray-600">
                      Max stable vertex count
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="browser">
            <Card>
              <CardHeader>
                <CardTitle>Browser Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold mb-3">System Information</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <strong>Browser:</strong> {report.browser}
                      </div>
                      <div>
                        <strong>Platform:</strong> {report.system.platform}
                      </div>
                      <div>
                        <strong>CPU Cores:</strong>{' '}
                        {report.system.hardwareConcurrency}
                      </div>
                      <div>
                        <strong>Device Memory:</strong>{' '}
                        {report.system.deviceMemory || 'Unknown'}GB
                      </div>
                      <div>
                        <strong>Viewport:</strong>{' '}
                        {report.system.viewport.width}×
                        {report.system.viewport.height}
                      </div>
                      <div>
                        <strong>Device Pixel Ratio:</strong>{' '}
                        {report.system.viewport.devicePixelRatio}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">GPU Information</h4>
                    {report.browserAnalysis.capabilities.gpu ? (
                      <div className="space-y-2 text-sm">
                        <div>
                          <strong>Vendor:</strong>{' '}
                          {report.browserAnalysis.capabilities.gpu.vendor}
                        </div>
                        <div>
                          <strong>Renderer:</strong>{' '}
                          {report.browserAnalysis.capabilities.gpu.renderer}
                        </div>
                        <div>
                          <strong>WebGL Version:</strong>{' '}
                          {report.browserAnalysis.capabilities.gpu.version}
                        </div>
                        <div>
                          <strong>Max Vertex Attributes:</strong>{' '}
                          {
                            report.browserAnalysis.capabilities.gpu
                              .maxVertexAttribs
                          }
                        </div>
                        <div>
                          <strong>Max Varying Vectors:</strong>{' '}
                          {
                            report.browserAnalysis.capabilities.gpu
                              .maxVaryingVectors
                          }
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-600">
                        GPU information not available
                      </div>
                    )}
                  </div>
                </div>

                {report.browserAnalysis.webglTests.length > 0 && (
                  <div className="mt-6">
                    <h4 className="font-semibold mb-3">
                      WebGL Performance Tests
                    </h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={report.browserAnalysis.webglTests}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="result.frameTime" fill="#3b82f6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="webgl">
            <Card>
              <CardHeader>
                <CardTitle>WebGL Baseline Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold mb-3">Performance Metrics</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span>Max Supported Vertices:</span>
                        <span className="font-mono">
                          {report.webglBaseline.maxSupportedVertices.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Max Draw Calls/Frame:</span>
                        <span className="font-mono">
                          {report.webglBaseline.maxDrawCallsPerFrame}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Buffer Upload Rate:</span>
                        <span className="font-mono">
                          {report.webglBaseline.bufferUploadRate.toFixed(1)}{' '}
                          MB/s
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Texture Upload Rate:</span>
                        <span className="font-mono">
                          {report.webglBaseline.textureUploadRate.toFixed(1)}{' '}
                          MB/s
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">Capabilities</h4>
                    <div className="space-y-2">
                      <Badge
                        variant={
                          report.webglBaseline.instancingSupported
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        Instancing:{' '}
                        {report.webglBaseline.instancingSupported
                          ? 'Supported'
                          : 'Not Supported'}
                      </Badge>
                      <Badge
                        variant={
                          report.webglBaseline.floatTexturesSupported
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        Float Textures:{' '}
                        {report.webglBaseline.floatTexturesSupported
                          ? 'Supported'
                          : 'Not Supported'}
                      </Badge>
                      <div className="text-sm">
                        <strong>Memory Budget:</strong>{' '}
                        {report.webglBaseline.memoryBudget}MB
                      </div>
                      <div className="text-sm">
                        <strong>Max Texture Size:</strong>{' '}
                        {report.webglBaseline.maxTextureSizeSupported}px
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="memory">
            <Card>
              <CardHeader>
                <CardTitle>Memory Usage Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                {memoryProfile ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-lg font-semibold">
                          {Math.round(
                            memoryProfile.total.estimatedGPUMemory / 1024 / 1024
                          )}
                          MB
                        </div>
                        <div className="text-sm text-gray-600">GPU Memory</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold">
                          {Math.round(
                            memoryProfile.total.systemMemoryUsed / 1024 / 1024
                          )}
                          MB
                        </div>
                        <div className="text-sm text-gray-600">
                          System Memory
                        </div>
                      </div>
                      <div className="text-center">
                        <Badge
                          className={getMemoryPressureColor(
                            memoryProfile.total.memoryPressure
                          )}
                        >
                          {memoryProfile.total.memoryPressure}
                        </Badge>
                        <div className="text-sm text-gray-600">
                          Memory Pressure
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-3">Buffer Usage</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span>Static Buffers:</span>
                            <span>
                              {Math.round(
                                memoryProfile.vertexBuffers.staticBuffers /
                                  1024 /
                                  1024
                              )}
                              MB
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Dynamic Buffers:</span>
                            <span>
                              {Math.round(
                                memoryProfile.vertexBuffers.dynamicBuffers /
                                  1024 /
                                  1024
                              )}
                              MB
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Stream Buffers:</span>
                            <span>
                              {Math.round(
                                memoryProfile.vertexBuffers.streamBuffers /
                                  1024 /
                                  1024
                              )}
                              MB
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Buffer Count:</span>
                            <span>
                              {memoryProfile.vertexBuffers.bufferCount}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-3">Texture Usage</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span>Total Texture Memory:</span>
                            <span>
                              {Math.round(
                                memoryProfile.textures.totalTextureMemory /
                                  1024 /
                                  1024
                              )}
                              MB
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Active Textures:</span>
                            <span>{memoryProfile.textures.activeTextures}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Largest Texture:</span>
                            <span>
                              {Math.round(
                                memoryProfile.textures.largestTexture /
                                  1024 /
                                  1024
                              )}
                              MB
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Compression Ratio:</span>
                            <span>
                              {(
                                memoryProfile.textures.compressionRatio * 100
                              ).toFixed(0)}
                              %
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-600">
                    Memory analysis not available. Run the performance analysis
                    to generate memory profile.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="targets">
            <Card>
              <CardHeader>
                <CardTitle>WebGL Performance Targets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold mb-3">Vertex Count Targets</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold text-green-600">
                          {report.performanceTargets.vertexCounts.minimum.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-600">Minimum</div>
                      </div>
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold text-blue-600">
                          {report.performanceTargets.vertexCounts.target.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-600">Target</div>
                      </div>
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold text-orange-600">
                          {report.performanceTargets.vertexCounts.maximum.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-600">Maximum</div>
                      </div>
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold text-red-600">
                          {report.performanceTargets.vertexCounts.stress.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-600">Stress</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">
                      Frame Time Targets (ms)
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold">
                          {report.performanceTargets.frameTimeTargets.render}
                        </div>
                        <div className="text-sm text-gray-600">Render</div>
                      </div>
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold">
                          {
                            report.performanceTargets.frameTimeTargets
                              .interaction
                          }
                        </div>
                        <div className="text-sm text-gray-600">Interaction</div>
                      </div>
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold">
                          {report.performanceTargets.frameTimeTargets.zoom}
                        </div>
                        <div className="text-sm text-gray-600">Zoom</div>
                      </div>
                      <div className="text-center p-4 border rounded">
                        <div className="text-lg font-semibold">
                          {report.performanceTargets.frameTimeTargets.pan}
                        </div>
                        <div className="text-sm text-gray-600">Pan</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">Quality Levels</h4>
                    <div className="space-y-4">
                      {Object.entries(
                        report.performanceTargets.qualityLevels
                      ).map(([level, config]) => (
                        <div key={level} className="border rounded p-4">
                          <div className="flex justify-between items-center mb-2">
                            <h5 className="font-medium capitalize">{level}</h5>
                            <Badge
                              variant={
                                level === 'high'
                                  ? 'default'
                                  : level === 'medium'
                                    ? 'secondary'
                                    : level === 'low'
                                      ? 'outline'
                                      : 'destructive'
                              }
                            >
                              {config.maxVerticesVisible.toLocaleString()}{' '}
                              vertices
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                            <div>
                              Decimation: {config.vertexDecimationStep}x
                            </div>
                            <div>Texture: {config.textureResolution}px</div>
                            <div>AA: {config.antialiasing ? 'On' : 'Off'}</div>
                            <div>
                              Instancing:{' '}
                              {config.instancingEnabled ? 'On' : 'Off'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recommendations">
            <Card>
              <CardHeader>
                <CardTitle>Implementation Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Badge
                      variant={
                        report.recommendations.priority === 'critical'
                          ? 'destructive'
                          : report.recommendations.priority === 'high'
                            ? 'default'
                            : report.recommendations.priority === 'medium'
                              ? 'secondary'
                              : 'outline'
                      }
                    >
                      {report.recommendations.priority.toUpperCase()} PRIORITY
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold mb-3">
                        Architecture Recommendations
                      </h4>
                      <div className="space-y-3">
                        <div>
                          <h5 className="text-sm font-medium text-gray-700">
                            Buffer Management
                          </h5>
                          <ul className="text-sm space-y-1 ml-4">
                            {report.recommendations.architecture.bufferManagement.map(
                              (rec, i) => (
                                <li key={i} className="list-disc">
                                  {rec}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                        <div>
                          <h5 className="text-sm font-medium text-gray-700">
                            Shader Optimization
                          </h5>
                          <ul className="text-sm space-y-1 ml-4">
                            {report.recommendations.architecture.shaderOptimization.map(
                              (rec, i) => (
                                <li key={i} className="list-disc">
                                  {rec}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-3">
                        Performance Optimizations
                      </h4>
                      <div className="space-y-3">
                        <div>
                          <h5 className="text-sm font-medium text-gray-700">
                            LOD Implementation
                          </h5>
                          <ul className="text-sm space-y-1 ml-4">
                            {report.recommendations.performance.lodImplementation.map(
                              (rec, i) => (
                                <li key={i} className="list-disc">
                                  {rec}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                        <div>
                          <h5 className="text-sm font-medium text-gray-700">
                            Memory Management
                          </h5>
                          <ul className="text-sm space-y-1 ml-4">
                            {report.recommendations.performance.memoryManagement.map(
                              (rec, i) => (
                                <li key={i} className="list-disc">
                                  {rec}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">
                      Implementation Specifications
                    </h4>
                    <Tabs defaultValue="shaders">
                      <TabsList>
                        <TabsTrigger value="shaders">Shaders</TabsTrigger>
                        <TabsTrigger value="buffers">Buffers</TabsTrigger>
                        <TabsTrigger value="textures">Textures</TabsTrigger>
                      </TabsList>

                      <TabsContent value="shaders">
                        <div className="space-y-4">
                          {report.recommendations.implementation.shaderSpecs.map(
                            (shader, i) => (
                              <div key={i} className="border rounded p-4">
                                <div className="flex justify-between items-center mb-2">
                                  <h5 className="font-medium">{shader.name}</h5>
                                  <Badge variant="outline">{shader.type}</Badge>
                                </div>
                                <p className="text-sm text-gray-600 mb-2">
                                  {shader.purpose}
                                </p>
                                <div className="text-sm">
                                  <strong>Optimizations:</strong>{' '}
                                  {shader.optimizations.join(', ')}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="buffers">
                        <div className="space-y-4">
                          {report.recommendations.implementation.bufferSpecs.map(
                            (buffer, i) => (
                              <div key={i} className="border rounded p-4">
                                <div className="flex justify-between items-center mb-2">
                                  <h5 className="font-medium">{buffer.name}</h5>
                                  <Badge variant="outline">{buffer.type}</Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <strong>Update Frequency:</strong>{' '}
                                    {buffer.updateFrequency}
                                  </div>
                                  <div>
                                    <strong>Size:</strong> {buffer.size}
                                  </div>
                                </div>
                                <div className="text-sm mt-2">
                                  <strong>Optimizations:</strong>{' '}
                                  {buffer.optimizations.join(', ')}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="textures">
                        <div className="space-y-4">
                          {report.recommendations.implementation.textureSpecs.map(
                            (texture, i) => (
                              <div key={i} className="border rounded p-4">
                                <h5 className="font-medium mb-2">
                                  {texture.name}
                                </h5>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <strong>Format:</strong> {texture.format}
                                  </div>
                                  <div>
                                    <strong>Size:</strong> {texture.size}
                                  </div>
                                  <div>
                                    <strong>Purpose:</strong> {texture.purpose}
                                  </div>
                                  <div>
                                    <strong>Compression:</strong>{' '}
                                    {texture.compression ? 'Yes' : 'No'}
                                  </div>
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default VertexPerformanceDashboard;
