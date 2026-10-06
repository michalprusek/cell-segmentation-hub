import React, { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/exports';
import apiClient, { ApiKeySummary } from '@/lib/api';
import { logger } from '@/lib/logger';

/** Mirrors MAX_API_KEYS_PER_USER in backend/src/services/apiKeyService.ts. */
const MAX_API_KEYS = 10;

const EXPIRY_OPTIONS = ['never', '30', '90', '365'] as const;
type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

/** The server's `code` for a refused request, if it sent one. */
const errorCode = (error: unknown): string | undefined =>
  (error as { response?: { data?: { code?: string } } })?.response?.data?.code;

const ApiKeysSection = () => {
  const { t, language } = useLanguage();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<ExpiryOption>('never');
  const [creating, setCreating] = useState(false);
  // The freshly minted key. It lives only here, in memory, until dismissed:
  // the server keeps a hash and can never send it again.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeySummary | null>(
    null
  );

  const loadKeys = useCallback(async () => {
    try {
      setKeys(await apiClient.getApiKeys());
    } catch (error) {
      logger.error('Error loading API keys:', error);
      toast.error(t('settings.apiKeys.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const failureMessage = (error: unknown, fallbackKey: string): string => {
    switch (errorCode(error)) {
      case 'API_KEY_LIMIT_REACHED':
        return t('settings.apiKeys.limitReached', {
          max: MAX_API_KEYS,
        }) as string;
      case 'API_KEY_IMPERSONATION_FORBIDDEN':
        return t('settings.apiKeys.impersonationForbidden') as string;
      default:
        return t(fallbackKey) as string;
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;

    setCreating(true);
    try {
      const created = await apiClient.createApiKey({
        name: trimmed,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      });
      const { key, ...summary } = created;
      setRevealedKey(key);
      setKeys(current => [summary, ...current]);
      setName('');
      setExpiry('never');
    } catch (error) {
      logger.error('Error creating API key:', error);
      toast.error(failureMessage(error, 'settings.apiKeys.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success(t('settings.apiKeys.copied') as string);
    } catch {
      // No clipboard permission, or an insecure context. The key is on screen
      // in a selectable field, so the user can still take it by hand.
      toast.error(t('settings.apiKeys.copyFailed') as string);
    }
  };

  const handleRevoke = async () => {
    const target = pendingRevoke;
    if (!target) return;
    setPendingRevoke(null);
    try {
      await apiClient.deleteApiKey(target.id);
      setKeys(current => current.filter(k => k.id !== target.id));
      toast.success(t('settings.apiKeys.revoked') as string);
    } catch (error) {
      logger.error('Error revoking API key:', error);
      toast.error(failureMessage(error, 'settings.apiKeys.revokeFailed'));
    }
  };

  const expiryText = (key: ApiKeySummary) => {
    if (!key.expiresAt) return t('settings.apiKeys.noExpiry');
    return new Date(key.expiresAt).getTime() <= Date.now()
      ? t('settings.apiKeys.expired')
      : formatDate(key.expiresAt);
  };

  const exampleKey = revealedKey ?? 'sseg_…';
  const example = `curl -H "Authorization: Bearer ${exampleKey}" \\\n  ${window.location.origin}/api/v1/models`;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
          {t('settings.apiKeys.title')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
          {t('settings.apiKeys.description')}
        </p>
      </div>

      {revealedKey && (
        <div
          role="status"
          className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20"
        >
          <h4 className="font-medium">{t('settings.apiKeys.createdTitle')}</h4>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('settings.apiKeys.createdWarning')}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={revealedKey}
              aria-label={t('settings.apiKeys.createdTitle') as string}
              className="font-mono text-sm"
              onFocus={e => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={handleCopy}>
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('settings.apiKeys.copy')}
            </Button>
            <Button type="button" onClick={() => setRevealedKey(null)}>
              {t('settings.apiKeys.done')}
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-4">
        <h4 className="font-medium">{t('settings.apiKeys.createTitle')}</h4>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="apiKeyName">
              {t('settings.apiKeys.nameLabel')}
            </Label>
            <Input
              id="apiKeyName"
              value={name}
              maxLength={64}
              placeholder={t('settings.apiKeys.namePlaceholder') as string}
              onChange={e => setName(e.target.value)}
              disabled={creating}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKeyExpiry">
              {t('settings.apiKeys.expiryLabel')}
            </Label>
            <Select
              value={expiry}
              onValueChange={value => setExpiry(value as ExpiryOption)}
              disabled={creating}
            >
              <SelectTrigger id="apiKeyExpiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map(option => (
                  <SelectItem key={option} value={option}>
                    {option === 'never'
                      ? t('settings.apiKeys.expiryNever')
                      : t('settings.apiKeys.expiryDays', { days: option })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={creating || !name.trim()}>
            {creating
              ? t('settings.apiKeys.creating')
              : t('settings.apiKeys.create')}
          </Button>
        </div>
      </form>

      <div className="space-y-3">
        <h4 className="font-medium">{t('settings.apiKeys.listTitle')}</h4>
        {loading ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-500">{t('settings.apiKeys.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-2 font-medium">
                    {t('settings.apiKeys.colName')}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t('settings.apiKeys.colKey')}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t('settings.apiKeys.colCreated')}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t('settings.apiKeys.colLastUsed')}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t('settings.apiKeys.colExpires')}
                  </th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map(key => (
                  <tr key={key.id} className="border-t dark:border-gray-700">
                    <td className="px-4 py-2 break-all">{key.name}</td>
                    <td className="px-4 py-2 font-mono whitespace-nowrap">
                      {key.prefix}…
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {key.lastUsedAt
                        ? formatDate(key.lastUsedAt)
                        : t('settings.apiKeys.neverUsed')}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {expiryText(key)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 dark:text-red-400"
                        onClick={() => setPendingRevoke(key)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                        {t('settings.apiKeys.revoke')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">{t('settings.apiKeys.usageTitle')}</h4>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('settings.apiKeys.usageDescription')}
        </p>
        <pre className="overflow-x-auto rounded-md bg-gray-900 p-4 text-sm text-gray-100">
          <code>{example}</code>
        </pre>
      </div>

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={open => {
          if (!open) setPendingRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.apiKeys.revokeTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.apiKeys.revokeDescription', {
                name: pendingRevoke?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleRevoke}
            >
              {t('settings.apiKeys.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ApiKeysSection;
