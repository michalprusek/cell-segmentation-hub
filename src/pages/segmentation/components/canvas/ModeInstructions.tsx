import React, { useState, useEffect } from 'react';
import { EditMode, InteractionState } from '../../types';
import { Point } from '@/lib/segmentation';

interface ModeInstructionsProps {
  editMode: EditMode;
  interactionState: InteractionState;
  selectedPolygonId: string | null;
  tempPoints: Point[];
  isShiftPressed?: boolean;
}

/**
 * Mode-specific instruction overlay inspired by SpheroSeg
 * Provides contextual guidance for each editing mode
 */
const ModeInstructions: React.FC<ModeInstructionsProps> = ({
  editMode,
  interactionState,
  selectedPolygonId,
  tempPoints,
  isShiftPressed = false,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  // Auto-hide instructions after 5 seconds in View mode
  useEffect(() => {
    if (editMode === EditMode.View) {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(true);
    }
  }, [editMode]);

  // Don't show instructions if hidden and in View mode
  if (!isVisible && editMode === EditMode.View) {
    return null;
  }
  const getInstructions = () => {
    switch (editMode) {
      case EditMode.Slice:
        if (!selectedPolygonId) {
          return {
            title: 'Slice Mode',
            color: '#ef4444', // red-500 to match border
            instructions: ['1. Click on a polygon to select it for slicing'],
          };
        } else if (tempPoints.length === 0) {
          return {
            title: 'Slice Mode',
            color: '#ef4444', // red-500 to match border
            instructions: [
              '2. Click to place the first slice point',
              'Press ESC to cancel',
            ],
          };
        } else {
          return {
            title: 'Slice Mode',
            color: '#ef4444', // red-500 to match border
            instructions: [
              '3. Click to place the second slice point and perform slice',
              'Press ESC to cancel',
            ],
          };
        }

      case EditMode.CreatePolygon:
        if (tempPoints.length === 0) {
          return {
            title: 'Create Polygon Mode',
            color: '#3b82f6', // blue-500 to match border
            instructions: [
              '1. Click to start creating a polygon',
              'Hold SHIFT to automatically add points',
            ],
          };
        } else if (tempPoints.length < 3) {
          return {
            title: 'Create Polygon Mode',
            color: '#3b82f6', // blue-500 to match border
            instructions: [
              '2. Continue clicking to add more points (at least 3 needed)',
              'Hold SHIFT to automatically add points • Press ESC to cancel',
            ],
          };
        } else {
          return {
            title: 'Create Polygon Mode',
            color: '#3b82f6', // blue-500 to match border
            instructions: [
              '3. Continue adding points or click near the first point to close the polygon',
              'Hold SHIFT to automatically add points • Press ESC to cancel',
            ],
          };
        }

      case EditMode.AddPoints:
        if (!interactionState.isAddingPoints) {
          return {
            title: 'Add Points Mode',
            color: '#10b981', // emerald-500 to match border
            instructions: [
              'Click on any vertex to start adding points',
              'Press ESC to cancel',
            ],
          };
        } else {
          return {
            title: 'Add Points Mode',
            color: '#10b981', // emerald-500 to match border
            instructions: [
              'Click to add points, then click on another vertex to complete',
              'Hold SHIFT to automatically add points • Press ESC to cancel',
            ],
          };
        }

      case EditMode.EditVertices:
        if (selectedPolygonId) {
          return {
            title: 'Edit Vertices Mode',
            color: '#a855f7', // purple-500 to match border
            instructions: [
              'Click and drag vertices to move them',
              'Hold SHIFT and click a vertex to add points • Double-click a vertex to delete it',
            ],
          };
        } else {
          return {
            title: 'Edit Vertices Mode',
            color: '#a855f7', // purple-500 to match border
            instructions: ['Click on a polygon to select it for editing'],
          };
        }

      case EditMode.DeletePolygon:
        return {
          title: 'Delete Polygon Mode',
          color: '#f97316', // orange-500 to match border
          instructions: ['Click on a polygon to delete it'],
        };

      case EditMode.View:
      default:
        return {
          title: 'View Mode',
          color: '#9ca3af', // gray-400 to match border
          instructions: [
            'Click on a polygon to select it',
            'Drag to pan • Scroll to zoom',
          ],
        };
    }
  };

  const { title, color, instructions } = getInstructions();

  return (
    <div
      style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background:
          editMode === EditMode.View ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '13px',
        fontWeight: editMode === EditMode.View ? 'normal' : 'bold',
        maxWidth: '280px',
        pointerEvents: editMode === EditMode.View ? 'auto' : 'none',
        zIndex: 1000,
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        opacity: editMode === EditMode.View ? 0.85 : 1,
        transition: 'opacity 0.3s ease',
      }}
    >
      <div
        style={{
          color,
          marginBottom: '4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{title}</span>
        {editMode === EditMode.View && (
          <button
            onClick={() => setIsVisible(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '0',
              marginLeft: '8px',
              opacity: 0.7,
            }}
            onMouseEnter={e => (e.target.style.opacity = '1')}
            onMouseLeave={e => (e.target.style.opacity = '0.7')}
          >
            ×
          </button>
        )}
      </div>
      {instructions.map((instruction, index) => (
        <div
          key={index}
          style={{
            fontSize: index === 0 ? '14px' : '12px',
            marginTop: index === 0 ? '0' : '4px',
            opacity: index === 0 ? 1 : 0.8,
          }}
        >
          {instruction}
        </div>
      ))}

      {/* Show shift key indicator */}
      {isShiftPressed &&
        (editMode === EditMode.CreatePolygon ||
          (editMode === EditMode.AddPoints &&
            interactionState.isAddingPoints)) && (
          <div
            style={{
              fontSize: '11px',
              marginTop: '6px',
              padding: '2px 6px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '3px',
              color: '#3b82f6', // blue-500 to match border
            }}
          >
            ⚡ SHIFT: Auto-adding points
          </div>
        )}
    </div>
  );
};

export default ModeInstructions;
