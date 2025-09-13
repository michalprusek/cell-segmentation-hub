import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import {
  Loader2,
  ArrowLeft,
  Lock,
  CheckCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { logger } from '@/lib/logger';
import { apiClient } from '@/lib/api';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const { t } = useLanguage();

  const token = searchParams.get('token');

  useEffect(() => {
    // Validate token on component mount
    if (!token) {
      setTokenValid(false);
      toast.error(t('auth.invalidResetToken'));
      return;
    }

    // Token exists, assume valid for now - will be validated on submit
    setTokenValid(true);
  }, [token, t]);

  const validatePassword = (password: string): boolean => {
    return password.length >= 8;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      toast.error(t('auth.invalidResetToken'));
      return;
    }

    if (!password) {
      toast.error(t('errors.validationErrors.passwordRequired'));
      return;
    }

    if (!validatePassword(password)) {
      toast.error(t('errors.validationErrors.passwordMinLength'));
      return;
    }

    if (password !== confirmPassword) {
      toast.error(t('errors.validationErrors.passwordMismatch'));
      return;
    }

    setIsLoading(true);

    try {
      logger.debug('🔐 Password reset submission');

      const response = await apiClient.instance.post('/auth/reset-password', {
        token,
        newPassword: password,
      });

      logger.debug('✅ Password reset successful:', response.data);

      setIsSubmitted(true);
      toast.success(t('auth.passwordResetSuccess'));
    } catch (error: unknown) {
      logger.error('❌ Password reset failed:', error);

      const errorMessage = getLocalizedErrorMessage(
        error,
        t,
        'errors.operations.resetPassword'
      );
      toast.error(errorMessage);

      // Check if token is invalid/expired
      if (
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'status' in error.response &&
        (error.response.status === 400 || error.response.status === 401)
      ) {
        setTokenValid(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToSignIn = () => {
    navigate('/sign-in');
  };

  // Success screen after password reset
  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
        {/* Back button */}
        <div className="absolute top-6 left-6 z-10">
          <Link
            to="/sign-in"
            className="inline-flex items-center justify-center w-10 h-10 glass-morphism rounded-full hover:bg-white/20 transition-all duration-200"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </Link>
        </div>

        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-green-200/30 rounded-full filter blur-3xl animate-float" />
          <div
            className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-green-300/20 rounded-full filter blur-3xl animate-float"
            style={{ animationDelay: '-2s' }}
          />
        </div>

        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-md w-full glass-morphism rounded-2xl overflow-hidden shadow-glass-lg p-10 animate-scale-in">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-6">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>

              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {t('auth.passwordResetSuccess')}
              </h2>

              <p className="text-gray-600 mb-6">
                {t('auth.passwordResetSuccessMessage')}
              </p>

              <div className="space-y-4">
                <Button
                  onClick={handleBackToSignIn}
                  className="w-full h-11 text-base rounded-md"
                >
                  {t('auth.backToSignIn')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Invalid token screen
  if (tokenValid === false) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
        {/* Back button */}
        <div className="absolute top-6 left-6 z-10">
          <Link
            to="/sign-in"
            className="inline-flex items-center justify-center w-10 h-10 glass-morphism rounded-full hover:bg-white/20 transition-all duration-200"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </Link>
        </div>

        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-red-200/30 rounded-full filter blur-3xl animate-float" />
          <div
            className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-red-300/20 rounded-full filter blur-3xl animate-float"
            style={{ animationDelay: '-2s' }}
          />
        </div>

        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-md w-full glass-morphism rounded-2xl overflow-hidden shadow-glass-lg p-10 animate-scale-in">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-6">
                <Lock className="w-8 h-8 text-red-600" />
              </div>

              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {t('auth.invalidResetToken')}
              </h2>

              <p className="text-gray-600 mb-6">
                {t('auth.invalidResetTokenMessage')}
              </p>

              <div className="space-y-4">
                <Link to="/forgot-password">
                  <Button className="w-full h-11 text-base rounded-md">
                    {t('auth.requestNewReset')}
                  </Button>
                </Link>

                <Link to="/sign-in">
                  <Button
                    variant="outline"
                    className="w-full h-11 text-base rounded-md"
                  >
                    {t('auth.backToSignIn')}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Password reset form
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
      {/* Back button */}
      <div className="absolute top-6 left-6 z-10">
        <Link
          to="/sign-in"
          className="inline-flex items-center justify-center w-10 h-10 glass-morphism rounded-full hover:bg-white/20 transition-all duration-200"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </Link>
      </div>

      {/* Background decoration */}
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
              {t('auth.resetPassword')}
            </h2>
            <p className="mt-2 text-gray-600">{t('auth.enterNewPassword')}</p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.newPassword')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('auth.passwordPlaceholder')}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="h-11 pr-10"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
              <p className="text-sm text-gray-500">
                {t('auth.passwordRequirements')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                {t('auth.confirmPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="h-11 pr-10"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  disabled={isLoading}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
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
                  {t('auth.resettingPassword')}
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  {t('auth.resetPassword')}
                </>
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
                  {t('auth.rememberPassword')}
                </span>
              </div>
            </div>

            <div className="mt-6">
              <Link to="/sign-in">
                <Button
                  variant="outline"
                  className="w-full h-11 text-base rounded-md"
                >
                  {t('auth.backToSignIn')}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
