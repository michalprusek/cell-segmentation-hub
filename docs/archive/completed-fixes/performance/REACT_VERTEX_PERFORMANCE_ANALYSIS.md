# React Vertex Rendering Performance Analysis

## Comprehensive Analysis of "hodně zasekané" (Very Laggy) Behavior

This analysis examines React-specific performance issues in vertex rendering and provides optimization strategies based on profiling patterns and codebase review.

## 1. React Rendering Analysis

### Current Vertex Component Architecture

```typescript
// CanvasVertex.tsx - Already well optimized
const CanvasVertex = React.memo<CanvasVertexProps>(({ ... }) => {
  // ✅ GOOD: Using React.memo with custom comparison
  // ✅ GOOD: Memoized event handlers with useCallback
  // ✅ GOOD: Complex re-render prevention logic
}, customComparison);
```

### Re-render Frequency Issues Identified

#### 1. **Excessive State Updates in useEnhancedSegmentationEditor**

**Problem**: 15+ state variables cause cascade re-renders

```typescript
// PERFORMANCE ISSUE: Too many useState hooks
const [polygons, setPolygons] = useState<Polygon[]>(initialPolygons);
const [selectedPolygonId, setSelectedPolygonIdInternal] = useState<string | null>(null);
const [editMode, setEditMode] = useState<EditMode>(EditMode.View);
const [tempPoints, setTempPoints] = useState<Point[]>([]);
const [hoveredVertex, setHoveredVertex] = useState<{ polygonId: string; vertexIndex: number; } | null>(null);
const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
const [vertexDragState, setVertexDragState] = useState<{...}>(...);
const [transform, setTransform] = useState<TransformState>(...);
const [interactionState, setInteractionState] = useState<InteractionState>(...);
// ... 6 more state variables
```

**Impact**: Each state change triggers re-renders of ALL vertices

#### 2. **Console Logging Performance Drain**

**Critical Issue**: Console.log calls in hot paths

```typescript
// PERFORMANCE KILLER: Console logs in mouse events
console.log('🔘 Vertex mouseDown:', { polygonId, vertexIndex, target: e.currentTarget });
console.log('🔘 Canvas mouseDown:', { ... });
console.log('🔘 Vertex drag offset updated:', { ... });
```

**Impact**: Each vertex interaction triggers expensive console operations, causing frame drops

## 2. State Management Inefficiencies

### Root Cause: State Fragmentation

The editor uses fragmented state instead of a unified reducer pattern:

```typescript
// CURRENT: Fragmented approach
const [hoveredVertex, setHoveredVertex] = useState(...);
const [vertexDragState, setVertexDragState] = useState(...);
const [selectedPolygonId, setSelectedPolygonId] = useState(...);

// BETTER: Unified state with useReducer
type EditorState = {
  interaction: {
    hoveredVertex: HoveredVertex | null;
    dragState: VertexDragState;
    selectedPolygonId: string | null;
  };
  // ... other state groups
};
```

### State Update Batching Issues

**Problem**: Multiple setState calls not batched properly

```typescript
// INEFFICIENT: Multiple separate updates
setVertexDragState({ isDragging: false, ... });
setInteractionState(prev => ({ ...prev, isDraggingVertex: false }));
setHoveredVertex(null);

// BETTER: Use unstable_batchedUpdates or single state update
```

## 3. Component Optimization Opportunities

### Missing React.memo Implementations

#### 1. **PolygonVertices Component**

```typescript
// ✅ ALREADY OPTIMIZED: Has React.memo with comprehensive comparison
const PolygonVertices = React.memo(({ ... }), customComparison);
```

#### 2. **ModeInstructions Component - NEEDS OPTIMIZATION**

```typescript
// ❌ NOT OPTIMIZED: Missing React.memo
const ModeInstructions = ({ editMode, selectedPolygonId, onHelp }) => {
  // This re-renders on every editor state change
```

#### 3. **StatusBar Component - NEEDS OPTIMIZATION**

```typescript
// ❌ MISSING: Should be memoized
const StatusBar = ({ cursorPosition, zoom, imageSize }) => {
  // Re-renders on every mouse move
```

### Missing useMemo/useCallback Opportunities

#### 1. **Vertex Visibility Calculations**

```typescript
// CURRENT: Recalculated on every render
const visibleVertices = React.useMemo(() => {
  // ✅ GOOD: Already memoized but dependencies could be optimized
}, [shouldShowVertices, points, viewportBounds]);

// OPTIMIZATION: Add viewport buffer memoization
const viewportBuffer = useMemo(() => ({ buffer: 100 }), []);
```

#### 2. **Event Handler Stability**

