import { io, Socket } from 'socket.io-client';
import { logger } from '@/lib/logger';
import config from '@/lib/config';
import { webSocketEventEmitter } from '@/lib/websocketEvents';
import type {
  SegmentationUpdate,
  QueueStats,
  SegmentationCompletedMessage,
  SegmentationFailedMessage,
} from '@/types/websocket';

// Define internal message types for backward compatibility
interface Notification {
  type: string;
  polygonCount?: number;
  message?: string;
}

interface SystemMessage {
  type: 'error' | 'warning' | 'info';
  message: string;
}

// Re-export types for backward compatibility
export type { SegmentationUpdate, QueueStats } from '@/types/websocket';

// Extend WebSocketManager class interface to include the private handler
interface WebSocketManagerWithHandler {
  _beforeUnloadHandler?: () => void;
}

// Define specific event listener types for backward compatibility
type EventListener<T = any> = (data: T) => void;
type EventListener =
  | SegmentationUpdateListener
  | QueueStatsUpdateListener
  | NotificationListener
  | SystemMessageListener
  | ConnectionListener
  | DisconnectionListener
  | ConnectionErrorListener;

interface EventListenerRegistry {
  [event: string]: Set<EventListener>;
}

class WebSocketManager {
  private static instance: WebSocketManager | null = null;
  private socket: Socket | null = null;
  private isConnecting = false;
  private isInitialized = false;
  private currentUser: { id: string; token: string } | null = null;
  private eventListeners: EventListenerRegistry = {};
  private messageQueue: Array<{ event: string; data: unknown }> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private lastToastTime = 0;
  private toastCooldown = 5000; // 5 seconds between similar toasts
  private pingInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.eventListeners = {
      'segmentation-update': new Set(),
      'queue-stats-update': new Set(),
      'parallel-processing-status': new Set(),
      notification: new Set(),
      'system-message': new Set(),
      connect: new Set(),
      disconnect: new Set(),
      connect_error: new Set(),
    };
  }

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  /**
   * Initialize connection with user credentials
   */
  async connect(user: { id: string; token: string }): Promise<void> {
    // If already connected with same user, don't reconnect
    if (
      this.socket?.connected &&
      this.currentUser?.id === user.id &&
      this.currentUser?.token === user.token
    ) {
      logger.debug('WebSocket already connected for user:', user.id);
      return;
    }

    // If connecting with different user, disconnect first
    if (this.socket && this.currentUser?.id !== user.id) {
      logger.info(
        'Switching WebSocket user from ' +
          this.currentUser?.id +
          ' to ' +
          user.id
      );
      this.disconnect();
    }

    // Prevent multiple concurrent connection attempts
    if (this.isConnecting) {
      logger.debug('WebSocket connection already in progress, waiting...');
      return new Promise((resolve, reject) => {
        const maxWaitTime = 30000; // 30 seconds max wait
        const startTime = Date.now();

        const checkConnection = () => {
          const elapsed = Date.now() - startTime;

          // Timeout if waiting too long
          if (elapsed > maxWaitTime) {
            reject(new Error('Connection wait timeout'));
            return;
          }

          if (!this.isConnecting) {
            if (this.socket?.connected) {
              resolve();
            } else {
              setTimeout(checkConnection, 100);
            }
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    }

    this.isConnecting = true;
    this.currentUser = user;

    try {
      await this.createConnection();
    } finally {
      this.isConnecting = false;
    }
  }

  private async createConnection(): Promise<void> {
    if (!this.currentUser) {
      throw new Error('No user credentials provided');
    }

    // For relative API URLs, use the current location origin
    let serverUrl: string;
    if (config.apiBaseUrl.startsWith('/')) {
      // Use current location for relative URLs
      serverUrl = window.location.origin;
    } else {
      // Use absolute URL, removing /api suffix
      serverUrl = config.apiBaseUrl.replace('/api', '');
    }

    logger.info('Creating WebSocket connection to:', serverUrl);

    this.socket = io(serverUrl, {
      auth: {
        token: this.currentUser.token,
      },
      transports: ['websocket', 'polling'],
      reconnection: true, // Enable automatic reconnection
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      autoConnect: true,
    });

    this.setupEventHandlers();
    this.isInitialized = true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 15000);

      this.socket!.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket!.on('connect_error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      logger.info('WebSocket CONNECTED! Socket ID:', this.socket?.id);
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.flushMessageQueue();
      this.emitToListeners('connect');

      // Start ping interval to keep connection alive
      this.startPingInterval();
    });

    this.socket.on('disconnect', reason => {
      logger.info('WebSocket DISCONNECTED! Reason:', reason);
      this.emitToListeners('disconnect', reason);

      // Stop ping interval when disconnected
      this.stopPingInterval();

      // Socket.io will handle automatic reconnection for most cases
      // We only manually reconnect for specific server-side disconnects
      if (reason === 'io server disconnect') {
        // Server forcefully disconnected us, try manual reconnect
        this.handleReconnect();
      }
      // For 'transport close', 'ping timeout' etc., Socket.io will auto-reconnect
    });

    this.socket.on('connect_error', error => {
      logger.error('WebSocket CONNECTION ERROR:', error.message);
      this.emitToListeners('connect_error', error);

      // Show toast only occasionally to avoid spam and not during auto-reconnect
      const now = Date.now();
      if (now - this.lastToastTime > this.toastCooldown) {
        if (
          !error.message.includes('Authentication') &&
          this.reconnectAttempts > 2
        ) {
          // Only show toast after a few failed attempts
          // Emit event for localized toast (handled by useWebSocketToasts hook)
          webSocketEventEmitter.emit({ type: 'reconnecting' });
        }
        this.lastToastTime = now;
      }

      // Socket.io will handle reconnection automatically
      // We don't need to call handleReconnect() here
    });

    this.socket.on('error', error => {
      logger.error('WebSocket ERROR:', error);
    });

    // Add reconnection event handlers for better debugging
    this.socket.io.on('reconnect', (attempt: number) => {
      logger.info(`WebSocket reconnected after ${attempt} attempts`);
      // Emit event for localized toast (handled by useWebSocketToasts hook)
      webSocketEventEmitter.emit({ type: 'reconnected' });
    });

    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      logger.debug(`WebSocket reconnection attempt #${attempt}`);
    });

    this.socket.io.on('reconnect_error', (error: Error) => {
      logger.error('WebSocket reconnection error:', error.message);
    });

    this.socket.io.on('reconnect_failed', () => {
      logger.error('WebSocket reconnection failed after all attempts');
      // Emit event for localized toast (handled by useWebSocketToasts hook)
      webSocketEventEmitter.emit({ type: 'reconnect_failed' });
    });

    // Data events
    // Backend emits 'segmentationUpdate', we need to listen for that
    this.socket.on('segmentationUpdate', (update: SegmentationUpdate) => {
      // Only log detailed debug info in development mode and use debug level
      if (process.env.NODE_ENV === 'development') {
        const debugInfo = {
          imageId: update.imageId,
          status: update.status,
          hasSegmentationResult: !!(update as any).segmentationResult,
          segmentationResultKeys: (update as any).segmentationResult
            ? Object.keys((update as any).segmentationResult)
            : [],
          polygonCount: (update as any).segmentationResult?.polygonCount,
          timestamp: new Date().toISOString(),
        };
        logger.debug(
          `SEGMENTATION UPDATE RECEIVED: ${JSON.stringify(debugInfo, null, 2)}`
        );
        logger.debug('Full segmentation update:', update);
      } else {
        // In production, only log minimal info at debug level
        logger.debug(
          `Segmentation update: ${update.imageId} -> ${update.status}`
        );
      }

      // Keep emitting with hyphenated name for backward compatibility
      this.emitToListeners('segmentation-update', update);
    });

    // Backend emits 'queueStats', we need to listen for that
    this.socket.on('queueStats', (stats: QueueStats) => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Queue stats update received:', stats);
      }
      // Keep emitting with hyphenated name for backward compatibility
      this.emitToListeners('queue-stats-update', stats);
    });

    // Also listen for 'segmentationCompleted' event from backend
    this.socket.on(
      'segmentationCompleted',
      (data: SegmentationCompletedMessage) => {
        if (process.env.NODE_ENV === 'development') {
          logger.debug('Segmentation completed event received:', data);
        }
        // Convert to notification format for backward compatibility
        const notification: Notification = {
          type: 'segmentation-complete',
          polygonCount: data.polygonCount || 0,
        };
        this.emitToListeners('notification', notification);
      }
    );

    // Also listen for 'segmentationFailed' event from backend
    this.socket.on('segmentationFailed', (data: SegmentationFailedMessage) => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Segmentation failed event received:', data);
      }
      // Convert to system message for backward compatibility
      const message: SystemMessage = {
        type: 'error',
        message: data.error || 'Segmentation failed',
      };
      this.emitToListeners('system-message', message);
    });

    this.socket.on('notification', (notification: Notification) => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Notification received:', notification);
      }
      this.emitToListeners('notification', notification);
    });

    this.socket.on('system-message', (message: SystemMessage) => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('System message received:', message);
      }
      this.emitToListeners('system-message', message);
    });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      // Emit event for localized toast (handled by useWebSocketToasts hook)
      webSocketEventEmitter.emit({ type: 'connection_lost' });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    logger.info(
      `Attempting reconnect #${this.reconnectAttempts} in ${delay}ms`
    );

    setTimeout(async () => {
      if (this.currentUser && !this.socket?.connected) {
        try {
          await this.createConnection();
        } catch (error) {
          logger.error('Reconnection failed:', error);
        }
      }
    }, delay);
  }

  private emitToListeners(event: string, ...args: unknown[]): void {
    const listeners = this.eventListeners[event];
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          logger.error(
            `Error in WebSocket event listener for ${event}:`,
            error
          );
        }
      });
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.socket?.connected) {
      const { event, data } = this.messageQueue.shift()!;
      this.socket.emit(event, data);
    }
  }

  /**
   * Register event listener
   */
  on(event: string, listener: EventListener): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = new Set();
    }
    this.eventListeners[event].add(listener);
  }

  /**
   * Unregister event listener
   */
  off(event: string, listener: EventListener): void {
    if (this.eventListeners[event]) {
      this.eventListeners[event].delete(listener);
    }
  }

  /**
   * Emit event to server
   */
  emit(event: string, data?: unknown): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      // Queue message for when connection is restored
      this.messageQueue.push({ event, data });
      logger.debug(`Queued message: ${event}`, data);
    }
  }

  /**
   * Join project room
   */
  joinProject(projectId: string): void {
    logger.debug('Joining project room:', projectId);
    this.emit('join-project', projectId);
  }

  /**
   * Leave project room
   */
  leaveProject(projectId: string): void {
    logger.debug('Leaving project room:', projectId);
    this.emit('leave-project', projectId);
  }

  /**
   * Request queue stats for project
   */
  requestQueueStats(projectId: string): void {
    this.emit('request-queue-stats', projectId);
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Get current user
   */
  get user(): { id: string; token: string } | null {
    return this.currentUser;
  }

  /**
   * Get socket instance for direct access
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval(); // Clear any existing interval

    // Send ping every 25 seconds (Socket.io default timeout is 60s)
    this.pingInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping');
        logger.debug('Sent ping to keep connection alive');
      }
    }, 25000);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    logger.info('Disconnecting WebSocket manager');

    this.stopPingInterval();

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.currentUser = null;
    this.isInitialized = false;
    this.isConnecting = false;
    this.messageQueue = [];
    this.reconnectAttempts = 0;

    // Clear all event listeners
    Object.keys(this.eventListeners).forEach(event => {
      this.eventListeners[event].clear();
    });
  }

  /**
   * Clean shutdown
   */
  static cleanup(): void {
    if (WebSocketManager.instance) {
      WebSocketManager.instance.disconnect();
      WebSocketManager.instance = null;
    }

    // Remove beforeunload listener if it exists
    if (
      typeof window !== 'undefined' &&
      '_beforeUnloadHandler' in WebSocketManager
    ) {
      const managerWithHandler = WebSocketManager as typeof WebSocketManager &
        WebSocketManagerWithHandler;
      if (managerWithHandler._beforeUnloadHandler) {
        window.removeEventListener(
          'beforeunload',
          managerWithHandler._beforeUnloadHandler
        );
        delete managerWithHandler._beforeUnloadHandler;
      }
    }
  }
}

// Auto-cleanup on page unload with proper listener management
if (typeof window !== 'undefined') {
  const handleBeforeUnload = () => {
    WebSocketManager.cleanup();
  };

  // Add listener
  window.addEventListener('beforeunload', handleBeforeUnload);

  // Store reference to remove listener if needed
  (
    WebSocketManager as typeof WebSocketManager & WebSocketManagerWithHandler
  )._beforeUnloadHandler = handleBeforeUnload;
}

// Export the manager
export default WebSocketManager;
