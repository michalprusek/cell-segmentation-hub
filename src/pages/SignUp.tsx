import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, ArrowLeft, Check, X } from 'lucide-react';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';

const SignUp = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { signUp, user } = useAuth();

  // Real-time validation
  const passwordsMatch = useMemo(() => {
    if (!password || !confirmPassword) return null;
    return password === confirmPassword;
  }, [password, confirmPassword]);

  const showPasswordMatchIndicator = confirmPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (!agreeTerms) {
      toast.error('You must agree to the terms and conditions');
      return;
    }

    setIsLoading(true);

    try {
      // TODO: Add consent UI to collect these values from user
      // For now, omitting consent fields as they should be explicitly collected
      await signUp(email, password);
      // signUp already navigates to /dashboard automatically
    } catch (error) {
      logger.error('Sign up error:', error);
      const errorMessage = getErrorMessage(error) || 'Sign up failed';
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // If already logged in, show a message instead of the form
  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full glass-morphism rounded-2xl overflow-hidden shadow-glass-lg p-10 text-center">
          <h2 className="text-2xl font-bold mb-4">You're already logged in</h2>
          <p className="mb-6 text-gray-600">
            You're already signed up and logged in.
          </p>
          <Button asChild className="w-full">
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>
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
              Create your account
            </h2>
            <p className="mt-2 text-gray-600">
              Sign up to use the spheroid segmentation platform
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

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className={`h-11 ${showPasswordMatchIndicator ? (passwordsMatch ? 'border-green-500' : 'border-red-500') : ''}`}
                required
              />
              {showPasswordMatchIndicator && (
                <div
                  className={`flex items-center gap-2 text-sm mt-1 ${passwordsMatch ? 'text-green-600' : 'text-red-600'}`}
                >
                  {passwordsMatch ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Passwords match</span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      <span>Passwords do not match</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center">
                <Checkbox
                  id="terms"
                  checked={agreeTerms}
                  onCheckedChange={checked => setAgreeTerms(checked as boolean)}
                />
                <label
                  htmlFor="terms"
                  className="ml-2 block text-sm text-gray-700"
                >
                  I agree to the{' '}
                  <Link
                    to="/terms-of-service"
                    className="text-blue-600 hover:text-blue-500 transition-colors"
                  >
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link
                    to="/privacy-policy"
                    className="text-blue-600 hover:text-blue-500 transition-colors"
                  >
                    Privacy Policy
                  </Link>
                </label>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base rounded-md"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Sign up'
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <Link
                to="/sign-in"
                className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
