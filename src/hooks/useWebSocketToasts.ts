import { useEffect } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import { webSocketEventEmitter, WebSocketEvent } from '@/lib/websocketEvents';

/**
 * Hook that handles WebSocket-related toast messages
 * This is separate from WebSocketManager to avoid circular dependency with LanguageContext
 */
export function useWebSocketToasts() {
  const { t } = useLanguage();

  useEffect(() => {
    const handleWebSocketEvent = (event: WebSocketEvent) => {
      switch (event.type) {
        case 'reconnecting':
          toast.error(t('websocket.reconnecting'));
          break;

        case 'reconnected':
          toast.success(t('websocket.reconnected'));
          break;

        default:
          break;
      }
    };

    // Subscribe to all websocket events
    webSocketEventEmitter.on('reconnecting', handleWebSocketEvent);
    webSocketEventEmitter.on('reconnected', handleWebSocketEvent);

    return () => {
      // Cleanup
      webSocketEventEmitter.off('reconnecting', handleWebSocketEvent);
      webSocketEventEmitter.off('reconnected', handleWebSocketEvent);
    };
  }, [t]);
}
