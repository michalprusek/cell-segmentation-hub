
import React, { createContext, useContext } from 'react';
import { SegmentationResult } from '@/lib/segmentation';

interface SegmentationContextType {
  segmentation: SegmentationResult | null;
}

const SegmentationContext = createContext<SegmentationContextType>({
  segmentation: null
});

// eslint-disable-next-line react-refresh/only-export-components
export const useSegmentationContext = () => useContext(SegmentationContext);

interface SegmentationProviderProps {
  children: React.ReactNode;
  segmentation: SegmentationResult | null;
}

export const SegmentationProvider: React.FC<SegmentationProviderProps> = ({ 
  children, 
  segmentation 
}) => {
  return (
    <SegmentationContext.Provider value={{ segmentation }}>
      {children}
    </SegmentationContext.Provider>
  );
};