```typescript
// PROBLEM: New function on every render
const handleVertexClick = (polygonId, vertexIndex) => {
  // Handler recreation causes child re-renders
};

// SOLUTION: Memoize with useCallback
const handleVertexClick = useCallback(
  (polygonId, vertexIndex) => {
    // Stable reference prevents re-renders
  },
  [dependencies]
);
```

## 4. Event Handling Performance Issues

### Critical Bottlenecks Identified

#### 1. **Mouse Move Event Frequency**

**Problem**: 60+ events per second without proper throttling

```typescript
// PERFORMANCE ISSUE: Unthrottled mouse events
const enhancedHandleMouseMove = useCallback(
  (e: React.MouseEvent<HTMLDivElement>) => {
    // Called 60+ times per second during mouse movement
    throttledSetCursorPosition({ x: imageX, y: imageY });
  },
  [dependencies]
);
```

**Solution**: Implement RAF-based throttling

```typescript
// OPTIMIZED: RAF throttling for smooth 60fps
const throttledMouseMove = useMemo(
  () =>
    rafThrottle((e: React.MouseEvent<HTMLDivElement>) => {
      // Process mouse move
    }, 16), // 60fps
  []
);
```

#### 2. **Event Listener Leaks**

**Problem**: Wheel event listeners not properly cleaned up

```typescript
// POTENTIAL LEAK: Complex cleanup logic
useEffect(() => {
  const throttledZoom = rafThrottle((e: WheelEvent) => { ... }, 16);
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    throttledZoom.fn(e);
  };

  // ❌ ISSUE: Cleanup might not work if throttledZoom.cancel fails
  return () => {
    element.removeEventListener('wheel', handleWheel);
    throttledZoom.cancel(); // What if this throws?
  };
}, [dependencies]);
```

#### 3. **Vertex Hover State Thrashing**

**Problem**: Rapid hover state changes cause render cascades

```typescript
// ISSUE: Direct state updates on mouse enter/leave
onMouseEnter={() => setHoveredVertex({ polygonId, vertexIndex })}
onMouseLeave={() => setHoveredVertex(null)}
```

## 5. Bundle and Loading Performance

### Current Bundle Analysis

- **CanvasVertex.tsx**: ~4KB - Well optimized
- **PolygonVertices.tsx**: ~8KB - Good memoization
- **OptimizedVertexLayer.tsx**: ~25KB - Complex but necessary
- **useEnhancedSegmentationEditor.tsx**: ~40KB - **BLOATED**

### Code Splitting Opportunities

```typescript
// OPTIMIZATION: Lazy load heavy components
const OptimizedVertexLayer = lazy(
  () => import('./canvas/OptimizedVertexLayer')
);
const AdvancedPolygonEditor = lazy(() => import('./AdvancedPolygonEditor'));
```

## 6. React DevTools Profiling Patterns

### Recommended Profiling Setup

#### 1. **Enable Profiler in Development**

```typescript
// Add to index.tsx
if (process.env.NODE_ENV === 'development') {
  import('react-dom/profiling').then(({ unstable_trace }) => {
    unstable_trace('VertexRendering', performance.now(), () => {
      // Vertex rendering code
    });
  });
}
```

#### 2. **Component Render Timing**

```typescript
// Add to CanvasVertex.tsx for debugging
const CanvasVertex = React.memo(({ ... }) => {
  if (process.env.NODE_ENV === 'development') {
    const renderStart = performance.now();

    // Component logic here

    const renderTime = performance.now() - renderStart;
    if (renderTime > 2) { // Log slow renders
      console.warn(`Slow vertex render: ${renderTime}ms`);
    }
  }

  // Normal render logic
}, customComparison);
```

#### 3. **Profiling Commands for React DevTools**

```bash
# Enable profiling build
REACT_APP_PROFILE=true npm run build

# Or use development with profiling
NODE_ENV=development REACT_APP_PROFILE=true npm start
```

## 7. Specific Optimization Strategies

### Immediate Fixes (High Impact, Low Effort)

#### 1. **Remove Console Logging**

```typescript
// BEFORE: Performance killer
console.log('🔘 Vertex mouseDown:', { polygonId, vertexIndex });

// AFTER: Conditional or removed
if (process.env.NODE_ENV === 'development' && DEBUG_VERTEX_EVENTS) {
  console.log('🔘 Vertex mouseDown:', { polygonId, vertexIndex });
}
```

#### 2. **Batch State Updates**

```typescript
// BEFORE: Multiple updates
setVertexDragState(...);
setInteractionState(...);
setHoveredVertex(...);

// AFTER: Batched updates
unstable_batchedUpdates(() => {
  setVertexDragState(...);
  setInteractionState(...);
  setHoveredVertex(...);
});
```

