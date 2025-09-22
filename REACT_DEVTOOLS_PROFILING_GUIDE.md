# React DevTools Profiling Guide for Vertex Performance

## Complete Guide to Profiling "hodně zasekané" (Very Laggy) Vertex Rendering

This guide provides specific React DevTools profiling techniques to identify and resolve vertex rendering performance issues.

## 1. React DevTools Setup for Vertex Profiling

### Installation and Configuration

```bash
# Install React DevTools browser extension
# Chrome: https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi
# Firefox: https://addons.mozilla.org/en-US/firefox/addon/react-devtools/

# Enable profiling in development build
REACT_APP_PROFILE=true npm start

# Or build profiling version
REACT_APP_PROFILE=true npm run build
```

### Enable Performance Profiling

```typescript
// Add to src/index.tsx for development profiling
if (process.env.NODE_ENV === 'development') {
  // Enable React's built-in profiler
  import('react-dom/profiling').then(ReactDOM => {
    // Use profiling version of ReactDOM
    console.log('React profiling enabled');
  });
}
```

## 2. Specific Profiling Scenarios for Vertex Issues

### Scenario 1: Vertex Hover Lag Detection

#### Setup Profile Session

1. Open React DevTools → **Profiler** tab
2. Click **Settings** gear icon
3. Enable **"Record why each component rendered"**
4. Enable **"Hide commits below threshold"** → Set to 1ms
5. Enable **"Highlight updates when components render"**

#### Profiling Steps

```typescript
// 1. Start profiling
// 2. Hover over vertices rapidly for 5 seconds
// 3. Stop profiling
// 4. Analyze flame graph for:
//    - CanvasVertex re-renders
//    - PolygonVertices updates
//    - useEnhancedSegmentationEditor state cascades
```

### Scenario 2: Vertex Drag Performance Analysis

#### Custom Profiling Markers

```typescript
// Add to CanvasVertex.tsx
const CanvasVertex = React.memo(({ ... }) => {
  // Start performance mark
  React.useLayoutEffect(() => {
    performance.mark('vertex-render-start');

    return () => {
      performance.mark('vertex-render-end');
      performance.measure('vertex-render', 'vertex-render-start', 'vertex-render-end');
    };
  });

  // ... component logic
});

// Add to useAdvancedInteractions.tsx
const handleMouseDown = useCallback((e: React.MouseEvent) => {
  performance.mark('vertex-drag-start');

  // Drag logic...

  performance.mark('vertex-drag-end');
  performance.measure('vertex-drag-cycle', 'vertex-drag-start', 'vertex-drag-end');
}, []);
```

#### Profiling Protocol

1. **Start React DevTools Profiler**
2. **Initiate vertex drag operation**
3. **Drag vertex for 3 seconds**
4. **Stop profiling**
5. **Check Performance tab** → User Timing for custom marks

### Scenario 3: State Update Cascade Analysis

#### Component Update Tracking

```typescript
// Add to useEnhancedSegmentationEditor.tsx
const usePerformanceLogger = (componentName: string) => {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());

  useEffect(() => {
    renderCount.current++;
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTime.current;

    if (timeSinceLastRender < 16) { // Less than 1 frame (60fps)
      console.warn(`${componentName} rendered too frequently:`, {
        renderCount: renderCount.current,
        timeSinceLastRender
      });
    }

    lastRenderTime.current = now;
  });
};

// Use in components
const CanvasVertex = React.memo(({ ... }) => {
  usePerformanceLogger('CanvasVertex');
  // ... component logic
});
```

## 3. React DevTools Profiling Patterns

### Pattern 1: Component Re-render Frequency Analysis

#### Identifying Excessive Re-renders

```typescript
// Look for these patterns in Profiler:
// 1. CanvasVertex appears multiple times in single commit
// 2. "Why did this render?" shows frequent prop changes
// 3. Flame graph shows deep component trees updating

// Common causes found in codebase:
const problematicPatterns = {
  // ❌ Problem: New objects created on every render
  dragOffset: isDragging ? { x: offset.x, y: offset.y } : undefined,

  // ✅ Solution: Memoize object creation
  dragOffset: useMemo(
    () => (isDragging ? { x: offset.x, y: offset.y } : undefined),
    [isDragging, offset.x, offset.y]
  ),
};
```

