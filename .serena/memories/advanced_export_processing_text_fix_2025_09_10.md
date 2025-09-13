# Advanced Export Processing Text Fix

## Issue

The Advanced Export button was showing "processing {{}} of {{}}" instead of "Processing..." when in the exporting state.

## Root Cause

The translation key `export.processingExport` was recently added to all translation files with the correct value "Processing..." (and localized versions), but the frontend container was running with the old code that didn't have this translation key. This caused the translation system to display the template variables as empty placeholders.

## Solution

1. The translation keys were already correctly added to all 6 language files:
   - `export.processingExport: 'Processing...'` (English)
   - `export.processingExport: 'Zpracování...'` (Czech)
   - `export.processingExport: 'Verarbeitung...'` (German)
   - `export.processingExport: 'Procesando...'` (Spanish)
   - `export.processingExport: 'Traitement...'` (French)
   - `export.processingExport: '处理中...'` (Chinese)

2. The ProjectToolbar component was already correctly using `t('export.processingExport')` on line 179

3. The fix required rebuilding and restarting the frontend container to apply the new translations:
   ```bash
   make build
   make restart
   ```

## Key Files

- `/src/components/project/ProjectToolbar.tsx` - The component displaying the Advanced Export button
- `/src/translations/*.ts` - All translation files containing the processingExport key
- `/src/pages/export/AdvancedExportDialog.tsx` - The export dialog itself

## Important Notes

- The `export.processing` key with template variables `{{current}}` and `{{total}}` is kept for contexts where progress tracking is available
- The `export.processingExport` key is used for simple processing display without progress variables
- Always rebuild containers after modifying translation files to ensure changes are applied

## Prevention

- Use specific translation keys for different contexts
- Ensure all usage sites can provide required template variables
- Always rebuild and restart containers after translation changes
