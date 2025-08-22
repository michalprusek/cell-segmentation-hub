import { useContext } from 'react';
import { ModelContext } from './ModelContext.types';

export const useModel = () => {
  const context = useContext(ModelContext);
  if (context === undefined) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
};
