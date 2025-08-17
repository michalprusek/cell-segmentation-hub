/**
 * WebSocket events system to avoid circular dependency issues
 */

export interface WebSocketEvent {
  type: 'reconnecting' | 'reconnected' | 'reconnect_failed' | 'connection_lost';
  data?: {
    message?: string;
    attempts?: number;
  };
}

class WebSocketEventEmitter {
  private listeners: Map<string, ((event: WebSocketEvent) => void)[]> = new Map();

  emit(event: WebSocketEvent) {
    const eventListeners = this.listeners.get(event.type) || [];
    eventListeners.forEach(listener => listener(event));
  }

  on(eventType: string, listener: (event: WebSocketEvent) => void) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(listener);
  }

  off(eventType: string, listener: (event: WebSocketEvent) => void) {
    const eventListeners = this.listeners.get(eventType);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }
}

export const webSocketEventEmitter = new WebSocketEventEmitter();