#### React DevTools Signals to Watch For

- **Red commits** in profiler timeline (expensive renders)
- **Yellow/Orange components** in flame graph (moderate cost)
- **"Props changed"** reasons pointing to unstable references
- **Cascading updates** where parent triggers child re-renders

### Pattern 2: Event Handler Performance Analysis

#### Detecting Event Handler Issues

```typescript
// Add to components with frequent events
const useEventPerformanceTracker = (eventName: string) => {
  const eventCount = useRef(0);
  const lastEventTime = useRef(performance.now());

  return useCallback((handler: Function) => {
    return (...args: any[]) => {
      const start = performance.now();
      eventCount.current++;

      handler(...args);

      const duration = performance.now() - start;
      const timeSinceLastEvent = start - lastEventTime.current;

      if (duration > 4) { // Event took longer than ~quarter frame
        console.warn(`Slow ${eventName} event:`, {
          duration: `${duration}ms`,
          eventCount: eventCount.current,
          timeSinceLastEvent: `${timeSinceLastEvent}ms`
        });
      }

      lastEventTime.current = start;
    };
  }, [eventName]);
};

// Usage in CanvasVertex
const CanvasVertex = React.memo(({ ... }) => {
  const trackMouseEvent = useEventPerformanceTracker('vertex-mouse');

  const handleMouseDown = trackMouseEvent(useCallback((e: React.MouseEvent) => {
    // Original mouse down logic
  }, [dependencies]));
});
```

### Pattern 3: State Management Bottleneck Detection

#### Profiling State Update Performance

```typescript
// Add to useEnhancedSegmentationEditor.tsx
const useStateUpdateProfiler = () => {
  const stateUpdates = useRef<Record<string, number>>({});

  const profileStateUpdate = useCallback(
    (stateName: string, updateFn: Function) => {
      return (...args: any[]) => {
        const start = performance.now();

        updateFn(...args);

        const duration = performance.now() - start;
        stateUpdates.current[stateName] =
          (stateUpdates.current[stateName] || 0) + duration;

        // Log every 100 updates
        if (
          Object.values(stateUpdates.current).reduce((a, b) => a + b, 0) % 100 <
          duration
        ) {
          console.table(stateUpdates.current);
        }
      };
    },
    []
  );

  return { profileStateUpdate };
};

// Usage
const { profileStateUpdate } = useStateUpdateProfiler();
const setHoveredVertex = profileStateUpdate(
  'hoveredVertex',
  setHoveredVertexOriginal
);
const setVertexDragState = profileStateUpdate(
  'vertexDragState',
  setVertexDragStateOriginal
);
```

## 4. Specific Performance Metrics to Track

### Key Performance Indicators (KPIs)

#### 1. **Vertex Render Frequency**

- **Target**: <60 renders/second per vertex
- **Current Issue**: Likely 200+ renders/second during hover
- **Measurement**: Use React DevTools Profiler render count

#### 2. **Event Handler Response Time**

- **Target**: <2ms per mouse event
- **Current Issue**: Console logging adds 10-50ms per event
- **Measurement**: Performance API timing

#### 3. **State Update Batching Efficiency**

- **Target**: Multiple state changes in single React update cycle
- **Current Issue**: Individual setState calls trigger separate renders
- **Measurement**: React DevTools commit frequency

#### 4. **Memory Usage During Vertex Operations**

- **Target**: Stable memory, no leaks during extended use
- **Current Issue**: Potential event listener leaks
- **Measurement**: Browser Memory tab + React DevTools

### Automated Performance Monitoring

#### Custom Performance Hook

