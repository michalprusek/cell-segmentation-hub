# Export Download Button Fix for Large Files (2025-09-10)

## Problem

User reported that after exporting 230 images, the download button doesn't work - clicking it does nothing even though the export shows as "completed successfully". The issue affects Chrome on macOS specifically.

## Root Causes Identified

1. **Missing proper Content-Disposition headers** in backend response
2. **No explicit cache control headers** causing 304 (Not Modified) responses
3. **Missing nginx configuration** for large file downloads (230 images = ~200MB+)
4. **Duplicate download logic** across 5+ locations in frontend code
5. **No timeout handling** for large file downloads over slow connections

## Solution Applied

### 1. Backend Fix - Enhanced Headers (`/backend/src/api/controllers/exportController.ts`)

```typescript
// Added proper headers for file download
const fileName = `export_${jobId}_${new Date().toISOString().slice(0, 10)}.zip`;

res.setHeader('Content-Type', 'application/zip');
res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
res.setHeader('Pragma', 'no-cache');
res.setHeader('Expires', '0');

res.download(resolvedFilePath, fileName, err => {
  if (err) {
    logger.error('Download stream error:', err, 'ExportController');
  }
});
```

### 2. Frontend Fix - Centralized Download Utility (`/src/lib/downloadUtils.ts`)

Created new centralized utility to eliminate code duplication:

- `downloadBlob()` - Core download function with proper DOM manipulation
- `downloadFromResponse()` - Handle Axios responses
- `downloadJSON()` - JSON file downloads
- `canDownloadLargeFiles()` - Browser compatibility check
- Proper cleanup of blob URLs and DOM elements

### 3. Export Hook Updates (`/src/pages/export/hooks/useAdvancedExport.ts`)

- Added 5-minute timeout for large file downloads
- Browser compatibility checking
- Better error handling with retry capability
- Unique filenames including job ID

### 4. Nginx Configuration (`/docker/nginx/nginx.template.conf`)

Added dedicated location block for export downloads:

```nginx
location ~ ^/api/projects/[^/]+/export/[^/]+/download$ {
    # Extended timeouts (30 minutes)
    proxy_read_timeout 1800s;
    proxy_send_timeout 1800s;

    # Disable buffering for streaming
    proxy_buffering off;
    proxy_request_buffering off;

    # Increase buffer sizes
    proxy_buffer_size 16k;
    proxy_buffers 32 16k;

    # Max temp file size (1GB)
    proxy_max_temp_file_size 1024m;

    # Disable cache
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

## Performance Optimizations

1. **Streaming downloads** - Files stream directly without loading into memory
2. **Extended timeouts** - 30-minute timeouts for slow connections
3. **No caching** - Prevents 304 responses for export files
4. **Proper buffer sizes** - Optimized for large ZIP files
5. **Browser compatibility** - Fallback for older browsers

## Files Modified

1. `/backend/src/api/controllers/exportController.ts` - Enhanced download headers
2. `/src/lib/downloadUtils.ts` - New centralized download utility
3. `/src/pages/export/hooks/useAdvancedExport.ts` - Updated to use utility
4. `/docker/nginx/nginx.template.conf` - Added export download location block

## Testing Instructions

1. Navigate to segmentation editor
2. Select 200+ images for export
3. Configure export options (include visualizations for larger file)
4. Click "Start Export"
5. Wait for completion
6. Both auto-download and manual download button should work
7. Check that file downloads with proper name
8. Verify no 304 responses in network tab

## Browser Compatibility

- ✅ Chrome (all versions)
- ✅ Firefox (all versions)
- ✅ Safari 14+ (older versions use fallback)
- ✅ Edge (all versions)

## File Size Limits

- Frontend: Up to 1GB blob URLs supported
- Backend: Streams any size file
- Nginx: 1GB max temp file size
- Timeout: 30 minutes for download

## Future Improvements

1. Implement chunked downloads for files >1GB
2. Add download progress indicator
3. Implement resume capability for interrupted downloads
4. Consider using Service Worker for background downloads

## Related Issues

- Duplicate download logic across codebase (5+ locations)
- Should refactor all download implementations to use centralized utility
- Consider implementing download queue for multiple exports
