# Unicode Diacritics Display Fix - Complete Solution

## Problem Description

Filenames with diacritics (Czech/European characters) were displaying incorrectly in the frontend UI. For example, "ěrčěščřčžřýčžáíý.png" was showing as "eÌrcÌeÌsÌcÌrÌcÌzÌrÌ..." with decomposed Unicode marks visible.

## Root Cause

The issue was caused by Unicode normalization forms:

- **NFD (Canonical Decomposition)**: Characters split into base + combining marks
- **NFC (Canonical Composition)**: Characters composed into single glyphs

When text in NFD form gets truncated by CSS (`text-overflow: ellipsis`), the combining marks become visible as separate characters, causing the garbled display.

## Technical Analysis

- Example: 'ě' in NFD = 'e' (U+0065) + '◌̌' (U+030C) vs NFC = 'ě' (U+011B)
- "ěrčěščřčžřýčžáíý.png" in NFD = 35 characters vs NFC = 20 characters
- CSS truncation at 15 chars cuts through combining marks, exposing them

## Backend Fix (Previously Completed)

**File**: `/backend/src/storage/localStorage.ts`

```javascript
// Line 320 - Updated regex to preserve Unicode:
.replace(/[^\p{L}\p{N}\s._-]/gu, '_')
```

- Uses Unicode property escapes with 'u' flag
- `\p{L}` matches any Unicode letter (including diacritics)
- `\p{N}` matches any Unicode number

## Frontend Fix (Current Implementation)

### 1. Created Text Normalization Utility

**File**: `/src/lib/textUtils.ts`

```typescript
export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  try {
    return text.normalize('NFC');
  } catch (error) {
    console.warn('Failed to normalize text:', error);
    return text;
  }
}
```

### 2. Updated Display Components

Applied normalization to all image name displays:

**ImageCard.tsx**:

```typescript
// Before: {image.name || 'Image'}
// After:  {image.name ? image.name.normalize('NFC') : 'Image'}
```

**SegmentationEditor.tsx**:

```typescript
imageName={selectedImage.name ? selectedImage.name.normalize('NFC') : ''}
```

**Additional Components Fixed**:

- ExportImageCard.tsx
- ImageSelectionCard.tsx
- ImageListItem.tsx
- EditorHeader.tsx (indirectly via prop)

### 3. Updated Search/Filter Logic

**useImageFilter.tsx**:

```typescript
const normalizedSearchTerm = searchTerm.normalize('NFC').toLowerCase();
const normalizedImageName = image.name.normalize('NFC').toLowerCase();
```

**useImageSelection.ts**:

- Applied normalization to search and sorting functions

## Files Modified

1. `/src/lib/textUtils.ts` (new utility)
2. `/src/components/project/ImageCard.tsx`
3. `/src/pages/segmentation/SegmentationEditor.tsx`
4. `/src/pages/export/components/ExportImageCard.tsx`
5. `/src/pages/export/components/ImageSelectionCard.tsx`
6. `/src/components/project/ImageListItem.tsx`
7. `/src/hooks/useImageFilter.tsx`
8. `/src/pages/export/hooks/useImageSelection.ts`

## Test Results

All test cases pass with correct normalization:

- ěrčěščřčžřýčžáíý.png: 35 chars (NFD) → 20 chars (NFC) ✅
- žluťoučký_koníček.jpg: 27 chars (NFD) → 21 chars (NFC) ✅
- příliš_žluťoučký_kůň.jpeg: 34 chars (NFD) → 25 chars (NFC) ✅
- ČERNOBÍLÝ_OBRÁZEK.tiff: 26 chars (NFD) → 22 chars (NFC) ✅
- naïve_café_français.png: 26 chars (NFD) → 23 chars (NFC) ✅
- español*ñ*áéíóú.jpg: 26 chars (NFD) → 19 chars (NFC) ✅

## Integration Points

- **Data flow**: Backend API → Frontend api.ts → React Components → DOM
- **No breaking changes**: Normalization is applied at display time only
- **Backwards compatible**: Works with existing data

## Performance Considerations

- Native `String.prototype.normalize()` is highly optimized
- Minimal performance impact (< 1ms per string)
- Consider memoization for frequently rendered lists

## Browser Compatibility

- `normalize()` supported in all modern browsers
- IE11 requires polyfill (unform package)
- Fallback to original string on error

## Security

- No security implications
- Text normalization is display-only
- No executable content risk

## Future Considerations

1. Consider applying normalization at API response level
2. Add normalization to file upload validation
3. Implement consistent normalization strategy across stack
4. Add e2e tests for diacritics handling

## Keywords

Unicode, NFD, NFC, normalization, diacritics, Czech characters, display issue, text truncation, CSS ellipsis, frontend fix, React components