```typescript
// Add to src/hooks/usePerformanceMonitor.ts
export const usePerformanceMonitor = (componentName: string, enabled = process.env.NODE_ENV === 'development') => {
  const metricsRef = useRef({
    renderCount: 0,
    totalRenderTime: 0,
    lastRenderTime: 0,
    slowRenders: 0
  });

  const startRender = useCallback(() => {
    if (!enabled) return null;
    return performance.now();
  }, [enabled]);

  const endRender = useCallback((startTime: number | null) => {
    if (!enabled || !startTime) return;

    const renderTime = performance.now() - startTime;
    const metrics = metricsRef.current;

    metrics.renderCount++;
    metrics.totalRenderTime += renderTime;
    metrics.lastRenderTime = renderTime;

    if (renderTime > 16) { // Slower than 60fps
      metrics.slowRenders++;
    }

    // Report every 50 renders
    if (metrics.renderCount % 50 === 0) {
      console.group(`${componentName} Performance Report`);
      console.log(`Average render time: ${(metrics.totalRenderTime / metrics.renderCount).toFixed(2)}ms`);
      console.log(`Slow renders: ${metrics.slowRenders}/${metrics.renderCount} (${(metrics.slowRenders / metrics.renderCount * 100).toFixed(1)}%)`);
      console.log(`Last render time: ${renderTime.toFixed(2)}ms`);
      console.groupEnd();
    }
  }, [enabled, componentName]);

  return { startRender, endRender, metrics: metricsRef.current };
};

// Usage in CanvasVertex
const CanvasVertex = React.memo(({ ... }) => {
  const { startRender, endRender } = usePerformanceMonitor('CanvasVertex');

  useLayoutEffect(() => {
    const start = startRender();
    return () => endRender(start);
  });

  // ... component logic
});
```

## 5. React DevTools Profiling Checklist

### Pre-Profiling Setup

- [ ] React DevTools extension installed and updated
- [ ] Development build with profiling enabled
- [ ] "Record why each component rendered" enabled
- [ ] "Highlight updates when components render" enabled
- [ ] Browser performance tab ready for timeline correlation

### During Profiling Session

- [ ] Clear previous profiling data
- [ ] Record specific user interaction (vertex hover, drag, etc.)
- [ ] Keep session short (5-10 seconds) for focused analysis
- [ ] Note specific lag moments during recording

### Post-Profiling Analysis

- [ ] Check flame graph for red/yellow components
- [ ] Identify components with frequent re-renders
- [ ] Analyze "why did this render" explanations
- [ ] Correlate with browser Performance tab timeline
- [ ] Document specific problem patterns found

## 6. Common Performance Anti-Patterns Found

### Anti-Pattern 1: Console Logging in Hot Paths

```typescript
// ❌ PERFORMANCE KILLER
const handleMouseDown = useCallback(
  (e: React.MouseEvent) => {
    console.log('🔘 Vertex mouseDown:', {
      polygonId,
      vertexIndex,
      target: e.currentTarget,
    });
    // This single line can add 10-50ms per event
  },
  [polygonId, vertexIndex]
);

// ✅ SOLUTION
const handleMouseDown = useCallback(
  (e: React.MouseEvent) => {
    if (process.env.NODE_ENV === 'development' && window.DEBUG_VERTEX_EVENTS) {
      console.log('🔘 Vertex mouseDown:', { polygonId, vertexIndex });
    }
    // Normal handler logic
  },
  [polygonId, vertexIndex]
);
```

### Anti-Pattern 2: Unstable Object References

```typescript
// ❌ NEW OBJECT EVERY RENDER
const vertexStyle = {
  cursor: isDragging ? 'grabbing' : 'grab',
  transition: isDragging ? 'none' : 'stroke-width 0.15s ease-out',
};

// ✅ MEMOIZED OBJECT
const vertexStyle = useMemo(
  () => ({
    cursor: isDragging ? 'grabbing' : 'grab',
    transition: isDragging ? 'none' : 'stroke-width 0.15s ease-out',
  }),
  [isDragging]
);
```

### Anti-Pattern 3: Non-Batched State Updates

