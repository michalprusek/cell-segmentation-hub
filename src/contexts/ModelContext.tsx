import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';

export type ModelType = 'hrnet' | 'resunet_small' | 'resunet_advanced';

export interface ModelInfo {
  id: ModelType;
  name: string;
  displayName: string;
  description: string;
  size: 'small' | 'medium' | 'large';
  defaultThreshold: number;
}

interface ModelContextType {
  selectedModel: ModelType;
  confidenceThreshold: number;
  setSelectedModel: (model: ModelType) => void;
  setConfidenceThreshold: (threshold: number) => void;
  getModelInfo: (modelId: ModelType) => ModelInfo;
  availableModels: ModelInfo[];
}

const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'hrnet',
    name: 'HRNet',
    displayName: 'HRNet (small)',
    description: 'Fast and efficient model for real-time segmentation',
    size: 'small',
    defaultThreshold: 0.5,
  },
  {
    id: 'resunet_small',
    name: 'ResUNet Small',
    displayName: 'ResUNet Small (medium)',
    description: 'Balanced speed and accuracy',
    size: 'medium',
    defaultThreshold: 0.5,
  },
  {
    id: 'resunet_advanced',
    name: 'ResUNet Advanced',
    displayName: 'ResUNet Advanced (large)',
    description: 'Highest accuracy with attention mechanisms',
    size: 'large',
    defaultThreshold: 0.5,
  },
];

const ModelContext = createContext<ModelContextType>({
  selectedModel: 'hrnet',
  confidenceThreshold: 0.5,
  setSelectedModel: () => {},
  setConfidenceThreshold: () => {},
  getModelInfo: () => AVAILABLE_MODELS[0],
  availableModels: AVAILABLE_MODELS,
});

interface ModelProviderProps {
  children: ReactNode;
}

export const ModelProvider: React.FC<ModelProviderProps> = ({ children }) => {
  const [selectedModel, setSelectedModelState] = useState<ModelType>('hrnet');
  const [confidenceThreshold, setConfidenceThresholdState] =
    useState<number>(0.5);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedModel = localStorage.getItem('selectedModel') as ModelType;
    const savedThreshold = localStorage.getItem('confidenceThreshold');

    if (savedModel && AVAILABLE_MODELS.some(m => m.id === savedModel)) {
      setSelectedModelState(savedModel);
    }

    if (savedThreshold) {
      const threshold = parseFloat(savedThreshold);
      if (threshold >= 0 && threshold <= 1) {
        setConfidenceThresholdState(threshold);
      }
    }
  }, []);

  const setSelectedModel = (model: ModelType) => {
    setSelectedModelState(model);
    localStorage.setItem('selectedModel', model);
  };

  const setConfidenceThreshold = (threshold: number) => {
    // Ensure threshold is between 0 and 1
    const normalizedThreshold = Math.max(0, Math.min(1, threshold));
    setConfidenceThresholdState(normalizedThreshold);
    localStorage.setItem('confidenceThreshold', normalizedThreshold.toString());
  };

  const getModelInfo = (modelId: ModelType): ModelInfo => {
    return (
      AVAILABLE_MODELS.find(model => model.id === modelId) ||
      AVAILABLE_MODELS[0]
    );
  };

  return (
    <ModelContext.Provider
      value={{
        selectedModel,
        confidenceThreshold,
        setSelectedModel,
        setConfidenceThreshold,
        getModelInfo,
        availableModels: AVAILABLE_MODELS,
      }}
    >
      {children}
    </ModelContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useModel = () => {
  const context = useContext(ModelContext);
  if (context === undefined) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
};
