
import { useState, useEffect } from 'react';
import type { ProjectImage } from '@/types';

type SortField = 'name' | 'updatedAt' | 'segmentationStatus';
type SortDirection = 'asc' | 'desc';

export const useImageFilter = (images: ProjectImage[]) => {
  const [filteredImages, setFilteredImages] = useState<ProjectImage[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    let result = [...images];
    
    if (searchTerm) {
      result = result.filter(img => 
        img.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'updatedAt':
          comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
          break;
        case 'segmentationStatus':
          const statusOrder = { completed: 1, processing: 2, pending: 3, failed: 4 };
          comparison = statusOrder[a.segmentationStatus] - statusOrder[b.segmentationStatus];
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    setFilteredImages(result);
  }, [images, searchTerm, sortField, sortDirection]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return {
    filteredImages,
    searchTerm,
    sortField,
    sortDirection,
    handleSearch,
    handleSort
  };
};
