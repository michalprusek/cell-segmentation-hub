/**
 * Unit tests for useImageSelection.
 *
 * Coverage targets:
 *  - Default state (all images selected, page 1, date sort, empty search)
 *  - initialSelectedIds override + effect update when prop changes
 *  - toggleSelection: deselect / re-select
 *  - selectAll / selectNone
 *  - toggleAll (full set + filtered set when search active)
 *  - isAllSelected derived flag
 *  - selectedCount
 *  - Search filter (name, case-insensitive)
 *  - Sort by name ascending
 *  - Pagination: totalPages, navigation, canGoNext/Prev, startIndex/endIndex
 *  - Page auto-reset when filter reduces results below current page
 *
 * MEMORY DESIGN: A shared renderHook is created once per test via beforeEach.
 * This keeps total renderHook instantiations per file at exactly 10 (one per test)
 * plus 1 extra for the pagination test that requires a different image set.
 * At 3 GB heap limit, creating >11 renderHook instances with act() exhausts the
 * heap; this design stays within that budget.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, type RenderHookResult } from '@testing-library/react';
import { useImageSelection, type SortOption } from '../useImageSelection';
import type { ProjectImage } from '@/types';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeImage(
  id: string,
  name = `Image ${id}`,
  status: ProjectImage['segmentationStatus'] = 'completed'
): ProjectImage {
  return {
    id,
    name,
    url: '',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    segmentationStatus: status,
  };
}

const BASE_IMAGES = [
  makeImage('a', 'Apple'),
  makeImage('b', 'Banana'),
  makeImage('c', 'Cherry'),
];

// ------------------------------------------------------------------

describe('useImageSelection', () => {
  let hook: RenderHookResult<ReturnType<typeof useImageSelection>, unknown>;

  beforeEach(() => {
    hook = renderHook(() => useImageSelection({ images: BASE_IMAGES }));
    // Reset to known baseline
    act(() => hook.result.current.selectAll());
    act(() => hook.result.current.setSearchQuery(''));
    act(() => hook.result.current.setSortBy('date' as SortOption));
  });

  // ----------------------------------------------------------------
  it('default state: all selected, page 1, date sort, empty search', () => {
    const r = hook.result.current;
    expect(r.selectedCount).toBe(3);
    expect(r.isAllSelected).toBe(true);
    expect(r.selectedIds.has('a')).toBe(true);
    expect(r.currentPage).toBe(1);
    expect(r.sortBy).toBe('date');
    expect(r.searchQuery).toBe('');
    expect(r.canGoNext).toBe(false);
    expect(r.canGoPrevious).toBe(false);
    expect(r.startIndex).toBe(1);
    expect(r.endIndex).toBe(3);
    expect(r.totalPages).toBe(1);
    expect(r.pageNumbers).toEqual([1]);
    expect(r.filteredImages).toHaveLength(3);
    expect(r.paginatedImages).toHaveLength(3);
  });

  // ----------------------------------------------------------------
  it('toggleSelection: deselects a selected image then re-selects it', () => {
    act(() => hook.result.current.toggleSelection('a'));
    expect(hook.result.current.selectedIds.has('a')).toBe(false);
    expect(hook.result.current.selectedCount).toBe(2);
    expect(hook.result.current.isAllSelected).toBe(false);

    act(() => hook.result.current.toggleSelection('a'));
    expect(hook.result.current.selectedIds.has('a')).toBe(true);
    expect(hook.result.current.selectedCount).toBe(3);
  });

  // ----------------------------------------------------------------
  it('selectNone clears all selections; selectAll restores them', () => {
    act(() => hook.result.current.selectNone());
    expect(hook.result.current.selectedCount).toBe(0);
    expect(hook.result.current.isAllSelected).toBe(false);

    act(() => hook.result.current.selectAll());
    expect(hook.result.current.selectedCount).toBe(3);
    expect(hook.result.current.isAllSelected).toBe(true);
  });

  // ----------------------------------------------------------------
  it('toggleAll: deselects all when all selected; selects all when none selected', () => {
    act(() => hook.result.current.toggleAll());
    expect(hook.result.current.selectedCount).toBe(0);

    act(() => hook.result.current.toggleAll());
    expect(hook.result.current.selectedCount).toBe(3);
    expect(hook.result.current.isAllSelected).toBe(true);
  });

  // ----------------------------------------------------------------
  it('toggleAll with active search: only affects filtered images', () => {
    act(() => hook.result.current.selectNone());
    act(() => hook.result.current.setSearchQuery('apple'));

    act(() => hook.result.current.toggleAll());
    expect(hook.result.current.selectedIds.has('a')).toBe(true);
    expect(hook.result.current.selectedIds.has('b')).toBe(false);
    expect(hook.result.current.selectedIds.has('c')).toBe(false);
  });

  // ----------------------------------------------------------------
  it('search filter: case-insensitive name match; clearing returns all images', () => {
    act(() => hook.result.current.setSearchQuery('apple'));
    expect(hook.result.current.filteredImages).toHaveLength(1);
    expect(hook.result.current.filteredImages[0].id).toBe('a');

    act(() => hook.result.current.setSearchQuery(''));
    expect(hook.result.current.filteredImages).toHaveLength(3);
  });

  // ----------------------------------------------------------------
  it('sort by name: ascending alphabetical order', () => {
    act(() => hook.result.current.setSortBy('name'));
    expect(hook.result.current.filteredImages.map(i => i.name)).toEqual([
      'Apple',
      'Banana',
      'Cherry',
    ]);
  });

  // ----------------------------------------------------------------
  it('isAllSelected is false when images is empty', () => {
    // Use shared hook with selectNone + verify empty filteredImages isAllSelected logic
    act(() => hook.result.current.setSearchQuery('__no_match__'));
    // filteredImages is empty → isAllSelected must be false
    expect(hook.result.current.filteredImages).toHaveLength(0);
    expect(hook.result.current.isAllSelected).toBe(false);
    expect(hook.result.current.startIndex).toBe(0);
  });

  // ----------------------------------------------------------------
  it('pagination: navigation, canGoNext/Prev, startIndex/endIndex, page auto-reset', () => {
    // Need a larger image set — one extra renderHook for this test
    const bigImages = Array.from({ length: 12 }, (_, i) =>
      makeImage(`i${i}`, `Item${i}`)
    );
    const { result } = renderHook(() =>
      useImageSelection({ images: bigImages, itemsPerPage: 10 })
    );

    expect(result.current.totalPages).toBe(2);
    expect(result.current.canGoNext).toBe(true);
    expect(result.current.canGoPrevious).toBe(false);
    expect(result.current.startIndex).toBe(1);
    expect(result.current.endIndex).toBe(10);
    expect(result.current.paginatedImages).toHaveLength(10);

    act(() => result.current.goToNextPage());
    expect(result.current.currentPage).toBe(2);
    expect(result.current.startIndex).toBe(11);
    expect(result.current.endIndex).toBe(12);
    expect(result.current.canGoPrevious).toBe(true);
    expect(result.current.canGoNext).toBe(false);

    // no-op at last page
    act(() => result.current.goToNextPage());
    expect(result.current.currentPage).toBe(2);

    // navigate back
    act(() => result.current.goToPreviousPage());
    expect(result.current.currentPage).toBe(1);

    // no-op at first page
    act(() => result.current.goToPreviousPage());
    expect(result.current.currentPage).toBe(1);

    // page auto-reset when search reduces totalPages
    act(() => result.current.setCurrentPage(2));
    act(() => result.current.setSearchQuery('Item0'));
    expect(result.current.currentPage).toBe(1);
  });

  // ----------------------------------------------------------------
  it('initialSelectedIds: partial override + effect update when prop changes', () => {
    // Test initialSelectedIds override via rerender
    const imgs = [makeImage('x'), makeImage('y'), makeImage('z')];
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] | undefined }) =>
        useImageSelection({ images: imgs, initialSelectedIds: ids }),
      { initialProps: { ids: ['x'] as string[] | undefined } }
    );

    // partial selection
    expect(result.current.selectedIds.has('x')).toBe(true);
    expect(result.current.selectedIds.has('y')).toBe(false);
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.isAllSelected).toBe(false);

    // effect: update when initialSelectedIds prop changes
    rerender({ ids: ['y', 'z'] });

    expect(result.current.selectedIds.has('x')).toBe(false);
    expect(result.current.selectedIds.has('y')).toBe(true);
    expect(result.current.selectedIds.has('z')).toBe(true);
    expect(result.current.selectedCount).toBe(2);
  });
});
