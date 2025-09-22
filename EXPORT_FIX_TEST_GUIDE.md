# Export Fix Test Guide

## What Was Fixed

### 1. Duplicate Downloads Issue

**Problem:** When exporting, the ZIP file was downloading twice - once as "test.zip" and once with a complex filename.

**Root Cause:** The component was remounting multiple times and clearing the download tracking, allowing duplicate auto-downloads.

**Solution:**

- Implemented persistent download tracking using localStorage that survives component remounts
- Added `exportDownloaded_${projectId}` key to track which jobs have been downloaded
- Download tracking now persists across page navigation and component lifecycle

### 2. Auto-Dismissing Export Panel

**Problem:** The export panel was automatically disappearing after 3 seconds without user interaction.

**Root Cause:** A hardcoded 3-second timeout was dismissing the export status after successful download.

**Solution:**

- Removed all auto-dismiss timeouts
- Export panel now stays visible until user clicks "Dismiss" button
- User has full control over when to dismiss the export status

## How to Test

### Manual Testing Steps

1. **Clear Browser State**

   ```javascript
   // Open browser console and run:
   Object.keys(localStorage).forEach(key => {
     if (key.includes('export') || key.includes('Export')) {
       localStorage.removeItem(key);
     }
   });
   ```

2. **Start Fresh Export**
   - Navigate to a project
   - Click "Export Project"
   - Configure export settings
   - Click "Start Export"

3. **Verify Single Download**
   - Wait for export to complete
   - ✅ Should see: ONE download of "projectname.zip"
   - ❌ Should NOT see: Multiple downloads or complex filenames

4. **Verify Panel Persistence**
   - After download completes
   - ✅ Export panel should remain visible
   - ✅ "Download completed successfully" message stays
   - ❌ Panel should NOT disappear automatically

5. **Test Dismiss Button**
   - Click "Dismiss" button
   - ✅ Export panel should disappear
   - ✅ State should be cleared

6. **Test Page Reload**
   - Start an export
   - After it completes and downloads
   - Reload the page
   - ✅ Should NOT trigger another download
   - ✅ Export state should be cleared

## Expected Console Logs

When export completes, you should see:

```
Starting auto-download for jobId: xxx
📥 Starting auto-download with signal aborted: false
✅ Auto-download request completed
Export auto-downloaded successfully
```

You should NOT see:

- Multiple "Starting auto-download" entries
- "Export status auto-dismissed" messages
- "Reset download tracking flags on mount" multiple times

## Automated Test

Run the verification script:

```bash
cd /home/cvat/cell-segmentation-hub
node test-export-fix-verification.mjs
```

This will:

- Automatically test the export flow
- Count downloads
- Verify panel persistence
- Test dismiss functionality
- Check reload behavior

## Success Criteria

✅ **Fixed:** Only ONE download per export
✅ **Fixed:** Export panel stays visible until dismissed
✅ **Fixed:** No duplicate downloads after page reload
✅ **Fixed:** Download and Dismiss buttons work correctly
✅ **Fixed:** Proper filename (project name) used

## Troubleshooting

If you still see issues:

1. **Check localStorage**

   ```javascript
   // In browser console:
   console.log(Object.keys(localStorage).filter(k => k.includes('export')));
   ```

2. **Clear all export state**

   ```javascript
   // Nuclear option - clear everything:
   localStorage.clear();
   location.reload();
   ```

3. **Check Docker logs**
   ```bash
   docker logs spheroseg-frontend --tail 50
   docker logs spheroseg-backend --tail 50
   ```
