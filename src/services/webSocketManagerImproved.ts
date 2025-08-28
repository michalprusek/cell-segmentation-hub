import { io, Socket } from 'socket.io-client';
import { logger } from '@/lib/logger';
import config from '@/lib/config';
import { webSocketEventEmitter } from '@/lib/websocketEvents';
import type {
  WebSocketEventMap,
  SegmentationUpdate,
  QueueStats,
  SegmentationStatusMessage,
  QueueStatsMessage,
  SegmentationCompletedMessage,
  SegmentationFailedMessage,
  WebSocketConnectionOptions,
  IWebSocketManager,
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

// Event listener types
type EventListener<T = any> = (data: T) => void;

interface EventListenerRegistry {
  [event: string]: Set<EventListener>;
}

/**
 * ImprovedWebSocketManager - Enhanced version with better memory management,
 * error handling, and reliability improvements
 */
class ImprovedWebSocketManager implements IWebSocketManager {
  private static instance: ImprovedWebSocketManager | null = null;
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
  private connectionTimeout: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    this.eventListeners = {
      'segmentation-update': new Set(),
      'queue-stats-update': new Set(),
      notification: new Set(),
      'system-message': new Set(),
      connect: new Set(),
      disconnect: new Set(),
      connect_error: new Set(),
    };

    // Bind methods to preserve context
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);

    // Add event listeners for better lifecycle management
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
      document.addEventListener(
        'visibilitychange',
        this.handleVisibilityChange
      );
    }
  }

  static getInstance(): ImprovedWebSocketManager {
    if (!ImprovedWebSocketManager.instance) {
      ImprovedWebSocketManager.instance = new ImprovedWebSocketManager();
    }
    return ImprovedWebSocketManager.instance;
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
        `Switching WebSocket user from ${this.currentUser?.id} to ${user.id}`
      );
      this.disconnect();
    }

    // Prevent multiple concurrent connection attempts
    if (this.isConnecting) {
      logger.debug('WebSocket connection already in progress, waiting...');
      return this.waitForConnection();
    }

    this.isConnecting = true;
    this.currentUser = user;

    try {
      await this.createConnection();
    } finally {
      this.isConnecting = false;
    }
  }

  private async waitForConnection(): Promise<void> {
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
            reject(new Error('Connection failed'));
          }
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });
  }

  private async createConnection(): Promise<void> {
    if (!this.currentUser) {
      throw new Error('No user credentials provided');
    }

    // Clear any existing timeouts
    this.clearTimeouts();

    // For relative API URLs, use the current location origin
    let serverUrl: string;
    if (config.apiBaseUrl.startsWith('/')) {
      // Use current location for relative URLs
      serverUrl = window.location?.origin || 'http://localhost:3000';
    } else {
      // Use absolute URL, removing /api suffix
      serverUrl = config.apiBaseUrl.replace('/api', '');
    }

    logger.info('Creating improved WebSocket connection to:', serverUrl);

    this.socket = io(serverUrl, {
      auth: {
        token: this.currentUser.token,
      },
      transports: ['websocket', 'polling'],
      reconnection: true, // Enable automatic reconnection
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: this.maxReconnectDelay,
      timeout: 10000,
      autoConnect: true,
      forceNew: false, // Reuse existing connection if possible
      upgrade: true,
    });

    this.setupEventHandlers();
    this.isInitialized = true;

    return new Promise((resolve, reject) => {
      this.connectionTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 15000);

      this.socket!.on('connect', () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
        resolve();
      });

      this.socket!.on('connect_error', error => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
        reject(error);
      });
    });
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      logger.info('ImprovedWebSocket CONNECTED! Socket ID:', this.socket?.id);
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.flushMessageQueue();
      this.emitToListeners('connect');

      // Start ping interval to keep connection alive
      this.startPingInterval();
    });

    this.socket.on('disconnect', reason => {
      logger.info('ImprovedWebSocket DISCONNECTED! Reason:', reason);
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
      logger.error('ImprovedWebSocket CONNECTION ERROR:', error.message);
      this.emitToListeners('connect_error', error);

      // Show toast only occasionally to avoid spam
      this.maybeShowConnectionError();
    });

    this.socket.on('error', error => {
      logger.error('ImprovedWebSocket ERROR:', error);
    });

    // Enhanced reconnection event handlers
    this.socket.io.on('reconnect', (attempt: number) => {
      logger.info(`ImprovedWebSocket reconnected after ${attempt} attempts`);
      webSocketEventEmitter.emit({ type: 'reconnected' });
    });

    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      logger.debug(`ImprovedWebSocket reconnection attempt #${attempt}`);
    });

    this.socket.io.on('reconnect_error', (error: Error) => {
      logger.error('ImprovedWebSocket reconnection error:', error.message);
    });

    this.socket.io.on('reconnect_failed', () => {
      logger.error('ImprovedWebSocket reconnection failed after all attempts');
      webSocketEventEmitter.emit({ type: 'reconnect_failed' });
    });

    // Data events with improved error handling
    this.setupDataEventHandlers();
  }

  private setupDataEventHandlers(): void {
    if (!this.socket) return;

    // Segmentation updates
    this.socket.on('segmentationUpdate', (update: SegmentationUpdate) => {
      try {
        logger.debug('🔴 SEGMENTATION UPDATE RECEIVED:', {
          imageId: update.imageId,
          status: update.status,
          timestamp: new Date().toISOString(),
        });

        this.emitToListeners('segmentation-update', update);
      } catch (error) {
        logger.error('Error handling segmentation update:', error);
      }
    });

    // Queue stats
    this.socket.on('queueStats', (stats: QueueStats) => {
      try {
        this.emitToListeners('queue-stats-update', stats);
      } catch (error) {
        logger.error('Error handling queue stats:', error);
      }
    });

    // Segmentation completed
    this.socket.on(
      'segmentationCompleted',
      (data: SegmentationCompletedMessage) => {
        try {
          const notification: Notification = {
            type: 'segmentation-complete',
            polygonCount: data.polygonCount || 0,
          };
          this.emitToListeners('notification', notification);
        } catch (error) {
          logger.error('Error handling segmentation completed:', error);
        }
      }
    );

    // Segmentation failed
    this.socket.on('segmentationFailed', (data: SegmentationFailedMessage) => {
      try {
        const message: SystemMessage = {
          type: 'error',
          message: data.error || 'Segmentation failed',
        };
        this.emitToListeners('system-message', message);
      } catch (error) {
        logger.error('Error handling segmentation failed:', error);
      }
    });

    // Generic events
    this.socket.on('notification', (notification: Notification) => {
      try {
        this.emitToListeners('notification', notification);
      } catch (error) {
        logger.error('Error handling notification:', error);
      }
    });

    this.socket.on('system-message', (message: SystemMessage) => {
      try {
        this.emitToListeners('system-message', message);
      } catch (error) {
        logger.error('Error handling system message:', error);
      }
    });
  }

  private maybeShowConnectionError(): void {
    const now = Date.now();
    if (now - this.lastToastTime > this.toastCooldown) {
      if (this.reconnectAttempts > 2) {
        webSocketEventEmitter.emit({ type: 'reconnecting' });
      }
      this.lastToastTime = now;
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
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

    this.reconnectTimeout = setTimeout(async () => {
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
    if (listeners && listeners.size > 0) {
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

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private clearTimeouts(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private handleBeforeUnload(): void {
    this.disconnect();
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Page is hidden, reduce activity
      logger.debug('Page hidden, reducing WebSocket activity');
    } else {
      // Page is visible again, ensure connection is healthy
      logger.debug('Page visible, checking WebSocket connection');
      if (this.currentUser && !this.socket?.connected) {
        this.connect(this.currentUser).catch(error => {
          logger.error('Failed to reconnect on visibility change:', error);
        });
      }
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
   * Disconnect and cleanup
   */
  disconnect(): void {
    logger.info('Disconnecting ImprovedWebSocket manager');

    this.stopPingInterval();
    this.clearTimeouts();

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
    if (ImprovedWebSocketManager.instance) {
      ImprovedWebSocketManager.instance.disconnect();

      // Remove event listeners
      if (typeof window !== 'undefined') {
        window.removeEventListener(
          'beforeunload',
          ImprovedWebSocketManager.instance.handleBeforeUnload
        );
        document.removeEventListener(
          'visibilitychange',
          ImprovedWebSocketManager.instance.handleVisibilityChange
        );
      }

      ImprovedWebSocketManager.instance = null;
    }
  }
}

// Auto-cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    ImprovedWebSocketManager.cleanup();
  });
}

export default ImprovedWebSocketManager;
