import { createContext } from 'react';
import { Socket } from 'socket.io-client';
import WebSocketManager from '@/services/webSocketManager';

export interface WebSocketContextType {
  manager: WebSocketManager | null;
  socket: Socket | null;
  isConnected: boolean;
}

export const WebSocketContext = createContext<WebSocketContextType | undefined>(
  undefined
);
