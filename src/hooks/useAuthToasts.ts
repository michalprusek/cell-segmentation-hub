import { useEffect } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import { authEventEmitter, AuthEvent } from '@/lib/authEvents';

/**
 * Hook that handles auth-related toast messages
 * This is separate from AuthContext to avoid circular dependency with LanguageContext
 */
export function useAuthToasts() {
  const { t } = useLanguage();

  useEffect(() => {
    const handleAuthEvent = (event: AuthEvent) => {
      switch (event.type) {
        case 'signin_success':
          toast.success(t('auth.signInSuccess'), {
            description: t('auth.welcomeMessage'),
          });
          break;

        case 'signup_success':
          toast.success(t('auth.registrationSuccess'), {
            description: t('auth.welcomeMessage'),
          });
          break;

        case 'signin_error':
          toast.error(event.data?.error || t('auth.signInFailed'));
          break;

        case 'signup_error':
          toast.error(event.data?.error || t('auth.registrationFailed'));
          break;

        case 'logout_error':
          toast.error(event.data?.error || t('auth.logoutFailed'));
          break;

        case 'profile_error':
          toast.error(event.data?.error || t('auth.profileUpdateFailed'));
          break;

        case 'token_missing':
          toast.error(event.data?.message || t('auth.tokenMissing'), {
            description: event.data?.description || t('auth.pleaseSignInAgain'),
          });
          break;

        case 'token_expired':
          toast.warning(event.data?.message || t('auth.tokenExpired'), {
            description: event.data?.description || t('auth.pleaseSignInAgain'),
          });
          break;

        default:
          break;
      }
    };

    // Subscribe to all auth events
    authEventEmitter.on('signin_success', handleAuthEvent);
    authEventEmitter.on('signup_success', handleAuthEvent);
    authEventEmitter.on('signin_error', handleAuthEvent);
    authEventEmitter.on('signup_error', handleAuthEvent);
    authEventEmitter.on('logout_error', handleAuthEvent);
    authEventEmitter.on('profile_error', handleAuthEvent);
    authEventEmitter.on('token_missing', handleAuthEvent);
    authEventEmitter.on('token_expired', handleAuthEvent);

    return () => {
      // Cleanup
      authEventEmitter.off('signin_success', handleAuthEvent);
      authEventEmitter.off('signup_success', handleAuthEvent);
      authEventEmitter.off('signin_error', handleAuthEvent);
      authEventEmitter.off('signup_error', handleAuthEvent);
      authEventEmitter.off('logout_error', handleAuthEvent);
      authEventEmitter.off('profile_error', handleAuthEvent);
      authEventEmitter.off('token_missing', handleAuthEvent);
      authEventEmitter.off('token_expired', handleAuthEvent);
    };
  }, [t]);
}
