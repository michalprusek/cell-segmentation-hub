import React, { useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useAuth } from './exports';
import WebSocketManager from '@/services/webSocketManager';
import { logger } from '@/lib/logger';
import {
  WebSocketContext,
  type WebSocketContextType,
} from './WebSocketContext.types';

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
  children,
}) => {
  const { user, token } = useAuth();
  const [isConnected, setIsConnected] = React.useState(false);
  const [socketInstance, setSocketInstance] = React.useState<Socket | null>(
    null
  );
  const managerRef = useRef<WebSocketManager | null>(null);
  const isInitializedRef = useRef(false);

  // Connection handler
  const onConnect = useRef(() => {
    setIsConnected(true);
    setSocketInstance(managerRef.current?.getSocket() || null);
  });

  const onDisconnect = useRef(() => {
    setIsConnected(false);
  });

  useEffect(() => {
    // Store current ref values to use in cleanup
    const connectHandler = onConnect.current;
    const disconnectHandler = onDisconnect.current;

    // Clean up when no auth
    if (!user || !token) {
      if (managerRef.current) {
        managerRef.current.off('connect', connectHandler);
        managerRef.current.off('disconnect', disconnectHandler);
        managerRef.current = null;
        setIsConnected(false);
        setSocketInstance(null);
      }
      isInitializedRef.current = false;
      return;
    }

    // Prevent duplicate initialization - set immediately to prevent race condition
    if (isInitializedRef.current) {
      return;
    }
    isInitializedRef.current = true;

    const initializeManager = async () => {
      try {
        const manager = WebSocketManager.getInstance();
        managerRef.current = manager;

        // Register connection event listeners
        manager.on('connect', connectHandler);
        manager.on('disconnect', disconnectHandler);

        // Connect to WebSocket
        await manager.connect({ id: user.id, token });

        // Update socket instance after connection
        setSocketInstance(manager.getSocket());

        logger.debug('WebSocketProvider - WebSocket manager initialized');
      } catch (error) {
        logger.error(
          'WebSocketProvider - Failed to initialize WebSocket manager:',
          error
        );
        // Reset flag on error to allow retry
        isInitializedRef.current = false;
      }
    };

    initializeManager();

    // Cleanup function - use stored ref values to ensure they're the same ones
    return () => {
      if (managerRef.current) {
        managerRef.current.off('connect', connectHandler);
        managerRef.current.off('disconnect', disconnectHandler);
      }
      isInitializedRef.current = false;
    };
  }, [user, token]);

  const value = {
    manager: managerRef.current,
    socket: socketInstance,
    isConnected,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketProvider;
// useWebSocket is exported from './exports' to avoid Fast Refresh warnings
