import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, useLanguage } from '@/contexts/exports';
// import apiClient from '@/lib/api';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [gracePeriod, setGracePeriod] = useState(true);
  const [hasTokens, setHasTokens] = useState<boolean | null>(null);

  // Give authentication state a moment to stabilize after login
  useEffect(() => {
    const timer = setTimeout(() => {
      setGracePeriod(false);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Derive hasTokens from isAuthenticated provided by useAuth
    setHasTokens(isAuthenticated);
  }, [isAuthenticated]);

  useEffect(() => {
    // Debug logs removed for production

    // Don't redirect during initial loading or grace period
    if (loading || gracePeriod || isRedirecting || hasTokens === null) {
      return;
    }

    if (!hasTokens || !user) {
      setIsRedirecting(true);
      navigate(`/sign-in?returnTo=${encodeURIComponent(location.pathname)}`, {
        replace: true,
      });
    }
  }, [
    hasTokens,
    user,
    loading,
    gracePeriod,
    navigate,
    location.pathname,
    isRedirecting,
  ]);

  // If loading, in grace period, or we have tokens and user, show loading
  if (loading || gracePeriod) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
          <p className="mt-4 text-gray-600">{t('auth.loadingAccount')}</p>
        </div>
      </div>
    );
  }

  // If we have tokens and user, render children
  if (hasTokens && user) {
    return <>{children}</>;
  }

  // Show loading while redirecting
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
        <p className="mt-4 text-gray-600">{t('auth.redirectingToSignIn')}</p>
      </div>
    </div>
  );
};

export default ProtectedRoute;
