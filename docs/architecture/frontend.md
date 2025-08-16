# Frontend Architecture

The frontend is a modern React application built with TypeScript and Vite, providing an intuitive interface for cell segmentation analysis.

## Technology Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite (fast HMR, modern bundling)
- **UI Framework**: shadcn/ui components built on Radix UI
- **Styling**: Tailwind CSS utility-first framework
- **State Management**: React Query for server state, React Context for client state
- **Routing**: React Router v6
- **Form Handling**: React Hook Form with Zod validation
- **HTTP Client**: Axios with JWT interceptors

## Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── ui/              # shadcn/ui base components  
│   ├── upload/          # File upload components
│   ├── project/         # Project-specific components
│   ├── settings/        # Settings page components
│   └── segmentation/    # Basic segmentation components
├── contexts/            # React contexts for global state
│   ├── AuthContext.tsx     # User authentication state
│   ├── ThemeContext.tsx    # Dark/light theme state
│   └── LanguageContext.tsx # i18n language state
├── hooks/              # Custom React hooks
│   ├── useDashboardProjects.ts
│   ├── useProjectData.tsx
│   └── useProjectForm.tsx
├── lib/                # Utility libraries
│   ├── api.ts          # Axios HTTP client
│   ├── segmentation.ts # Segmentation utilities
│   └── utils.ts        # General utilities
├── pages/              # Route components
│   ├── segmentation/   # Complex segmentation editor
│   ├── Dashboard.tsx
│   ├── ProjectDetail.tsx
│   ├── Profile.tsx
│   └── Settings.tsx
├── shared/             # Shared types and utilities
└── types/              # TypeScript type definitions
```

## Component Architecture

### Core Components Hierarchy

```
App.tsx
├── AuthContext.Provider
├── ThemeContext.Provider  
├── LanguageContext.Provider
├── QueryClient.Provider
└── Router
    ├── ProtectedRoute
    │   ├── Dashboard
    │   ├── ProjectDetail
    │   ├── SegmentationEditor (complex)
    │   ├── Profile
    │   └── Settings
    └── Public Routes
        ├── Login
        ├── Register
        └── RequestAccess
```

### Segmentation Editor Architecture

The segmentation editor is the most complex part of the application, located in `/src/pages/segmentation/`:

```
SegmentationEditor.tsx (orchestrator)
├── hooks/
│   ├── useSegmentationCore.tsx     # Data fetching & state
│   ├── useSegmentationView.tsx     # Zoom & pan functionality
│   ├── useSegmentationEditor.tsx   # Main editor logic
│   ├── usePolygonInteraction.tsx   # Polygon editing
│   └── useSegmentationHistory.tsx  # Undo/redo system
├── components/
│   ├── canvas/          # Canvas rendering system
│   ├── toolbar/         # Editor tools & controls  
│   ├── sidebar/         # Properties & settings
│   └── dialogs/         # Modal dialogs
└── contexts/
    └── SegmentationContext.tsx     # Segmentation state
```

## State Management

### Server State (React Query)
```typescript
// Project data fetching with caching
const { data: projects, isLoading } = useQuery({
  queryKey: ['projects'],
  queryFn: () => apiClient.getProjects(),
  staleTime: 5 * 60 * 1000, // 5 minutes
});

// Mutations with optimistic updates
const createProjectMutation = useMutation({
  mutationFn: apiClient.createProject,
  onSuccess: () => {
    queryClient.invalidateQueries(['projects']);
  },
});
```

### Client State (React Context)
```typescript
// Authentication state with safe default
const AuthContext = createContext<{
  user: User | null;
  login: (credentials: LoginData) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
} | undefined>(undefined);

// Theme state with safe default
const ThemeContext = createContext<{
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
} | undefined>(undefined);

