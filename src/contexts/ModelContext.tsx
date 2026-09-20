import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  ReactNode,
  useContext,
} from 'react';
import { ModelContext } from './ModelContext.types';
import { AuthContext } from './AuthContext.types';

interface ModelProviderProps {
  children: ReactNode;
}

const getUserStorageKey = (userId: string | undefined, key: string): string => {
  return userId ? `user_${userId}_${key}` : `guest_${key}`;
};

/**
 * Hole detection — the last per-user segmentation preference.
 *
 * This provider used to hold the selected model and its threshold too. Both
 * moved onto the PROJECT (`projects.segmentationModel`, resolved by
 * `useProjectModel`): a single global model had no relationship to the project
 * being segmented, and six of the seven project types accept exactly one
 * model, so the global value could only ever be right by luck. The stale
 * `user_<id>_selectedModel` key is deliberately left unread rather than
 * migrated — there is nowhere to migrate it TO, since one value cannot
 * describe projects of different types.
 *
 * `detectHoles` stays global because it is not a property of the project: it
 * decides whether an internal hole in the mask becomes a hole polygon or is
 * filled in (`detect_holes` in `model_loader.py`), which is a preference about
 * how the user wants to annotate, not about what is being annotated. Its
 * control lives in the project page's model menu.
 */
export const ModelProvider: React.FC<ModelProviderProps> = ({ children }) => {
  const { user } = useContext(AuthContext);
  const [detectHoles, setDetectHolesState] = useState<boolean>(true);

  useEffect(() => {
    const userId = user?.id;
    const savedDetectHoles = localStorage.getItem(
      getUserStorageKey(userId, 'detectHoles')
    );

    if (savedDetectHoles !== null) {
      setDetectHolesState(savedDetectHoles === 'true');
    }
  }, [user?.id]);

  const setDetectHoles = useCallback(
    (detectHoles: boolean) => {
      const userId = user?.id;
      setDetectHolesState(detectHoles);
      localStorage.setItem(
        getUserStorageKey(userId, 'detectHoles'),
        detectHoles.toString()
      );
    },
    [user?.id]
  );

  const value = useMemo(
    () => ({
      detectHoles,
      setDetectHoles,
    }),
    [detectHoles, setDetectHoles]
  );

  return (
    <ModelContext.Provider value={value}>{children}</ModelContext.Provider>
  );
};
