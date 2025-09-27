import { useContext } from 'react';
import { SegmentationContext } from './SegmentationContext.types';

export const useSegmentationContext = () => useContext(SegmentationContext);