// Typed getter hooks that throw clear errors if context is undefined
const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
```

## Advanced Features

### Complex Polygon Editing System

The segmentation editor includes sophisticated polygon manipulation:

```typescript
// Vertex drag system with coordinate transformation
const useVertexDrag = (zoom, offset, segmentation, setSegmentation) => {
  const handleVertexDrag = useCallback((e, containerElement) => {
    // Get container bounding rectangle for coordinate transformation
    const rect = containerElement.getBoundingClientRect();
    
    // Transform screen coordinates to image coordinates
    const x = (e.clientX - rect.left) / zoom - offset.x;
    const y = (e.clientY - rect.top) / zoom - offset.y;
    
    // Update polygon vertex position
    setSegmentation(prevSegmentation => ({
      ...prevSegmentation,
      polygons: prevSegmentation.polygons.map(polygon => 
        polygon.id === selectedPolygonId 
          ? { ...polygon, points: updateVertexAt(polygon.points, vertexIndex, {x, y}) }
          : polygon
      )
    }));
  }, [zoom, offset, selectedPolygonId, vertexIndex]);
};
```

### Canvas Rendering System

Custom canvas system for high-performance polygon rendering:

```typescript
// Canvas rendering with zoom and pan
const CanvasRenderer = ({ image, polygons, zoom, offset }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply zoom and pan transforms
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(offset.x, offset.y);
    
    // Render image
    ctx.drawImage(image, 0, 0);
    
    // Render polygons
    polygons.forEach(polygon => renderPolygon(ctx, polygon));
    
    ctx.restore();
  }, [image, polygons, zoom, offset]);
  
  return <canvas ref={canvasRef} />;
};
```

### History Management (Undo/Redo)

Sophisticated undo/redo system for segmentation editing:

```typescript
const useSegmentationHistory = (segmentation, setSegmentation) => {
  const [history, setHistory] = useState<SegmentationState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const addToHistory = useCallback((state: SegmentationState) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(state);
      return newHistory.slice(-MAX_HISTORY_SIZE);
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);
  
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const previousState = history[historyIndex - 1];
      setSegmentation(previousState);
      setHistoryIndex(prev => prev - 1);
    }
  }, [history, historyIndex, setSegmentation]);
};
```

## HTTP Client Configuration

Custom Axios client with JWT handling:

```typescript
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30000,
});

// Request interceptor for JWT tokens
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      try {
        await refreshAccessToken();
        // Retry original request
        return apiClient(error.config);
      } catch (refreshError) {
        // Redirect to login
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
```

## Performance Optimizations

### Code Splitting
```typescript
// Lazy loading of routes
const SegmentationEditor = lazy(() => import('./pages/segmentation/SegmentationEditor'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));

// Route-based code splitting
const AppRoutes = () => (
  <Suspense fallback={<LoadingSpinner />}>
    <Routes>
      <Route path="/project/:id/segmentation/:imageId" element={<SegmentationEditor />} />
      <Route path="/project/:id" element={<ProjectDetail />} />
    </Routes>
  </Suspense>
);
```

### React Query Optimizations
```typescript
// Efficient caching strategies
const useProjectData = (projectId: string) => {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient.getProject(projectId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
    refetchOnWindowFocus: false,
  });
};

// Background prefetching
const prefetchProject = (projectId: string) => {
  queryClient.prefetchQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient.getProject(projectId),
  });
};
```

### Image Optimization
```typescript
// Lazy image loading with thumbnails
const OptimizedImage = ({ src, thumbnail, alt }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [inView, ref] = useInView({ threshold: 0.1 });
  
  return (
    <div ref={ref}>
      {inView && (
        <>
          {!imageLoaded && <img src={thumbnail} alt={alt} className="blur-sm" />}
          <img 
            src={src}
            alt={alt}
            onLoad={() => setImageLoaded(true)}
            className={imageLoaded ? 'opacity-100' : 'opacity-0'}
          />
        </>
      )}
    </div>
  );
};
```

## Component Patterns

### Compound Components
```typescript
// Flexible component composition
const ImageUploader = {
  Root: UploaderRoot,
  DropZone: DropZone,
  FileList: FileList,
  Options: UploaderOptions,
};

// Usage
<ImageUploader.Root>
  <ImageUploader.Options />
  <ImageUploader.DropZone />
  <ImageUploader.FileList />
</ImageUploader.Root>
```

### Hook Composition
```typescript
// Composable editor functionality
const useSegmentationEditor = (projectId, imageId, userId) => {
  const core = useSegmentationCore(projectId, imageId, userId);
  const view = useSegmentationView(core.canvasContainerRef, core.imageSrc);
  const interaction = usePolygonInteraction(/* ... */);
  const history = useSegmentationHistory(/* ... */);
  
  return {
    ...core,
    ...view,
    ...interaction,
    ...history,
  };
};
```

## Testing Strategy

### Component Testing
```typescript
// React Testing Library with user events
describe('ImageUploader', () => {
  test('uploads files and triggers segmentation', async () => {
    const mockFiles = [new File(['content'], 'test.png', { type: 'image/png' })];
    
    render(<ImageUploader projectId="test-id" />);
    
    const dropzone = screen.getByTestId('dropzone');
    await user.upload(dropzone, mockFiles);
    
    expect(screen.getByText('Uploading...')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText('Upload complete')).toBeInTheDocument();
    });
  });
});
```

### Hook Testing
```typescript
// Custom hook testing
describe('useSegmentationEditor', () => {
  test('handles vertex dragging', () => {
    const { result } = renderHook(() => 
      useSegmentationEditor('project-1', 'image-1', 'user-1')
    );
    
    act(() => {
      result.current.handleVertexClick(100, 100, mockElement);
    });
    
    expect(result.current.vertexDragState.current.isDragging).toBe(true);
  });
});
```

## Build Configuration

### Vite Configuration
```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-toast'],
          routing: ['react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 8082,
    host: true,
  },
});
```

The frontend architecture provides a solid foundation for complex image editing workflows while maintaining excellent performance and user experience.