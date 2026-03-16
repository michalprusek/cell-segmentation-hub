import React, { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, Spline } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Polygon } from '@/lib/segmentation';

interface SpermInstancePanelProps {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  activePartClass: 'head' | 'midpiece' | 'tail';
  onPartClassChange: (partClass: 'head' | 'midpiece' | 'tail') => void;
  activeInstanceId: string;
  onInstanceIdChange: (instanceId: string) => void;
}

const PART_CLASS_COLORS: Record<string, string> = {
  head: 'bg-green-500',
  midpiece: 'bg-orange-500',
  tail: 'bg-cyan-500',
};

const PART_CLASS_LABELS: Record<string, string> = {
  head: 'Head',
  midpiece: 'Midpiece',
  tail: 'Tail',
};

const SpermInstancePanel: React.FC<SpermInstancePanelProps> = ({
  polygons,
  selectedPolygonId,
  onSelectPolygon,
  activePartClass,
  onPartClassChange,
  activeInstanceId,
  onInstanceIdChange,
}) => {
  const { t } = useLanguage();
  const [expandedInstances, setExpandedInstances] = useState<Set<string>>(
    new Set()
  );

  // Get only polylines from polygons
  const polylines = useMemo(
    () => polygons.filter(p => p.geometry === 'polyline'),
    [polygons]
  );

  // Group polylines by instanceId
  const instanceGroups = useMemo(() => {
    const groups = new Map<string, Polygon[]>();
    for (const polyline of polylines) {
      const instanceId = polyline.instanceId || 'unassigned';
      if (!groups.has(instanceId)) {
        groups.set(instanceId, []);
      }
      groups.get(instanceId)!.push(polyline);
    }
    return groups;
  }, [polylines]);

  // Get all existing instance IDs (sorted)
  const instanceIds = useMemo(
    () =>
      Array.from(instanceGroups.keys())
        .filter(id => id !== 'unassigned')
        .sort(),
    [instanceGroups]
  );

  // Get next available instance number
  const nextInstanceNumber = useMemo(() => {
    let max = 0;
    for (const id of instanceIds) {
      const match = id.match(/^sperm_(\d+)$/);
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
    return max + 1;
  }, [instanceIds]);

  const handleCreateInstance = useCallback(() => {
    const newId = `sperm_${nextInstanceNumber}`;
    onInstanceIdChange(newId);
  }, [nextInstanceNumber, onInstanceIdChange]);

  const toggleExpanded = useCallback((instanceId: string) => {
    setExpandedInstances(prev => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }, []);

  // Get which parts exist for an instance
  const getInstanceParts = useCallback(
    (instanceId: string) => {
      const parts = instanceGroups.get(instanceId) || [];
      return {
        head: parts.some(p => p.partClass === 'head'),
        midpiece: parts.some(p => p.partClass === 'midpiece'),
        tail: parts.some(p => p.partClass === 'tail'),
      };
    },
    [instanceGroups]
  );

  const getInstanceLabel = (instanceId: string) => {
    const match = instanceId.match(/^sperm_(\d+)$/);
    if (match) {
      return `${t('sperm.instance')} ${match[1]}`;
    }
    return instanceId;
  };

  if (polylines.length === 0 && instanceIds.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Spline className="h-4 w-4" />
          {t('sperm.instancePanel')}
        </h4>
      </div>

      {/* Active drawing controls */}
      <div className="p-3 space-y-2 border-b border-gray-200 dark:border-gray-700">
        {/* Instance selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {t('sperm.instance')}:
          </span>
          <Select value={activeInstanceId} onValueChange={onInstanceIdChange}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {instanceIds.map(id => (
                <SelectItem key={id} value={id}>
                  {getInstanceLabel(id)}
                </SelectItem>
              ))}
              {instanceIds.length === 0 && (
                <SelectItem value={`sperm_${nextInstanceNumber}`}>
                  {t('sperm.instance')} {nextInstanceNumber}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCreateInstance}
            title={t('sperm.newInstance')}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Part class selector */}
        <div className="flex items-center gap-1">
          {(['head', 'midpiece', 'tail'] as const).map(part => (
            <Button
              key={part}
              variant={activePartClass === part ? 'default' : 'outline'}
              size="sm"
              className={`flex-1 h-7 text-xs ${
                activePartClass === part
                  ? part === 'head'
                    ? 'bg-green-600 hover:bg-green-700'
                    : part === 'midpiece'
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-cyan-600 hover:bg-cyan-700'
                  : ''
              }`}
              onClick={() => onPartClassChange(part)}
            >
              {t(`sperm.part.${part}`)}
            </Button>
          ))}
        </div>
      </div>

      {/* Instance list */}
      <div className="max-h-48 overflow-y-auto">
        {instanceIds.map(instanceId => {
          const isExpanded = expandedInstances.has(instanceId);
          const parts = getInstanceParts(instanceId);
          const instancePolylines = instanceGroups.get(instanceId) || [];

          return (
            <div key={instanceId} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0">
              {/* Instance header */}
              <button
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  activeInstanceId === instanceId ? 'bg-violet-50 dark:bg-violet-900/20' : ''
                }`}
                onClick={() => {
                  toggleExpanded(instanceId);
                  onInstanceIdChange(instanceId);
                }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400" />
                )}
                <span className="text-sm font-medium flex-1">
                  {getInstanceLabel(instanceId)}
                </span>
                {/* Part indicators */}
                <div className="flex gap-1">
                  {(['head', 'midpiece', 'tail'] as const).map(part => (
                    <div
                      key={part}
                      className={`w-2 h-2 rounded-full ${
                        parts[part]
                          ? PART_CLASS_COLORS[part]
                          : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                      title={`${PART_CLASS_LABELS[part]}: ${parts[part] ? 'drawn' : 'missing'}`}
                    />
                  ))}
                </div>
              </button>

              {/* Expanded polyline list */}
              {isExpanded && (
                <div className="px-3 pb-2">
                  {instancePolylines.map(polyline => (
                    <button
                      key={polyline.id}
                      className={`w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors ${
                        selectedPolygonId === polyline.id
                          ? 'bg-violet-100 dark:bg-violet-900/30'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      onClick={() =>
                        onSelectPolygon(
                          selectedPolygonId === polyline.id ? null : polyline.id
                        )
                      }
                    >
                      <div
                        className={`w-2 h-2 rounded-full ${
                          PART_CLASS_COLORS[polyline.partClass || ''] ||
                          'bg-violet-500'
                        }`}
                      />
                      <span className="flex-1 text-left">
                        {polyline.partClass
                          ? t(`sperm.part.${polyline.partClass}`)
                          : t('sperm.unclassified')}
                      </span>
                      <span className="text-gray-400">
                        {polyline.points.length} pts
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Unassigned polylines */}
        {instanceGroups.has('unassigned') && (
          <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('sperm.unassigned')}
            </div>
            {instanceGroups.get('unassigned')!.map(polyline => (
              <button
                key={polyline.id}
                className={`w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors ${
                  selectedPolygonId === polyline.id
                    ? 'bg-violet-100 dark:bg-violet-900/30'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                onClick={() =>
                  onSelectPolygon(
                    selectedPolygonId === polyline.id ? null : polyline.id
                  )
                }
              >
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                <span className="flex-1 text-left">
                  {polyline.name || polyline.id.substring(0, 8)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SpermInstancePanel;
