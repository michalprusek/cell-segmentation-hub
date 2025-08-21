import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  Share,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  LogIn,
  Loader2,
} from 'lucide-react';

interface ShareValidationData {
  project: { id: string; title: string; description: string | null };
  sharedBy: { email: string };
  status: string;
  email: string | null;
  needsLogin: boolean;
}

export function ShareAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [shareData, setShareData] = useState<ShareValidationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(t('sharing.invitationInvalid'));
      setLoading(false);
      return;
    }

    validateToken();
  }, [token]);

  const validateToken = async () => {
    try {
      setLoading(true);
      const data = await apiClient.validateShareToken(token!);
      setShareData(data);
      setError(null);
    } catch (error: any) {
      logger.error('Failed to validate share token:', error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        t('sharing.invitationInvalid');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!token) return;

    try {
      setAccepting(true);
      const result = await apiClient.acceptShareInvitation(token);

      if (result.needsLogin) {
        toast({
          title: t('sharing.loginToAccept'),
          description: t('sharing.loginToAccept'),
          variant: 'default',
        });
        // Redirect to login with return URL
        navigate(`/login?returnTo=/share/accept/${token}`);
        return;
      }

      setAccepted(true);
      toast({
        title: t('success'),
        description: t('sharing.invitationAccepted'),
      });

      // Redirect to the project after a short delay
      setTimeout(() => {
        navigate(`/project/${result.project.id}`);
      }, 2000);
    } catch (error: any) {
      logger.error('Failed to accept share invitation:', error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        t('sharing.invitationInvalid');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setAccepting(false);
    }
  };

  const handleLogin = () => {
    navigate(`/login?returnTo=/share/accept/${token}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{t('common.loading')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center space-x-2">
              <AlertCircle className="h-6 w-6 text-red-500" />
              <span>{t('error')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={() => navigate('/dashboard')} variant="outline">
              {t('common.back')} {t('common.dashboard')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center space-x-2">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <span>{t('success')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p>{t('sharing.invitationAccepted')}</p>
            <p className="text-sm text-muted-foreground">
              {t('sharing.redirectingToProject')}...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!shareData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center space-x-2">
            <Share className="h-6 w-6 text-blue-500" />
            <span>{t('sharing.acceptInvitation')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold">{shareData.project.title}</h2>
            {shareData.project.description && (
              <p className="text-muted-foreground">
                {shareData.project.description}
              </p>
            )}
          </div>

          <div className="bg-muted rounded-lg p-4 space-y-2">
            <p className="text-sm">
              <span className="font-medium">{t('sharing.sharedBy')}</span>
              <br />
              {shareData.sharedBy.email}
            </p>
            {shareData.email && (
              <p className="text-sm">
                <span className="font-medium">
                  {t('sharing.invitedEmail')}:
                </span>
                <br />
                {shareData.email}
              </p>
            )}
          </div>

          <div className="space-y-3">
            {shareData.needsLogin || !user ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  {t('sharing.loginToAccept')}
                </p>
                <Button onClick={handleLogin} className="w-full">
                  <LogIn className="h-4 w-4 mr-2" />
                  {t('auth.signIn')}
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full"
              >
                {accepting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('sharing.accepting')}...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {t('sharing.acceptInvitation')}
                  </>
                )}
              </Button>
            )}

            <Button
              onClick={() => navigate('/dashboard')}
              variant="outline"
              className="w-full"
            >
              {t('common.back')} {t('common.dashboard')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