```typescript
// ❌ MULTIPLE SEPARATE RENDERS
setVertexDragState({ isDragging: false, ... });
setInteractionState(prev => ({ ...prev, isDraggingVertex: false }));
setHoveredVertex(null);

// ✅ BATCHED UPDATES
import { unstable_batchedUpdates } from 'react-dom';

unstable_batchedUpdates(() => {
  setVertexDragState({ isDragging: false, ... });
  setInteractionState(prev => ({ ...prev, isDraggingVertex: false }));
  setHoveredVertex(null);
});
```

## 7. Performance Testing Protocol

### Automated Performance Testing

```typescript
// Add to src/test-utils/performanceHelpers.ts
export const measureVertexPerformance = async (testScenario: string) => {
  performance.mark(`${testScenario}-start`);

  // Simulate vertex interactions
  // ... test code

  performance.mark(`${testScenario}-end`);
  performance.measure(
    testScenario,
    `${testScenario}-start`,
    `${testScenario}-end`
  );

  const measures = performance.getEntriesByName(testScenario);
  const duration = measures[measures.length - 1].duration;

  // Assert performance requirements
  expect(duration).toBeLessThan(100); // Max 100ms for test scenario

  return duration;
};

// Usage in tests
test('vertex hover should be performant', async () => {
  const duration = await measureVertexPerformance('vertex-hover-test');
  console.log(`Vertex hover performance: ${duration}ms`);
});
```

### Manual Performance Testing Steps

1. **Baseline Measurement**: Profile initial load of segmentation editor
2. **Hover Test**: Rapid mouse movement over 20+ vertices for 10 seconds
3. **Drag Test**: Drag single vertex continuously for 5 seconds
4. **Multi-vertex Selection**: Select and hover multiple polygons rapidly
5. **Zoom Test**: Zoom in/out while hovering vertices
6. **Extended Session**: 5-minute session with continuous vertex interaction

## 8. Performance Regression Prevention

### CI/CD Performance Checks

```typescript
// Add to package.json scripts
{
  "test:performance": "jest --testPathPattern=performance",
  "profile:vertex": "npm start --profile --vertex-debug",
  "analyze:bundle": "npm run build && npx webpack-bundle-analyzer build/static/js/*.js"
}
```

### Performance Budget Enforcement

```typescript
// Add to .github/workflows/performance.yml
- name: Performance Budget Check
  run: |
    npm run build
    # Check if vertex-related bundles exceed size limits
    npx bundlesize --config bundlesize.config.json
```

### Continuous Performance Monitoring

```typescript
// Add performance metrics to existing logging
const logPerformanceMetrics = () => {
  const navigation = performance.getEntriesByType('navigation')[0];
  const paintEntries = performance.getEntriesByType('paint');

  console.log('Performance Metrics:', {
    domContentLoaded:
      navigation.domContentLoadedEventEnd -
      navigation.domContentLoadedEventStart,
    firstPaint: paintEntries.find(entry => entry.name === 'first-paint')
      ?.startTime,
    firstContentfulPaint: paintEntries.find(
      entry => entry.name === 'first-contentful-paint'
    )?.startTime,
  });
};
```

## 9. Expected Profiling Results After Optimization

### Before Optimization (Current State)

- **Vertex hover response**: 50-100ms delay
- **Re-render frequency**: 200+ renders/second during interaction
- **Console overhead**: 10-50ms per event
- **Memory usage**: Gradual increase during extended use

### After Phase 1 Fixes

- **Vertex hover response**: <5ms delay
- **Re-render frequency**: <60 renders/second
- **Console overhead**: Eliminated in production
- **Memory usage**: Stable during extended use

### Target Performance Metrics

- **First vertex render**: <10ms
- **Hover responsiveness**: <2ms
- **Drag smoothness**: 60fps sustained
- **Memory stability**: <5MB growth per hour of use

This comprehensive profiling guide should help identify and resolve the "hodně zasekané" (very laggy) vertex rendering issues through systematic React DevTools analysis.
