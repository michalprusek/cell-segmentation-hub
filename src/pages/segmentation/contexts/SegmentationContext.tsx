import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import {
  SegmentationContext,
  type SegmentationContextType,
} from './SegmentationContext.types';

// useSegmentationContext is exported from './useSegmentationContext' to avoid Fast Refresh warnings

interface SegmentationProviderProps {
  children: React.ReactNode;
  segmentation: SegmentationResult | null;
}

export const SegmentationProvider: React.FC<SegmentationProviderProps> = ({
  children,
  segmentation,
}) => {
  return (
    <SegmentationContext.Provider value={{ segmentation }}>
      {children}
    </SegmentationContext.Provider>
  );
};
