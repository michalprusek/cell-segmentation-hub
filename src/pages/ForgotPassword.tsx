import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { Loader2, ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { logger } from '@/lib/logger';
import { apiClient } from '@/lib/api';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const navigate = useNavigate();
  const { t } = useLanguage();

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error(t('errors.validationErrors.emailRequired'));
      return;
    }

    if (!validateEmail(normalizedEmail)) {
      toast.error(t('errors.validationErrors.invalidEmail'));
      return;
    }

    setIsLoading(true);

    try {
      logger.debug('🔐 Password reset request submitted');

      const response = await apiClient.instance.post(
        '/auth/request-password-reset',
        {
          email: normalizedEmail,
        }
      );

      logger.debug('✅ Password reset request successful:', response.data);

      setIsSubmitted(true);
      toast.success(t('auth.resetPasswordEmailSent'));
    } catch (error: unknown) {
      logger.error('❌ Password reset request failed:', error);

      const errorMessage = getLocalizedErrorMessage(
        error,
        t,
        'errors.operations.resetPassword'
      );
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToSignIn = () => {
    navigate('/sign-in');
  };

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
                {t('auth.emailSent')}
              </h2>

              <p className="text-gray-600 mb-6">
                {t('auth.checkEmailForNewPassword')}
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <div className="flex items-center">
                  <Mail className="w-5 h-5 text-blue-600 mr-2" />
                  <span className="text-sm text-blue-800 font-medium">
                    {email}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <Button
                  onClick={handleBackToSignIn}
                  className="w-full h-11 text-base rounded-md"
                >
                  {t('auth.backToSignIn')}
                </Button>

                <p className="text-sm text-gray-500">
                  {t('auth.didntReceiveEmail')}{' '}
                  <button
                    onClick={() => {
                      setIsSubmitted(false);
                      setEmail('');
                    }}
                    className="text-blue-600 hover:text-blue-500 font-medium"
                  >
                    {t('auth.tryAgain')}
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              {t('auth.forgotPassword')}
            </h2>
            <p className="mt-2 text-gray-600">{t('auth.enterEmailForReset')}</p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.emailAddress')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-11"
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base rounded-md"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('auth.sending')}
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  {t('auth.sendNewPassword')}
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

export default ForgotPassword;
