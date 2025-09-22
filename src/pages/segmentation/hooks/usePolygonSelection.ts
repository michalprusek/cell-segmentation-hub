import { useCallback } from 'react';
import { EditMode } from '../types';
import { logger } from '@/lib/logger';

interface UsePolygonSelectionProps {
  editMode: EditMode;
  currentSelectedPolygonId: string | null;
  onModeChange: (mode: EditMode) => void;
  onSelectionChange: (polygonId: string | null) => void;
  onDeletePolygon: (polygonId: string) => void;
  polygons: Array<{ id: string }>;
}

interface UsePolygonSelectionReturn {
  handlePolygonSelection: (polygonId: string | null) => void;
  handlePolygonClick: (polygonId: string) => void;
}

/**
 * Centralized polygon selection management hook
 * Single Source of Truth (SSOT) for all polygon selection logic
 *
 * This hook consolidates selection logic that was previously scattered across:
 * - SegmentationEditor.tsx (handlePolygonSelection)
 * - useAdvancedInteractions.tsx (multiple setSelectedPolygonId calls)
 * - CanvasPolygon.tsx (direct onClick handlers)
 *
 * Key principles:
 * 1. Mode-aware selection behavior
 * 2. Single event flow: CanvasPolygon → usePolygonSelection → state updates
 * 3. No duplicate handlers or competing state managers
 */
export const usePolygonSelection = ({
  editMode,
  currentSelectedPolygonId,
  onModeChange,
  onSelectionChange,
  onDeletePolygon,
  polygons,
}: UsePolygonSelectionProps): UsePolygonSelectionReturn => {
  /**
   * Main selection handler that respects the current edit mode
   * This replaces the problematic default case that forced EditVertices mode
   */
  const handlePolygonSelection = useCallback(
    (polygonId: string | null) => {
      logger.debug('usePolygonSelection: handlePolygonSelection called:', {
        polygonId,
        currentSelectedId: currentSelectedPolygonId,
        currentEditMode: editMode,
        totalPolygons: polygons.length,
        timeStamp: Date.now(),
        polygonExists: polygonId
          ? polygons.some(p => p.id === polygonId)
          : null,
      });

      // Detect potential mass selection issues
      if (
        polygonId &&
        currentSelectedPolygonId &&
        polygonId !== currentSelectedPolygonId
      ) {
        logger.warn('usePolygonSelection: Selection change detected:', {
          trying_to_select: polygonId,
          currently_selected: currentSelectedPolygonId,
          will_change_selection: true,
        });
      }

      // Handle deselection
      if (polygonId === null) {
        logger.debug('usePolygonSelection: Deselecting polygon');
        // If deselecting and in EditVertices mode, switch to View mode
        if (editMode === EditMode.EditVertices) {
          onModeChange(EditMode.View);
        }
        onSelectionChange(polygonId);
        return;
      }

      // Validate polygon exists
      const polygonExists = polygons.some(p => p.id === polygonId);
      if (!polygonExists) {
        logger.warn(
          'usePolygonSelection: Attempted to select non-existent polygon:',
          polygonId
        );
        return;
      }

      logger.debug(
        'usePolygonSelection: Selecting polygon:',
        polygonId,
        'Mode:',
        editMode
      );

      // Handle mode-specific behavior when selecting a polygon
      switch (editMode) {
        case EditMode.DeletePolygon:
          logger.debug(
            'usePolygonSelection: Delete mode - deleting polygon:',
            polygonId
          );
          onDeletePolygon(polygonId);
          // Stay in delete mode for multiple deletions
          return;

        case EditMode.Slice:
          logger.debug(
            'usePolygonSelection: Slice mode - selecting polygon for slicing:',
            polygonId
          );
          console.log(
            '[usePolygonSelection] SLICE MODE - Selecting polygon, NOT changing mode:',
            polygonId
          );
          onSelectionChange(polygonId);
          // Stay in slice mode - DO NOT change mode!
          return;

        case EditMode.EditVertices:
          logger.debug(
            'usePolygonSelection: EditVertices mode - selecting polygon:',
            polygonId
          );
          onSelectionChange(polygonId);
          // Already in correct mode
          return;

        case EditMode.AddPoints:
          logger.debug(
            'usePolygonSelection: AddPoints mode - selecting polygon:',
            polygonId
          );
          onSelectionChange(polygonId);
          // Stay in current mode
          return;

        case EditMode.CreatePolygon:
          logger.debug(
            'usePolygonSelection: CreatePolygon mode - selecting polygon:',
            polygonId
          );
          onSelectionChange(polygonId);
          // Stay in current mode
          return;

        case EditMode.View:
          logger.debug(
            'usePolygonSelection: View mode - selecting polygon and switching to EditVertices:',
            polygonId
          );
          console.log(
            '[usePolygonSelection] VIEW MODE - Auto-switching to EditVertices!'
          );
          console.log(
            '[usePolygonSelection] Current mode before switch:',
            editMode
          );
          // Only from View mode should we auto-switch to EditVertices
          onSelectionChange(polygonId);
          onModeChange(EditMode.EditVertices);
          return;

        default:
          logger.debug(
            'usePolygonSelection: Unknown/other mode - selecting polygon without mode change:',
            polygonId
          );
          // CRITICAL FIX: Don't force mode changes for undefined modes
          onSelectionChange(polygonId);
          // Let the mode stay as is
          return;
      }
    },
    [
      editMode,
      currentSelectedPolygonId,
      onModeChange,
      onSelectionChange,
      onDeletePolygon,
      polygons,
    ]
  );

  /**
   * Simplified click handler for CanvasPolygon components
   * This replaces individual click handlers in CanvasPolygon
   */
  const handlePolygonClick = useCallback(
    (polygonId: string) => {
      logger.debug(
        'usePolygonSelection: handlePolygonClick called for polygon:',
        polygonId
      );
      console.log(
        '[usePolygonSelection] handlePolygonClick - Current editMode:',
        editMode
      );
      console.log(
        '[usePolygonSelection] handlePolygonClick - About to handle selection for:',
        polygonId
      );
      handlePolygonSelection(polygonId);
    },
    [handlePolygonSelection, editMode]
  );

  return {
    handlePolygonSelection,
    handlePolygonClick,
  };
};
