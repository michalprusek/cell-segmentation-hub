import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';

export interface QueueStats {
  projectId: string;
  queued: number;
  processing: number;
  total: number;
}

export interface SegmentationUpdate {
  imageId: string;
  projectId: string;
  status: string;
  queueId?: string;
  progress?: number;
  error?: string;
}

interface Notification {
  type: string;
  imageId: string;
  projectId: string;
  polygonCount: number;
  timestamp: string;
}

interface SystemMessage {
  type: 'info' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

// Extend WebSocketManager class interface to include the private handler
interface WebSocketManagerWithHandler {
  _beforeUnloadHandler?: () => void;
}

// Define specific event listener types for each event
type SegmentationUpdateListener = (update: SegmentationUpdate) => void;
type QueueStatsUpdateListener = (stats: QueueStats) => void;
type NotificationListener = (notification: Notification) => void;
type SystemMessageListener = (message: SystemMessage) => void;
type ConnectionListener = () => void;
type DisconnectionListener = (reason: string) => void;
type ConnectionErrorListener = (error: Error) => void;

// Union type for all possible event listeners
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

  private constructor() {
    this.eventListeners = {
      'segmentation-update': new Set(),
      'queue-stats-update': new Set(),
      'notification': new Set(),
      'system-message': new Set(),
      'connect': new Set(),
      'disconnect': new Set(),
      'connect_error': new Set()
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
    if (this.socket?.connected && this.currentUser?.id === user.id && this.currentUser?.token === user.token) {
      console.log('WebSocket already connected for user:', user.id);
      return;
    }

    // If connecting with different user, disconnect first
    if (this.socket && this.currentUser?.id !== user.id) {
      console.log('Switching WebSocket user from', this.currentUser?.id, 'to', user.id);
      this.disconnect();
    }

    // Prevent multiple concurrent connection attempts
    if (this.isConnecting) {
      console.log('WebSocket connection already in progress, waiting...');
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

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
    const serverUrl = apiBaseUrl.replace('/api', '');
    
    console.log('🔄 Creating WebSocket connection to:', serverUrl);
    
    this.socket = io(serverUrl, {
      auth: {
        token: this.currentUser.token
      },
      transports: ['websocket', 'polling'],
      reconnection: false, // We'll handle reconnection manually
      timeout: 10000,
      autoConnect: true
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

      this.socket!.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      console.log('✅ WebSocket CONNECTED! Socket ID:', this.socket?.id);
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.flushMessageQueue();
      this.emitToListeners('connect');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ WebSocket DISCONNECTED! Reason:', reason);
      this.emitToListeners('disconnect', reason);
      
      // Auto-reconnect unless disconnect was intentional
      if (reason !== 'io client disconnect' && reason !== 'transport close') {
        this.handleReconnect();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('⚠️ WebSocket CONNECTION ERROR:', error.message);
      this.emitToListeners('connect_error', error);
      
      // Show toast only occasionally to avoid spam
      const now = Date.now();
      if (now - this.lastToastTime > this.toastCooldown) {
        if (!error.message.includes('Authentication')) {
          toast.error('Chyba připojení k serveru pro real-time aktualizace');
        }
        this.lastToastTime = now;
      }
      
      this.handleReconnect();
    });

    this.socket.on('error', (error) => {
      console.error('⚠️ WebSocket ERROR:', error);
    });

    // Data events
    this.socket.on('segmentation-update', (update: SegmentationUpdate) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('Segmentation update received:', update);
      }
      this.emitToListeners('segmentation-update', update);
    });

    this.socket.on('queue-stats-update', (stats: QueueStats) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('Queue stats update received:', stats);
      }
      this.emitToListeners('queue-stats-update', stats);
    });

    this.socket.on('notification', (notification: Notification) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('Notification received:', notification);
      }
      this.emitToListeners('notification', notification);
    });

    this.socket.on('system-message', (message: SystemMessage) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('System message received:', message);
      }
      this.emitToListeners('system-message', message);
    });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnection attempts reached');
      toast.error('Připojení k serveru se nepodařilo obnovit');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    
    console.log(`🔄 Attempting reconnect #${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      if (this.currentUser && !this.socket?.connected) {
        try {
          await this.createConnection();
        } catch (error) {
          console.error('Reconnection failed:', error);
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
          console.error(`Error in WebSocket event listener for ${event}:`, error);
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
      console.log(`Queued message: ${event}`, data);
    }
  }

  /**
   * Join project room
   */
  joinProject(projectId: string): void {
    console.log('Joining project room:', projectId);
    this.emit('join-project', projectId);
  }

  /**
   * Leave project room
   */
  leaveProject(projectId: string): void {
    console.log('Leaving project room:', projectId);
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
   * Disconnect and cleanup
   */
  disconnect(): void {
    console.log('Disconnecting WebSocket manager');
    
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
    if (typeof window !== 'undefined' && '_beforeUnloadHandler' in WebSocketManager) {
      const managerWithHandler = WebSocketManager as typeof WebSocketManager & WebSocketManagerWithHandler;
      if (managerWithHandler._beforeUnloadHandler) {
        window.removeEventListener('beforeunload', managerWithHandler._beforeUnloadHandler);
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
  (WebSocketManager as typeof WebSocketManager & WebSocketManagerWithHandler)._beforeUnloadHandler = handleBeforeUnload;
}

export default WebSocketManager;