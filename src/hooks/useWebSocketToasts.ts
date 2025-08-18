import { useEffect } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
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

        case 'reconnect_failed':
          toast.error(t('websocket.reconnectFailed'));
          break;

        case 'connection_lost':
          toast.error(t('websocket.connectionLost'));
          break;

        case 'polling_mode':
          toast.info(t('websocket.pollingMode'), { duration: 3000 });
          break;

        case 'websocket_upgrade':
          toast.success(t('websocket.upgradedToWebSocket'), { duration: 2000 });
          break;

        case 'connection_error':
          toast.error(
            t('websocket.connectionError') +
              (event.message ? `: ${event.message}` : '')
          );
          break;

        case 'auth_error':
          toast.error(
            t('websocket.authError') +
              (event.message ? `: ${event.message}` : '')
          );
          break;

        default:
          break;
      }
    };

    // Subscribe to all websocket events
    const eventTypes = [
      'reconnecting',
      'reconnected',
      'reconnect_failed',
      'connection_lost',
      'polling_mode',
      'websocket_upgrade',
      'connection_error',
      'auth_error',
    ];

    eventTypes.forEach(eventType => {
      webSocketEventEmitter.on(eventType, handleWebSocketEvent);
    });

    return () => {
      // Cleanup all event listeners
      eventTypes.forEach(eventType => {
        webSocketEventEmitter.off(eventType, handleWebSocketEvent);
      });
    };
  }, [t]);
}
