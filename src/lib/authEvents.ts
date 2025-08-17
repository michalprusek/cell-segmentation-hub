/**
 * Auth events system to avoid circular dependency between AuthContext and LanguageContext
 */

export interface AuthEvent {
  type: 'signin_success' | 'signup_success' | 'signin_error' | 'signup_error' | 'logout_error' | 'profile_error';
  data?: {
    message?: string;
    description?: string;
    error?: string;
  };
}

class AuthEventEmitter {
  private listeners: Map<string, ((event: AuthEvent) => void)[]> = new Map();

  emit(event: AuthEvent) {
    const eventListeners = this.listeners.get(event.type) || [];
    eventListeners.forEach(listener => listener(event));
  }

  on(eventType: string, listener: (event: AuthEvent) => void) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(listener);
  }

  off(eventType: string, listener: (event: AuthEvent) => void) {
    const eventListeners = this.listeners.get(eventType);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }
}

export const authEventEmitter = new AuthEventEmitter();