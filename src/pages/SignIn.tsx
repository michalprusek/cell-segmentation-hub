import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, ArrowLeft } from 'lucide-react';
import { logger } from '@/lib/logger';

const SignIn = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, user, isAuthenticated } = useAuth();
  // Validate and sanitize returnTo param to prevent open redirects
  const validateReturnTo = (returnTo: string | null): string => {
    if (!returnTo) return '/dashboard';

    // Only allow same-origin relative paths starting with single slash
    if (
      returnTo.startsWith('/') &&
      !returnTo.startsWith('//') &&
      !returnTo.includes(':')
    ) {
      return returnTo;
    }

    // Fallback to dashboard for any invalid values
    return '/dashboard';
  };

  const returnTo = validateReturnTo(searchParams.get('returnTo'));

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      logger.debug('👤 User already authenticated, redirecting to:', returnTo);
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, user, navigate, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    setIsLoading(true);

    try {
      logger.debug('📝 Sign in form submitted, returnTo:', returnTo);
      await signIn(email, password, rememberMe);

      // Navigate to returnTo after successful login
      logger.debug('🎯 Navigating to:', returnTo);
      navigate(returnTo, { replace: true });
    } catch (error) {
      logger.error('Sign in error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // If already logged in, show loading or redirect
  if (user && isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
          <p className="mt-4 text-gray-600">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
      {/* Back button - positioned at top left of screen */}
      <div className="absolute top-6 left-6 z-10">
        <Link
          to="/"
          className="inline-flex items-center justify-center w-10 h-10 glass-morphism rounded-full hover:bg-white/20 transition-all duration-200"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </Link>
      </div>

      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-blue-200/30 rounded-full filter blur-3xl animate-float" />
        <div
          className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-blue-300/20 rounded-full filter blur-3xl animate-float"
          style={{ animationDelay: '-2s' }}
        />
        <div
          className="absolute top-2/3 left-1/3 w-40 h-40 bg-blue-400/20 rounded-full filter blur-3xl animate-float"
          style={{ animationDelay: '-4s' }}
        />
      </div>

      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-md w-full glass-morphism rounded-2xl overflow-hidden shadow-glass-lg p-10 animate-scale-in">
          <div className="text-center mb-8">
            <Link to="/" className="inline-flex items-center justify-center">
              <img src="/logo.svg" alt="SpheroSeg Logo" className="w-12 h-12" />
            </Link>
            <h2 className="mt-4 text-3xl font-bold text-gray-900">
              Sign in to your account
            </h2>
            <p className="mt-2 text-gray-600">
              Access the spheroid segmentation platform
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-11"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-11"
                required
              />
            </div>

            <div className="flex items-center">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={checked => setRememberMe(checked as boolean)}
              />
              <label
                htmlFor="remember"
                className="ml-2 block text-sm text-gray-700"
              >
                Remember me
              </label>
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base rounded-md"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white text-gray-500">
                  Don't have an account?
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <Link to="/sign-up">
                <Button
                  variant="outline"
                  className="w-full h-11 text-base rounded-md"
                >
                  Sign Up
                </Button>
              </Link>
              <p className="text-center text-sm text-gray-600 mt-3">
                By signing in, you agree to our{' '}
                <Link
                  to="/terms-of-service"
                  className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
                >
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                  to="/privacy-policy"
                  className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
                >
                  Privacy Policy
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
