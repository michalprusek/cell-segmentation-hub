import { useReducer, useCallback } from 'react';

// State interface for ProjectDetail component
export interface ProjectDetailState {
  showUploader: boolean;
  viewMode: 'grid' | 'list';
  batchSubmitted: boolean;
  isCancelling: boolean;
  userHasQueueItems: boolean;
  selectedImageIds: Set<string>;
  showDeleteDialog: boolean;
  isBatchDeleting: boolean;
  shouldNavigateOnComplete: boolean;
  navigationTargetImageId: string | null;
}

// Action types
export type ProjectDetailAction =
  | { type: 'TOGGLE_UPLOADER' }
  | { type: 'SET_VIEW_MODE'; payload: 'grid' | 'list' }
  | { type: 'SET_BATCH_SUBMITTED'; payload: boolean }
  | { type: 'SET_CANCELLING'; payload: boolean }
  | { type: 'SET_USER_HAS_QUEUE_ITEMS'; payload: boolean }
  | { type: 'SET_SELECTED_IMAGE_IDS'; payload: Set<string> }
  | { type: 'TOGGLE_IMAGE_SELECTION'; payload: { imageId: string; selected: boolean } }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECT_ALL'; payload: string[] }
  | { type: 'SET_SHOW_DELETE_DIALOG'; payload: boolean }
  | { type: 'SET_BATCH_DELETING'; payload: boolean }
  | { type: 'SET_NAVIGATION'; payload: { shouldNavigate: boolean; targetImageId?: string | null } }
  | { type: 'RESET_BATCH_STATE' }
  | { type: 'RESET_NAVIGATION' };

// Initial state
export const initialProjectDetailState: ProjectDetailState = {
  showUploader: false,
  viewMode: 'grid',
  batchSubmitted: false,
  isCancelling: false,
  userHasQueueItems: false,
  selectedImageIds: new Set(),
  showDeleteDialog: false,
  isBatchDeleting: false,
  shouldNavigateOnComplete: false,
  navigationTargetImageId: null,
};

// Reducer function
export function projectDetailReducer(
  state: ProjectDetailState,
  action: ProjectDetailAction
): ProjectDetailState {
  switch (action.type) {
    case 'TOGGLE_UPLOADER':
      return {
        ...state,
        showUploader: !state.showUploader,
      };

    case 'SET_VIEW_MODE':
      return {
        ...state,
        viewMode: action.payload,
      };

    case 'SET_BATCH_SUBMITTED':
      return {
        ...state,
        batchSubmitted: action.payload,
      };

    case 'SET_CANCELLING':
      return {
        ...state,
        isCancelling: action.payload,
      };

    case 'SET_USER_HAS_QUEUE_ITEMS':
      return {
        ...state,
        userHasQueueItems: action.payload,
      };

    case 'SET_SELECTED_IMAGE_IDS':
      return {
        ...state,
        selectedImageIds: action.payload,
      };

    case 'TOGGLE_IMAGE_SELECTION': {
      const newSelectedIds = new Set(state.selectedImageIds);
      if (action.payload.selected) {
        newSelectedIds.add(action.payload.imageId);
      } else {
        newSelectedIds.delete(action.payload.imageId);
      }
      return {
        ...state,
        selectedImageIds: newSelectedIds,
      };
    }

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedImageIds: new Set(),
      };

    case 'SELECT_ALL':
      return {
        ...state,
        selectedImageIds: new Set(action.payload),
      };

    case 'SET_SHOW_DELETE_DIALOG':
      return {
        ...state,
        showDeleteDialog: action.payload,
      };

    case 'SET_BATCH_DELETING':
      return {
        ...state,
        isBatchDeleting: action.payload,
      };

    case 'SET_NAVIGATION':
      return {
        ...state,
        shouldNavigateOnComplete: action.payload.shouldNavigate,
        navigationTargetImageId: action.payload.targetImageId || null,
      };

    case 'RESET_BATCH_STATE':
      return {
        ...state,
        batchSubmitted: false,
        userHasQueueItems: false,
        isCancelling: false,
      };

    case 'RESET_NAVIGATION':
      return {
        ...state,
        shouldNavigateOnComplete: false,
        navigationTargetImageId: null,
      };

    default:
      return state;
  }
}

// Custom hook that provides reducer and action creators
export function useProjectDetailReducer() {
  const [state, dispatch] = useReducer(projectDetailReducer, initialProjectDetailState);

  // Action creators
  const actions = {
    toggleUploader: useCallback(() => dispatch({ type: 'TOGGLE_UPLOADER' }), []),

    setViewMode: useCallback((mode: 'grid' | 'list') =>
      dispatch({ type: 'SET_VIEW_MODE', payload: mode }), []),

    setBatchSubmitted: useCallback((submitted: boolean) =>
      dispatch({ type: 'SET_BATCH_SUBMITTED', payload: submitted }), []),

    setCancelling: useCallback((cancelling: boolean) =>
      dispatch({ type: 'SET_CANCELLING', payload: cancelling }), []),

    setUserHasQueueItems: useCallback((hasItems: boolean) =>
      dispatch({ type: 'SET_USER_HAS_QUEUE_ITEMS', payload: hasItems }), []),

    setSelectedImageIds: useCallback((ids: Set<string>) =>
      dispatch({ type: 'SET_SELECTED_IMAGE_IDS', payload: ids }), []),

    toggleImageSelection: useCallback((imageId: string, selected: boolean) =>
      dispatch({ type: 'TOGGLE_IMAGE_SELECTION', payload: { imageId, selected } }), []),

    clearSelection: useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), []),

    selectAll: useCallback((imageIds: string[]) =>
      dispatch({ type: 'SELECT_ALL', payload: imageIds }), []),

    setShowDeleteDialog: useCallback((show: boolean) =>
      dispatch({ type: 'SET_SHOW_DELETE_DIALOG', payload: show }), []),

    setBatchDeleting: useCallback((deleting: boolean) =>
      dispatch({ type: 'SET_BATCH_DELETING', payload: deleting }), []),

    setNavigation: useCallback((shouldNavigate: boolean, targetImageId?: string | null) =>
      dispatch({ type: 'SET_NAVIGATION', payload: { shouldNavigate, targetImageId } }), []),

    resetBatchState: useCallback(() => dispatch({ type: 'RESET_BATCH_STATE' }), []),

    resetNavigation: useCallback(() => dispatch({ type: 'RESET_NAVIGATION' }), []),
  };

  return { state, actions };
}