# React DevTools and Dynamic Import Production Fixes

## Problem Diagnosed (2025-09-07)

### Issue 1: React DevTools DisplayName Error

- **Error**: "Cannot read properties of undefined (reading 'displayName') at getDisplayNameForFiber"
- **Root Cause**: Lazy-loaded components don't have explicit displayName properties
- **Impact**: React DevTools crashes in production, making debugging difficult

### Issue 2: Dynamic Import Failures (404s)

- **Error**: "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of text/html"
- **Root Cause**: Production server returns 404 HTML pages instead of JavaScript chunks
- **Impact**: Components fail to load, showing blank pages

## Solutions Implemented

### 1. Added displayName to Components

- **Files**: TermsOfService.tsx, PrivacyPolicy.tsx, Documentation.tsx
- **Fix**: Added explicit `ComponentName.displayName = 'ComponentName'` before export
- **Result**: React DevTools can properly identify components

### 2. Enhanced Vite Configuration

- **File**: vite.config.ts
- **Added**: Explicit chunk file naming patterns for consistent asset paths:
  ```typescript
  chunkFileNames: 'assets/[name]-[hash].js',
  entryFileNames: 'assets/[name]-[hash].js',
  assetFileNames: 'assets/[name]-[hash].[ext]'
  ```

### 3. Created LazyComponentWrapper

- **File**: src/components/LazyComponentWrapper.tsx
- **Features**:
  - Automatic displayName setting for all lazy components
  - Built-in error recovery with fallback UI
  - Better error logging for debugging
  - Consistent loading patterns

### 4. Updated App.tsx Lazy Loading

- **Change**: Replaced `React.lazy()` with `createLazyComponent()`
- **Benefits**:
  - Automatic error handling for chunk loading failures
  - Consistent displayName setting
  - Better user experience with error recovery

## Key Code Patterns

### Enhanced Lazy Component Creation

```typescript
const ComponentName = createLazyComponent(
  () => import('./path/to/Component'),
  'ComponentName'
);
```

### Manual displayName Setting (fallback)

```typescript
const ComponentName = () => {
  /* component code */
};
ComponentName.displayName = 'ComponentName';
export default ComponentName;
```

## Production Checklist

Before deployment, ensure:

- [ ] All lazy components have displayName set
- [ ] Vite build uses consistent asset naming
- [ ] Error boundaries handle chunk loading failures
- [ ] Nginx serves assets with correct MIME types
- [ ] Test lazy loading in production build locally

## Testing Commands

```bash
# Build and test production bundle
npm run build
npm run preview

# Check for chunk loading issues
curl -I https://spherosegapp.utia.cas.cz/assets/[chunk-name].js

# Verify React DevTools compatibility
# Open browser DevTools → Components tab → Check for displayName errors
```

## Related Issues Prevention

- Always set displayName for React components used with lazy loading
- Use consistent asset naming in Vite configuration
- Implement error boundaries around Suspense components
- Test production builds before deployment
- Monitor browser console for dynamic import errors

## Performance Impact

- Minimal: displayName adds negligible overhead
- Positive: Better error recovery reduces failed page loads
- Positive: Consistent chunk naming improves cache hit rates
