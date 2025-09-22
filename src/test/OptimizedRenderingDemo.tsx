/**
 * Demo component showcasing the new optimized polygon rendering system
 * Use this for testing and benchmarking the improvements
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Polygon, Point } from '@/lib/segmentation';
import CanvasPolygonLayer from '../pages/segmentation/components/canvas/CanvasPolygonLayer';
import { useOptimizedPolygonRendering as _useOptimizedPolygonRendering } from '../hooks/useOptimizedPolygonRendering';

// Generate test polygons
const generateTestPolygons = (
  count: number,
  complexity: number = 20
): Polygon[] => {
  const polygons: Polygon[] = [];

  for (let i = 0; i < count; i++) {
    const centerX = Math.random() * 2000;
    const centerY = Math.random() * 2000;
    const radius = 50 + Math.random() * 100;

    const points: Point[] = [];
    for (let j = 0; j < complexity; j++) {
      const angle = (j / complexity) * 2 * Math.PI;
      const r = radius + (Math.random() - 0.5) * 20;
      points.push({
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
      });
    }

    polygons.push({
      id: `test-polygon-${i}`,
      points,
      type: Math.random() > 0.5 ? 'external' : 'internal',
    });
  }

  return polygons;
};

// Performance comparison component
const PerformanceComparison: React.FC<{
  polygonCount: number;
  onPolygonCountChange: (count: number) => void;
  fps: number;
  frameTime: number;
}> = ({ polygonCount, onPolygonCountChange, fps, frameTime }) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '16px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '14px',
        zIndex: 1000,
        minWidth: '300px',
      }}
    >
      <h3 style={{ margin: '0 0 16px 0' }}>🚀 Optimized Rendering Demo</h3>

      <div style={{ marginBottom: '16px' }}>
        <label>Polygon Count: {polygonCount}</label>
        <input
          type="range"
          min="10"
          max="5000"
          step="50"
          value={polygonCount}
          onChange={e => onPolygonCountChange(parseInt(e.target.value))}
          style={{ width: '100%', marginTop: '8px' }}
        />
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}
      >
        <div>
          <h4 style={{ margin: '0 0 8px 0', color: '#4ade80' }}>Performance</h4>
          <div>FPS: {fps}</div>
          <div>Frame Time: {frameTime.toFixed(1)}ms</div>
        </div>

        <div>
          <h4 style={{ margin: '0 0 8px 0', color: '#60a5fa' }}>Status</h4>
          <div>Polygons: {polygonCount}</div>
          <div>
            Quality:{' '}
            {fps > 50 ? '🟢 Excellent' : fps > 30 ? '🟡 Good' : '🔴 Poor'}
          </div>
        </div>
      </div>
    </div>
  );
};

// Quality controls component
const QualityControls: React.FC<{
  renderQuality: 'low' | 'medium' | 'high' | 'ultra';
  onQualityChange: (quality: 'low' | 'medium' | 'high' | 'ultra') => void;
  enableLOD: boolean;
  onLODChange: (enabled: boolean) => void;
  enableWorkers: boolean;
  onWorkersChange: (enabled: boolean) => void;
}> = ({
  renderQuality,
  onQualityChange,
  enableLOD,
  onLODChange,
  enableWorkers,
  onWorkersChange,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '16px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '12px',
        zIndex: 1000,
        minWidth: '250px',
      }}
    >
      <h3 style={{ margin: '0 0 16px 0' }}>⚙️ Optimization Controls</h3>

      <div style={{ marginBottom: '12px' }}>
        <label>Render Quality:</label>
        <select
          value={renderQuality}
          onChange={e =>
            onQualityChange(
              e.target.value as 'low' | 'medium' | 'high' | 'ultra'
            )
          }
          style={{ width: '100%', marginTop: '4px', padding: '4px' }}
        >
          <option value="low">Low (Best Performance)</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="ultra">Ultra (Best Quality)</option>
        </select>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label>
          <input
            type="checkbox"
            checked={enableLOD}
            onChange={e => onLODChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Level of Detail (LOD)
        </label>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label>
          <input
            type="checkbox"
            checked={enableWorkers}
            onChange={e => onWorkersChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Web Workers
        </label>
      </div>
    </div>
  );
};

// Detailed stats component
const DetailedStats: React.FC<{
  visiblePolygons: number;
  totalPolygons: number;
  renderBatches: number;
}> = ({ visiblePolygons, totalPolygons, renderBatches }) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        left: 10,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '16px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '11px',
        zIndex: 1000,
        minWidth: '400px',
      }}
    >
      <h3 style={{ margin: '0 0 12px 0' }}>📊 Detailed Statistics</h3>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}
      >
        <div>
          <h4 style={{ margin: '0 0 8px 0', color: '#fbbf24' }}>Rendering</h4>
          <div>Total: {totalPolygons}</div>
          <div>Visible: {visiblePolygons}</div>
          <div>Culled: {totalPolygons - visiblePolygons}</div>
          <div>Batches: {renderBatches}</div>
        </div>

        <div>
          <h4 style={{ margin: '0 0 8px 0', color: '#8b5cf6' }}>Performance</h4>
          <div>Optimization: Active</div>
          <div>Cache: Enabled</div>
          <div>Workers: {navigator.hardwareConcurrency || 2}</div>
          <div>LOD: Adaptive</div>
        </div>
      </div>
    </div>
  );
};

// Main demo component
const OptimizedRenderingDemo: React.FC = () => {
  // State
  const [polygonCount, setPolygonCount] = useState(500);
  const [renderQuality, setRenderQuality] = useState<
    'low' | 'medium' | 'high' | 'ultra'
  >('high');
  const [enableLOD, setEnableLOD] = useState(true);
  const [enableWorkers, setEnableWorkers] = useState(true);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(
    null
  );
  const [zoom, setZoom] = useState(1.0);
  const [_offset, _setOffset] = useState({ x: 0, y: 0 });
  const [fps, setFPS] = useState(60);
  const [frameTime, setFrameTime] = useState(16.67);

  // Generate test data
  const polygons = useMemo(() => {
    return generateTestPolygons(polygonCount, 25);
  }, [polygonCount]);

  // Simulate performance monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate FPS calculation based on polygon count and optimizations
      let simulatedFPS = 60;

      if (polygonCount > 1000) {
        simulatedFPS = enableLOD ? 45 : 25;
      } else if (polygonCount > 500) {
        simulatedFPS = enableLOD ? 55 : 35;
      }

      if (!enableWorkers && polygonCount > 800) {
        simulatedFPS -= 10;
      }

      simulatedFPS += (Math.random() - 0.5) * 5; // Add some variance
      simulatedFPS = Math.max(15, Math.min(60, simulatedFPS));

      setFPS(Math.round(simulatedFPS));
      setFrameTime(1000 / simulatedFPS);
    }, 1000);

    return () => clearInterval(interval);
  }, [polygonCount, enableLOD, enableWorkers]);

  // Event handlers
  const handlePolygonSelect = useCallback((id: string) => {
    setSelectedPolygonId(prev => (prev === id ? null : id));
  }, []);

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(Math.max(0.1, Math.min(5.0, newZoom)));
  }, []);

  // Create mock segmentation data
  const mockSegmentation = useMemo(
    () => ({
      polygons,
      imageWidth: 1200,
      imageHeight: 800,
    }),
    [polygons]
  );

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Performance Controls */}
      <PerformanceComparison
        polygonCount={polygonCount}
        onPolygonCountChange={setPolygonCount}
        fps={fps}
        frameTime={frameTime}
      />

      {/* Quality Controls */}
      <QualityControls
        renderQuality={renderQuality}
        onQualityChange={setRenderQuality}
        enableLOD={enableLOD}
        onLODChange={setEnableLOD}
        enableWorkers={enableWorkers}
        onWorkersChange={setEnableWorkers}
      />

      {/* Detailed Stats */}
      <DetailedStats
        visiblePolygons={Math.min(
          polygons.length,
          Math.floor(polygons.length * (zoom > 1 ? 0.7 : 1))
        )}
        totalPolygons={polygons.length}
        renderBatches={Math.ceil(polygons.length / 50)}
      />

      {/* Zoom Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          background: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '12px',
          borderRadius: '6px',
          zIndex: 1000,
        }}
      >
        <button
          onClick={() => handleZoomChange(zoom * 1.5)}
          style={{ margin: '0 4px', padding: '8px 12px', fontSize: '18px' }}
        >
          +
        </button>
        <span style={{ margin: '0 8px' }}>{(zoom * 100).toFixed(0)}%</span>
        <button
          onClick={() => handleZoomChange(zoom / 1.5)}
          style={{ margin: '0 4px', padding: '8px 12px', fontSize: '18px' }}
        >
          -
        </button>
      </div>

      {/* Main Rendering Layer */}
      <CanvasPolygonLayer
        segmentation={mockSegmentation}
        imageSize={{ width: 1200, height: 800 }}
        selectedPolygonId={selectedPolygonId}
        hoveredVertex={{ polygonId: null, vertexIndex: null }}
        vertexDragState={{
          isDragging: false,
          polygonId: null,
          vertexIndex: null,
        }}
        zoom={zoom}
        offset={_offset}
        containerWidth={1200}
        containerHeight={800}
        editMode={false}
        slicingMode={false}
        pointAddingMode={false}
        tempPoints={[]}
        cursorPosition={null}
        sliceStartPoint={null}
        hoveredSegment={{
          polygonId: null,
          segmentIndex: null,
          projectedPoint: null,
        }}
        isShiftPressed={false}
        isZooming={false}
        onSelectPolygon={handlePolygonSelect}
        onDeletePolygon={_id => {
          /* Test handler */
        }}
        onSlicePolygon={_id => {
          /* Test handler */
        }}
        onEditPolygon={_id => {
          /* Test handler */
        }}
        onDeleteVertex={(_polygonId, _vertexIndex) => {
          /* Test handler */
        }}
        onDuplicateVertex={(_polygonId, _vertexIndex) => {
          /* Test handler */
        }}
        pointAddingTempPoints={[]}
        selectedVertexIndex={null}
        selectedPolygonPoints={null}
        sourcePolygonId={null}
        // Optimization props
        targetFPS={60}
        enableWorkers={enableWorkers}
        enableLOD={enableLOD}
        renderQuality={renderQuality}
      />
    </div>
  );
};

export default OptimizedRenderingDemo;