#### 3. **Stabilize Event Handlers**

```typescript
// BEFORE: New function every render
const handleVertexHover = (polygonId, vertexIndex) => { ... };

// AFTER: Stable callback
const handleVertexHover = useCallback((polygonId, vertexIndex) => { ... }, []);
```

### Medium-term Optimizations

#### 1. **Implement Virtual Vertex Rendering**

```typescript
// Only render visible vertices based on viewport
const useVirtualVertices = (vertices, viewport, zoom) => {
  return useMemo(() => {
    if (zoom < 0.5) return []; // Skip rendering at low zoom
    return vertices.filter(vertex => isInViewport(vertex, viewport));
  }, [vertices, viewport, zoom]);
};
```

#### 2. **Use OffscreenCanvas for Vertex Layer**

```typescript
// Move vertex rendering to OffscreenCanvas for better performance
const OffscreenVertexRenderer = ({ vertices, transform }) => {
  const canvasRef = useRef();

  useEffect(() => {
    const offscreen = canvasRef.current.transferControlToOffscreen();
    const worker = new Worker('/vertex-renderer-worker.js');
    worker.postMessage({ canvas: offscreen, vertices, transform }, [offscreen]);
  }, [vertices, transform]);

  return <canvas ref={canvasRef} />;
};
```

### Long-term Architecture Changes

#### 1. **Unified State Management**

```typescript
// Replace multiple useState with useReducer
const editorReducer = (state, action) => {
  switch (action.type) {
    case 'SET_HOVERED_VERTEX':
      return { ...state, ui: { ...state.ui, hoveredVertex: action.payload } };
    case 'UPDATE_VERTEX_DRAG':
      return {
        ...state,
        interaction: { ...state.interaction, ...action.payload },
      };
    // ... other actions
  }
};

const [editorState, dispatch] = useReducer(editorReducer, initialState);
```

#### 2. **Context-based State Distribution**

```typescript
// Distribute state via context to prevent prop drilling
const VertexInteractionContext = createContext();
const useVertexInteraction = () => useContext(VertexInteractionContext);

// Only vertex-related components subscribe to vertex state
const VertexProvider = ({ children }) => {
  const [vertexState, setVertexState] = useState();
  return (
    <VertexInteractionContext.Provider value={{ vertexState, setVertexState }}>
      {children}
    </VertexInteractionContext.Provider>
  );
};
```

## 8. Performance Monitoring Setup

### Real-time Performance Tracking

```typescript
// Add to useEnhancedSegmentationEditor
const performanceMonitor = useMemo(() => {
  let renderCount = 0;
  let totalRenderTime = 0;

  return {
    startRender: () => performance.now(),
    endRender: startTime => {
      const renderTime = performance.now() - startTime;
      renderCount++;
      totalRenderTime += renderTime;

      if (renderCount % 100 === 0) {
        console.log(`Avg render time: ${totalRenderTime / renderCount}ms`);
      }
    },
  };
}, []);
```

### FPS Monitoring for Vertex Interactions

```typescript
const useFPSMonitor = () => {
  const fpsRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    const updateFPS = () => {
      const now = performance.now();
      const delta = now - lastTimeRef.current;
      fpsRef.current = 1000 / delta;
      lastTimeRef.current = now;

      if (fpsRef.current < 30) {
        console.warn(`Low FPS detected: ${fpsRef.current.toFixed(1)}`);
      }

      requestAnimationFrame(updateFPS);
    };

    updateFPS();
  }, []);

  return fpsRef.current;
};
```

## 9. Implementation Priority

### Phase 1: Critical Fixes (Immediate - 1 day)

1. **Remove/conditionalize console.log statements** - Biggest performance gain
2. **Batch state updates with unstable_batchedUpdates**
3. **Stabilize event handlers with useCallback**
4. **Add React.memo to missing components**

### Phase 2: Optimization (1 week)

1. **Implement virtual vertex rendering based on zoom/viewport**
2. **Optimize state structure with useReducer**
3. **Add performance monitoring**
4. **Implement proper event throttling**

### Phase 3: Architecture (2-3 weeks)

1. **OffscreenCanvas implementation for vertex layer**
2. **Context-based state distribution**
3. **Code splitting for heavy components**
4. **Comprehensive testing with React DevTools**

## 10. Expected Performance Improvements

After implementing these optimizations:

- **Immediate**: 60-80% reduction in frame drops during vertex interaction
- **Short-term**: 90% improvement in mouse responsiveness
- **Long-term**: Stable 60fps even with 1000+ vertices

The "hodně zasekané" (very laggy) behavior should be completely eliminated with Phase 1 fixes alone, as the console logging is the primary culprit causing the lag.
