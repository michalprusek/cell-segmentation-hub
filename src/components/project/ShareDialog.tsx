import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api';
import { logger } from '@/lib/logger';
import {
  Share,
  Mail,
  Link,
  Copy,
  Trash2,
  ExternalLink,
  Clock,
  Users,
  CheckCircle,
  XCircle,
  AlertCircle,
  Send,
  UserCheck,
  UserPlus,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ShareDialogProps {
  projectId: string;
  projectTitle: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ProjectShare {
  id: string;
  email: string | null;
  sharedWith: { id: string; email: string; username?: string } | null;
  status: string;
  shareToken: string;
  shareUrl: string;
  tokenExpiry: string | null;
  createdAt: string;
  sharedBy?: { id: string; email: string };
}

export function ShareDialog({
  projectId,
  projectTitle,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ShareDialogProps) {
  const { t } = useLanguage();
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('email');
  const [loading, setLoading] = useState(false);
  const [shares, setShares] = useState<ProjectShare[]>([]);

  // Use controlled state if provided, otherwise use internal state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  // Email sharing state
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  // Link sharing state
  const [expiryHours, setExpiryHours] = useState<number | undefined>(undefined);
  const [generatedLink, setGeneratedLink] = useState<string>('');

  const loadShares = useCallback(async () => {
    try {
      const data = await apiClient.getProjectShares(projectId);
      setShares(data);
    } catch (error) {
      logger.error('Failed to load project shares:', error);
      toast({
        title: t('error'),
        description: t('sharing.failedToLoadShares'),
        variant: 'destructive',
      });
    }
  }, [projectId, t]);

  // Load existing shares when dialog opens
  useEffect(() => {
    if (open) {
      loadShares();
    }
  }, [open, projectId, loadShares]);

  const handleEmailShare = async () => {
    if (!email.trim()) {
      toast({
        title: t('error'),
        description: t('sharing.emailRequired'),
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await apiClient.shareProjectByEmail(projectId, {
        email: email.trim(),
        message: message.trim() || undefined,
      });

      toast({
        title: t('success'),
        description: t('sharing.emailSent'),
      });

      setEmail('');
      setMessage('');
      await loadShares(); // Refresh shares list
    } catch (error: any) {
      logger.error('Failed to share project by email:', error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        t('sharing.emailShareFailed');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResendInvitation = async (emailToResend: string) => {
    setLoading(true);
    try {
      await apiClient.shareProjectByEmail(projectId, {
        email: emailToResend,
        message: t('sharing.reminderMessage'),
      });

      toast({
        title: t('success'),
        description: t('sharing.invitationResent'),
      });

      await loadShares(); // Refresh shares list
    } catch (error: any) {
      logger.error('Failed to resend invitation:', error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        t('sharing.resendFailed');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLinkShare = async () => {
    setLoading(true);
    try {
      const result = await apiClient.shareProjectByLink(projectId, {
        expiryHours: expiryHours || undefined,
      });

      setGeneratedLink(result.shareUrl);

      toast({
        title: t('success'),
        description: t('sharing.linkGenerated'),
      });

      await loadShares(); // Refresh shares list
    } catch (error: any) {
      logger.error('Failed to generate share link:', error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        t('sharing.linkShareFailed');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: t('success'),
        description: t('sharing.linkCopied'),
      });
    } catch (error) {
      logger.error('Failed to copy link:', error);
      toast({
        title: t('error'),
        description: t('sharing.linkCopyFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    setLoading(true);
    try {
      await apiClient.revokeProjectShare(projectId, shareId);

      toast({
        title: t('success'),
        description: t('sharing.shareRevoked'),
      });

      await loadShares(); // Refresh shares list
    } catch (error: any) {
      logger.error('Failed to revoke share:', error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        t('sharing.revokeShareFailed');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'accepted':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'pending':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'revoked':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const formatExpiry = (expiry: string | null) => {
    if (!expiry) return t('sharing.neverExpires');
    const date = new Date(expiry);
    return date.toLocaleString();
  };

  // Separate shares by type and status
  const acceptedEmailShares = shares.filter(
    share => share.email && share.status === 'accepted'
  );
  const pendingEmailShares = shares.filter(
    share => share.email && share.status === 'pending'
  );
  const linkShares = shares.filter(share => !share.email);
  const acceptedLinkShares = linkShares.filter(
    share => share.status === 'accepted' && share.sharedWith
  );
  const activeLinkShares = linkShares.filter(
    share => share.status === 'accepted' && !share.sharedWith
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Only render trigger if not controlled externally */}
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm">
              <Share className="h-4 w-4 mr-2" />
              {t('sharing.share')}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={e => {
          e.stopPropagation();
        }}
        onPointerDownOutside={e => {
          e.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share className="h-5 w-5" />
            {t('sharing.shareProject')}
          </DialogTitle>
          <DialogDescription>
            {t('sharing.shareDescription', { title: projectTitle })}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              {t('sharing.shareByEmail')}
            </TabsTrigger>
            <TabsTrigger value="link" className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              {t('sharing.shareByLink')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="space-y-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="email">{t('sharing.emailAddress')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('sharing.enterEmailPlaceholder')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div>
                <Label htmlFor="message">{t('sharing.optionalMessage')}</Label>
                <Textarea
                  id="message"
                  placeholder={t('sharing.messagePlaceholder')}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  disabled={loading}
                  rows={3}
                />
              </div>
              <Button
                onClick={handleEmailShare}
                disabled={loading}
                className="w-full"
              >
                {loading ? t('sharing.sending') : t('sharing.sendInvitation')}
              </Button>
            </div>

            {/* Accepted Users */}
            {acceptedEmailShares.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-green-600" />
                    {t('sharing.acceptedUsers')} ({acceptedEmailShares.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {acceptedEmailShares.map(share => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center font-semibold">
                          {(share.sharedWith?.username ||
                            share.sharedWith?.email ||
                            share.email ||
                            '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {share.sharedWith?.username ||
                              share.sharedWith?.email ||
                              share.email}
                          </div>
                          <div className="text-xs text-gray-500">
                            {t('sharing.joinedOn')}:{' '}
                            {new Date(share.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeShare(share.id)}
                        disabled={loading}
                        title={t('sharing.revokeAccess')}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Pending Invitations */}
            {pendingEmailShares.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Mail className="h-4 w-4 text-yellow-600" />
                    {t('sharing.pendingInvitations')} (
                    {pendingEmailShares.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {pendingEmailShares.map(share => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-yellow-500 text-white flex items-center justify-center">
                          <Mail className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {share.email}
                          </div>
                          <div className="text-xs text-gray-500">
                            {t('sharing.sentOn')}:{' '}
                            {new Date(share.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResendInvitation(share.email!)}
                          disabled={loading}
                          title={t('sharing.resendInvitation')}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeShare(share.id)}
                          disabled={loading}
                          title={t('sharing.cancelInvitation')}
                        >
                          <XCircle className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="link" className="space-y-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="expiry">{t('sharing.linkExpiry')}</Label>
                <Select
                  value={expiryHours?.toString() || 'never'}
                  onValueChange={value => {
                    setExpiryHours(
                      value === 'never' ? undefined : Number(value)
                    );
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">
                      {t('sharing.neverExpires')}
                    </SelectItem>
                    <SelectItem value="24">24 {t('sharing.hours')}</SelectItem>
                    <SelectItem value="168">7 {t('sharing.days')}</SelectItem>
                    <SelectItem value="720">30 {t('sharing.days')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleLinkShare}
                disabled={loading}
                className="w-full"
              >
                {loading ? t('sharing.generating') : t('sharing.generateLink')}
              </Button>

              {generatedLink && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Input
                        value={generatedLink}
                        readOnly
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyLink(generatedLink)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Users who joined via link */}
            {acceptedLinkShares.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-green-600" />
                    {t('sharing.joinedViaLink')} ({acceptedLinkShares.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {acceptedLinkShares.map(share => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-semibold">
                          <Link className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {share.sharedWith?.username ||
                              share.sharedWith?.email}
                          </div>
                          <div className="text-xs text-gray-500">
                            {t('sharing.joinedViaLinkOn')}:{' '}
                            {new Date(share.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeShare(share.id)}
                        disabled={loading}
                        title={t('sharing.revokeAccess')}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
