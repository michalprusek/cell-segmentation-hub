import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Edit3,
  Trash2,
  Circle,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface Point {
  x: number;
  y: number;
}

interface PolygonData {
  id: string;
  name?: string;
  type: 'external' | 'internal';
  points: Point[];
  children?: PolygonData[];
}

interface PolygonItemProps {
  polygon: PolygonData;
  index: number;
  isChild?: boolean;
  selectedPolygonId: string | null;
  expandedPolygons: Set<string>;
  hiddenPolygonIds: Set<string>;
  editingPolygonId: string | null;
  editingName: string;
  onSelectPolygon: (id: string) => void;
  onToggleExpanded: (id: string, e: React.MouseEvent) => void;
  onToggleVisibility: (id: string, e: React.MouseEvent) => void;
  onStartRename: (id: string, currentName: string, e: React.MouseEvent) => void;
  onSaveRename: (id: string) => void;
  onCancelRename: () => void;
  onDeletePolygon: (id: string, e: React.MouseEvent) => void;
  onEditingNameChange: (name: string) => void;
}

const PolygonItem: React.FC<PolygonItemProps> = React.memo(
  ({
    polygon,
    index,
    isChild = false,
    selectedPolygonId,
    expandedPolygons,
    hiddenPolygonIds,
    editingPolygonId,
    editingName,
    onSelectPolygon,
    onToggleExpanded,
    onToggleVisibility,
    onStartRename,
    onSaveRename,
    onCancelRename,
    onDeletePolygon,
    onEditingNameChange,
  }) => {
    const isSelected = polygon.id === selectedPolygonId;
    const isExpanded = expandedPolygons.has(polygon.id);
    const isHidden = hiddenPolygonIds.has(polygon.id);
    const hasChildren = !isChild && polygon.children?.length > 0;
    const isEditing = editingPolygonId === polygon.id;
    const polygonName =
      polygon.name ||
      `${polygon.type === 'external' ? 'External' : 'Internal'} ${index + 1}`;

    return (
      <div className={`${isChild ? 'ml-6' : ''}`}>
        <div
          className={`flex items-center px-3 py-2 rounded-lg mx-2 cursor-pointer transition-all duration-200 ${
            isSelected
              ? polygon.type === 'external'
                ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700'
                : 'bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          onClick={() => onSelectPolygon(polygon.id)}
        >
          {hasChildren && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 mr-2"
              onClick={e => onToggleExpanded(polygon.id, e)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              )}
            </Button>
          )}

          {!hasChildren && isChild && (
            <div className="w-6 h-6 mr-2 flex items-center justify-center">
              <div className="w-2 h-px bg-gray-400 dark:bg-gray-600" />
            </div>
          )}

          <div className="flex items-center mr-2">
            {polygon.type === 'external' ? (
              <Circle className="h-4 w-4 text-blue-400" fill="currentColor" />
            ) : (
              <Square className="h-4 w-4 text-orange-400" fill="currentColor" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                type="text"
                value={editingName}
                onChange={e => onEditingNameChange(e.target.value)}
                onBlur={() => onSaveRename(polygon.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onSaveRename(polygon.id);
                  } else if (e.key === 'Escape') {
                    onCancelRename();
                  }
                }}
                className="text-sm font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {polygonName}
              </div>
            )}
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {polygon.points.length} points
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
              onClick={e => onToggleVisibility(polygon.id, e)}
            >
              {isHidden ? (
                <EyeOff className="h-3 w-3 text-gray-600 dark:text-gray-400" />
              ) : (
                <Eye className="h-3 w-3 text-gray-600 dark:text-gray-400" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
              onClick={e => onStartRename(polygon.id, polygonName, e)}
            >
              <Edit3 className="h-3 w-3 text-gray-600 dark:text-gray-400" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 opacity-60 hover:opacity-100 hover:text-red-500"
              onClick={e => onDeletePolygon(polygon.id, e)}
            >
              <Trash2 className="h-3 w-3 text-gray-600 dark:text-gray-400 hover:text-red-500" />
            </Button>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-1"
          >
            {polygon.children?.map((child: PolygonData, childIndex: number) => (
              <PolygonItem
                key={child.id}
                polygon={child}
                isChild={true}
                index={childIndex}
                selectedPolygonId={selectedPolygonId}
                expandedPolygons={expandedPolygons}
                hiddenPolygonIds={hiddenPolygonIds}
                editingPolygonId={editingPolygonId}
                editingName={editingName}
                onSelectPolygon={onSelectPolygon}
                onToggleExpanded={onToggleExpanded}
                onToggleVisibility={onToggleVisibility}
                onStartRename={onStartRename}
                onSaveRename={onSaveRename}
                onCancelRename={onCancelRename}
                onDeletePolygon={onDeletePolygon}
                onEditingNameChange={onEditingNameChange}
              />
            ))}
          </motion.div>
        )}
      </div>
    );
  }
);

PolygonItem.displayName = 'PolygonItem';

export default PolygonItem;
