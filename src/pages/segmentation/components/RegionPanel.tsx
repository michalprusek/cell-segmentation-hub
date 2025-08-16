import React, { useState, useMemo } from 'react';
import { Circle } from 'lucide-react';
import { Polygon } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';
import PolygonItem from './PolygonItem';
import { isPointInPolygon, getPolygonCentroid } from '@/lib/polygonGeometry';

interface RegionPanelProps {
  loading: boolean;
  polygons: Polygon[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  hiddenPolygonIds?: Set<string>;
  onTogglePolygonVisibility?: (id: string) => void;
  onRenamePolygon?: (id: string, name: string) => void;
  onDeletePolygon?: (id: string) => void;
}

const RegionPanel = ({
  loading,
  polygons,
  selectedPolygonId,
  onSelectPolygon: setSelectedPolygonId,
  hiddenPolygonIds = new Set(),
  onTogglePolygonVisibility,
  onRenamePolygon,
  onDeletePolygon,
}: RegionPanelProps) => {
  const { t } = useLanguage();
  const [expandedPolygons, setExpandedPolygons] = useState<Set<string>>(
    new Set()
  );
  const [editingPolygonId, setEditingPolygonId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  // Organize polygons by hierarchy (external with internal polygons under them)
  const organizedPolygons = useMemo(() => {
    if (!polygons) return [];

    const externals = polygons.filter(p => p.type === 'external');
    const internals = polygons.filter(p => p.type === 'internal');

    return externals.map(external => ({
      ...external,
      children: internals.filter(internal => {
        // Check if the internal polygon's centroid is contained within the external polygon
        const centroid = getPolygonCentroid(internal.points);
        return isPointInPolygon(centroid, external.points);
      }),
    }));
  }, [polygons]);

  const handlePolygonSelect = (id: string) => {
    setSelectedPolygonId(id === selectedPolygonId ? null : id);
  };

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedPolygons);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedPolygons(newExpanded);
  };

  const toggleVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePolygonVisibility?.(id);
  };

  const handleStartRename = (
    id: string,
    currentName: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setEditingPolygonId(id);
    setEditingName(currentName);
  };

  const handleSaveRename = (id: string) => {
    if (editingName.trim() && onRenamePolygon) {
      onRenamePolygon(id, editingName.trim());
    }
    setEditingPolygonId(null);
    setEditingName('');
  };

  const handleCancelRename = () => {
    setEditingPolygonId(null);
    setEditingName('');
  };

  const handleDeletePolygon = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeletePolygon?.(id);
  };

  if (!polygons) return null;

  return (
    <motion.div
      className="h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col shadow-lg"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Polygons
        </h3>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {polygons.length} total polygons
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-4">
        {loading ? (
          <div className="px-4 py-8 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full mx-auto mb-3" />
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('segmentation.loading') || 'Loading...'}
            </div>
          </div>
        ) : organizedPolygons.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Circle className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('segmentation.noPolygons') || 'No polygons found'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {organizedPolygons.map((polygon, index) => (
              <PolygonItem
                key={polygon.id}
                polygon={polygon}
                index={index}
                selectedPolygonId={selectedPolygonId}
                expandedPolygons={expandedPolygons}
                hiddenPolygonIds={hiddenPolygonIds}
                editingPolygonId={editingPolygonId}
                editingName={editingName}
                onSelectPolygon={handlePolygonSelect}
                onToggleExpanded={toggleExpanded}
                onToggleVisibility={toggleVisibility}
                onStartRename={handleStartRename}
                onSaveRename={handleSaveRename}
                onCancelRename={handleCancelRename}
                onDeletePolygon={handleDeletePolygon}
                onEditingNameChange={setEditingName}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default RegionPanel;
