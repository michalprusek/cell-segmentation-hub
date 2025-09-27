# Unicode Diacritic Display Fix (2025)

## Problem

Filenames with diacritics (e.g., "ěrčěščřčžřýčžáíý.png") were displaying incorrectly in the frontend UI as "eÌrcÌeÌsÌcÌrÌcÌzÌrÌ...".

## Root Cause

The issue was caused by Unicode normalization problems:

1. Text was being decomposed to NFD (Normalized Form Decomposed) where diacritics are separate combining characters
2. CSS `truncate` class was cutting off text based on character count, not visual length
3. When truncated NFD text is displayed, combining marks appear as separate characters

## Technical Details

- NFD form: 35 characters (base characters + combining marks)
- NFC form: 20 characters (composed characters)
- Example: `ě` in NFD = `e` (101) + `ˇ` (780) vs NFC = `ě` (283)

## Solution

Created a text normalization utility and applied it to all image name displays:

### 1. Created `/src/lib/textUtils.ts`

```typescript
export function normalizeText(text: string | null | undefined): string {
  if (!text) {
    return '';
  }

  try {
    return text.normalize('NFC');
  } catch (error) {
    console.warn('Failed to normalize text:', error);
    return text;
  }
}
```

### 2. Updated Components

Fixed all image name displays in:

- `/src/components/project/ImageCard.tsx`
- `/src/pages/segmentation/SegmentationEditor.tsx`
- `/src/pages/export/components/ExportImageCard.tsx`
- `/src/pages/export/components/ImageSelectionCard.tsx`
- `/src/components/project/ImageListItem.tsx`

### 3. Updated Search/Filter Logic

Applied normalization to search functions in:

- `/src/hooks/useImageFilter.tsx`
- `/src/pages/export/hooks/useImageSelection.ts`

## Key Changes

Replace all instances of:

```typescript
{
  image.name || 'fallback';
}
```

With:

```typescript
{
  image.name ? image.name.normalize('NFC') : 'fallback';
}
```

Or use the utility:

```typescript
{
  normalizeTextWithFallback(image.name, 'fallback');
}
```

## Testing

- Verified NFD -> NFC conversion works correctly
- Tested with problematic filename: "ěrčěščřčžřýčžáíý.png"
- All TypeScript checks pass
- No breaking changes introduced

## Prevention

Always use `.normalize('NFC')` when displaying user-generated text content, especially filenames with potential diacritics.
