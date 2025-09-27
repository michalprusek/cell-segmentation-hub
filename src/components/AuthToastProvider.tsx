import React from 'react';
import { useAuthToasts } from '@/hooks/useAuthToasts';
import { useWebSocketToasts } from '@/hooks/useWebSocketToasts';

interface ToastEventProviderProps {
  children: React.ReactNode;
}

/**
 * Component that sets up auth and websocket toast event listeners
 * Must be used inside LanguageProvider to have access to translation context
 */
export function ToastEventProvider({ children }: ToastEventProviderProps) {
  useAuthToasts();
  useWebSocketToasts();
  return <>{children}</>;
}
