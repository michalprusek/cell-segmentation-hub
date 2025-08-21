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
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ShareDialogProps {
  projectId: string;
  projectTitle: string;
  trigger?: React.ReactNode;
}

interface ProjectShare {
  id: string;
  email: string | null;
  sharedWith: { id: string; email: string } | null;
  status: string;
  shareToken: string;
  shareUrl: string;
  tokenExpiry: string | null;
  createdAt: string;
}

export function ShareDialog({
  projectId,
  projectTitle,
  trigger,
}: ShareDialogProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('email');
  const [loading, setLoading] = useState(false);
  const [shares, setShares] = useState<ProjectShare[]>([]);

  // Email sharing state
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  // Link sharing state
  const [expiryHours, setExpiryHours] = useState<number | undefined>(undefined);
  const [generatedLink, setGeneratedLink] = useState<string>('');

  // Load existing shares when dialog opens
  useEffect(() => {
    if (open) {
      loadShares();
    }
  }, [open, projectId]);

  const loadShares = async () => {
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
  };

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

  const emailShares = shares.filter(share => share.email);
  const linkShares = shares.filter(share => !share.email);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Share className="h-4 w-4 mr-2" />
            {t('sharing.share')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
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

            {emailShares.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {t('sharing.emailInvitations')} ({emailShares.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {emailShares.map(share => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between p-2 border rounded"
                    >
                      <div className="flex items-center gap-2">
                        {getStatusIcon(share.status)}
                        <span className="text-sm">{share.email}</span>
                        <Badge variant="secondary" className="text-xs">
                          {t(`sharing.status.${share.status}`)}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeShare(share.id)}
                        disabled={loading}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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

            {linkShares.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Link className="h-4 w-4" />
                    {t('sharing.shareLinks')} ({linkShares.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {linkShares.map(share => (
                    <div
                      key={share.id}
                      className="p-3 border rounded space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-500" />
                          <span className="text-sm">
                            {formatExpiry(share.tokenExpiry)}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeShare(share.id)}
                          disabled={loading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={share.shareUrl}
                          readOnly
                          className="flex-1 text-xs"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyLink(share.shareUrl)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(share.shareUrl, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
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
