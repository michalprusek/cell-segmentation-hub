import { createContext } from 'react';
import { SegmentationResult } from '@/lib/segmentation';

export interface SegmentationContextType {
  segmentation: SegmentationResult | null;
}

export const SegmentationContext = createContext<SegmentationContextType>({
  segmentation: null,
});
