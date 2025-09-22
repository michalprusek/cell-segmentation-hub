/**
 * Emergency logout utility for immediate authentication cleanup
 * Forces immediate logout and page refresh when authentication fails
 */

import { logger } from './logger';

/**
 * Performs emergency logout with immediate cleanup and redirect
 * Used when authentication state is corrupted or token errors occur
 *
 * @param reason - The reason for emergency logout
 * @param redirectPath - Path to redirect to (defaults to /sign-in)
 */
export const emergencyLogout = (
  reason: string = 'Authentication error',
  redirectPath: string = '/sign-in'
): void => {
  logger.warn(`[Emergency Logout] ${reason}`);

  try {
    // Clear all possible authentication storage
    // Check localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      localStorage.removeItem('userProfile');
      // Clear any other auth-related keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('auth') || key.includes('token'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    // Check sessionStorage
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('refreshToken');
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('userProfile');
      // Clear any other auth-related keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes('auth') || key.includes('token'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
    }

    // Clear cookies if any (though this app doesn't use them for auth)
    if (typeof document !== 'undefined') {
      document.cookie.split(';').forEach(cookie => {
        const [name] = cookie.split('=');
        if (name.trim().includes('token') || name.trim().includes('auth')) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        }
      });
    }
  } catch (error) {
    logger.error('Error during emergency logout cleanup', error);
  }

  // Force immediate redirect with page refresh
  if (typeof window !== 'undefined') {
    // Check if we're already on the target page to avoid redirect loop
    if (window.location.pathname !== redirectPath) {
      // Add timestamp to ensure cache bypass
      const timestamp = Date.now();
      const separator = redirectPath.includes('?') ? '&' : '?';
      const fullPath = `${redirectPath}${separator}t=${timestamp}&emergency=true`;

      // Use replace to prevent back navigation and force refresh
      window.location.replace(fullPath);
    } else {
      // If already on sign-in page, just reload to clear state
      window.location.reload();
    }
  }
};

/**
 * Checks if the current session appears to be in an emergency logout state
 * @returns true if emergency logout was triggered
 */
export const isEmergencyLogout = (): boolean => {
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('emergency') === 'true';
  }
  return false;
};

/**
 * Clears emergency logout flag from URL
 */
export const clearEmergencyFlag = (): void => {
  if (typeof window !== 'undefined' && isEmergencyLogout()) {
    const url = new URL(window.location.href);
    url.searchParams.delete('emergency');
    url.searchParams.delete('t'); // Also remove timestamp
    window.history.replaceState({}, '', url.toString());
  }
};
