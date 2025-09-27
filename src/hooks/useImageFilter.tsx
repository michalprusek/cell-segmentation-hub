import { useState, useEffect as _useEffect, useMemo } from 'react';
import type { ProjectImage } from '@/types';
import { logger } from '@/lib/logger';
import { normalizeText } from '@/lib/textUtils';

type SortField = 'name' | 'updatedAt' | 'segmentationStatus';
type SortDirection = 'asc' | 'desc';

const STORAGE_KEY = 'image-filter-settings';

interface FilterSettings {
  sortField: SortField;
  sortDirection: SortDirection;
}

const getStoredSettings = (): FilterSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logger.warn('Failed to load filter settings from localStorage:', error);
  }
  return { sortField: 'updatedAt', sortDirection: 'desc' };
};

const saveSettings = (settings: FilterSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    logger.warn('Failed to save filter settings to localStorage:', error);
  }
};

const getImageComparator = (settings?: FilterSettings) => {
  const { sortField, sortDirection } = settings || getStoredSettings();

  return (a: ProjectImage, b: ProjectImage): number => {
    let comparison = 0;

    switch (sortField) {
      case 'name':
        comparison = (a.name || '').localeCompare(b.name || '');
        break;
      case 'updatedAt':
        comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
        break;
      case 'segmentationStatus': {
        const statusOrder = {
          completed: 1,
          processing: 2,
          pending: 3,
          failed: 4,
        };
        comparison =
          statusOrder[a.segmentationStatus] - statusOrder[b.segmentationStatus];
        break;
      }
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  };
};

export const useImageFilter = (images: ProjectImage[]) => {
  const [searchTerm, setSearchTerm] = useState<string>('');

  const storedSettings = getStoredSettings();
  const [sortField, setSortField] = useState<SortField>(
    storedSettings.sortField
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    storedSettings.sortDirection
  );

  // Use useMemo to prevent infinite loops and unnecessary recalculations
  const filteredImages = useMemo(() => {
    let result = [...images];

    if (searchTerm) {
      result = result.filter(img =>
        normalizeText(img.name)
          ?.toLowerCase()
          .includes(normalizeText(searchTerm).toLowerCase())
      );
    }

    result.sort(getImageComparator({ sortField, sortDirection }));

    return result;
  }, [images, searchTerm, sortField, sortDirection]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleSort = (field: SortField) => {
    let newSortDirection: SortDirection;
    let newSortField: SortField;

    if (field === sortField) {
      newSortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      newSortField = field;
    } else {
      newSortField = field;
      newSortDirection = 'asc';
    }

    setSortField(newSortField);
    setSortDirection(newSortDirection);
    saveSettings({ sortField: newSortField, sortDirection: newSortDirection });
  };

  return {
    filteredImages,
    searchTerm,
    sortField,
    sortDirection,
    handleSearch,
    handleSort,
  };
};

export const getImageSortSettings = getStoredSettings;
export { getImageComparator };

export const sortImagesBySettings = (
  images: ProjectImage[],
  settings?: FilterSettings
): ProjectImage[] => {
  return [...images].sort(getImageComparator(settings));
};
