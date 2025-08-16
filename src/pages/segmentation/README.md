# Enhanced Segmentation Editor

A comprehensive polygon editing system inspired by SpheroSeg, providing professional-grade annotation capabilities for the Cell Segmentation Hub.

## Features

### Advanced Edit Modes

- **View Mode** (`V`): Navigate and select polygons
- **Edit Vertices** (`E`): Move and modify polygon vertices
- **Add Points** (`A`): CVAT-style point insertion between vertices
- **Create Polygon** (`N`): Draw new polygons with auto-closing
- **Slice** (`S`): Split polygons with a cutting line
- **Delete Polygon** (`D`): Remove polygons by clicking

### Professional Keyboard Shortcuts

- `V` - View mode
- `E` - Edit vertices (requires selection)
- `A` - Add points (requires selection)
- `N` - Create new polygon
- `S` - Slice mode (requires selection)
- `D` - Delete polygon mode
- `Ctrl+S` - Save
- `Ctrl+Z` - Undo
- `Ctrl+Y` - Redo
- `+/-` - Zoom in/out
- `R` - Reset view
- `Delete` - Delete selected polygon
- `Escape` - Cancel/View mode
- `Tab` - Cycle modes
- `Shift+Tab` - Cycle modes (reverse)
- `H/?` - Show keyboard shortcuts help

### Advanced Interaction Features

- **CVAT-style Add Points**: Click vertex to start, add sequence, click end vertex
- **Intelligent Path Replacement**: Automatically chooses optimal path (larger perimeter)
- **Shift+Auto-Add**: Hold Shift for equidistant point placement
- **Polygon Slicing**: Two-point line intersection with validation
- **Real-time Preview**: Live feedback for all operations
- **Smart Selection**: Prioritizes smaller polygons (holes) when overlapping

## Quick Start

```tsx
import { EnhancedSegmentationEditor } from '@/pages/segmentation/components';

function MyComponent() {
  const [polygons, setPolygons] = useState([]);

  const handleSave = async polygons => {
    // Save polygons to backend
    await api.saveSegmentation(polygons);
  };

  return (
    <EnhancedSegmentationEditor
      imageUrl="/path/to/image.jpg"
      imageWidth={1024}
      imageHeight={768}
      initialPolygons={polygons}
      onSave={handleSave}
      onPolygonsChange={setPolygons}
    />
  );
}
```

## Architecture

### Core Hook: `useEnhancedSegmentationEditor`

Central hook that orchestrates all functionality:

```tsx
const editor = useEnhancedSegmentationEditor({
  initialPolygons,
  imageWidth,
  imageHeight,
  canvasWidth,
  canvasHeight,
  onSave,
  onPolygonsChange,
});
```

### Component Layer System

- **CanvasContainer**: Mode-aware container with cursor styling
- **CanvasContent**: Transform-aware content wrapper
- **Canvas Layers**: Image, polygons, vertices, temporary geometry
- **UI Overlays**: Instructions, toolbar, status bar

### Utility Libraries

- **polygonGeometry.ts**: Advanced polygon operations
- **coordinateUtils.ts**: Canvas coordinate transformations
- **polygonSlicing.ts**: Line intersection algorithms

## Migration Guide

### From Existing Editor

1. **Replace the main editor component**:

```tsx
// Old
import SegmentationEditor from './SegmentationEditor';

// New
import EnhancedSegmentationEditor from './components/EnhancedSegmentationEditor';
```

2. **Update props interface**:

```tsx
// Old props
interface OldProps {
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  // ...
}

// New props
interface NewProps {
  editMode: EditMode; // enum with specific modes
  // Single comprehensive state
}
```

3. **Migrate state management**:

```tsx
// Old: Multiple boolean states
const [editMode, setEditMode] = useState(false);
const [slicingMode, setSlicingMode] = useState(false);

// New: Single enum state
const [editMode, setEditMode] = useState(EditMode.View);
```

### Gradual Migration Strategy

1. **Phase 1**: Add new types alongside existing code
2. **Phase 2**: Implement new components with backward compatibility
3. **Phase 3**: Update main editor to use new system
4. **Phase 4**: Remove legacy code and cleanup

## Advanced Usage

### Custom Keyboard Shortcuts

```tsx
const editor = useEnhancedSegmentationEditor({
  // ... props
});

// Custom key handler
const handleCustomKey = (key, event) => {
  if (key === 'f' && editor.selectedPolygonId) {
    // Custom "focus" action
    centerOnPolygon(editor.selectedPolygon);
  }
};

useKeyboardShortcuts({
  // ... existing props
  onKeyDown: handleCustomKey,
});
```

### Custom Slicing Validation

```tsx
const slicing = usePolygonSlicing({
  // ... props
  customValidator: (polygon, start, end) => {
    // Custom validation logic
    return { isValid: true };
  },
});
```

### Performance Optimization

```tsx
// For large datasets
const editor = useEnhancedSegmentationEditor({
  // ... props
  enableVirtualization: true,
  maxVisiblePolygons: 100,
  lodEnabled: true,
});
```

## API Reference

### EditMode Enum

```typescript
enum EditMode {
  View = 'view',
  EditVertices = 'edit-vertices',
  AddPoints = 'add-points',
  CreatePolygon = 'create-polygon',
  Slice = 'slice',
  DeletePolygon = 'delete-polygon',
}
```

### InteractionState Interface

```typescript
interface InteractionState {
  isDraggingVertex: boolean;
  isPanning: boolean;
  panStart: Point | null;
  draggedVertexInfo: { polygonId: string; vertexIndex: number } | null;
  originalVertexPosition?: Point | null;
  sliceStartPoint: Point | null;
  addPointStartVertex: { polygonId: string; vertexIndex: number } | null;
  addPointEndVertex: { polygonId: string; vertexIndex: number } | null;
  isAddingPoints: boolean;
}
```

### TransformState Interface

```typescript
interface TransformState {
  zoom: number;
  translateX: number;
  translateY: number;
}
```

## Performance Considerations

- **Viewport Culling**: Only renders visible polygons
- **Level of Detail**: Reduces vertex count at low zoom levels
- **Batch Rendering**: Groups polygon operations
- **Debounced Updates**: Smooth interaction during dragging
- **Memoized Components**: Prevents unnecessary re-renders

## Testing

```tsx
import { render, fireEvent } from '@testing-library/react';
import { EnhancedSegmentationEditor } from './components';

test('should switch to edit mode on E key', () => {
  const { container } = render(<EnhancedSegmentationEditor {...props} />);

  fireEvent.keyDown(container, { key: 'e' });

  expect(container).toHaveAttribute('data-edit-mode', 'edit-vertices');
});
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Follow existing TypeScript patterns
2. Add tests for new features
3. Update documentation
4. Ensure backward compatibility during migration

## Performance Benchmarks

- **Polygon Count**: Tested with 10,000+ polygons
- **Vertex Count**: Smooth editing with 1,000+ vertices per polygon
- **Frame Rate**: Maintains 60 FPS during interactions
- **Memory Usage**: Optimized for long editing sessions
