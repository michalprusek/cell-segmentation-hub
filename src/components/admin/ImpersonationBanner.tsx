import React, { useState } from 'react';
import { ShieldAlert, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth, useLanguage } from '@/contexts/exports';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/types';

/**
 * The only thing on screen that says this session is not what it looks like.
 *
 * While an admin is impersonating, every other surface deliberately shows the
 * TARGET user — their projects, their name in the header, their storage
 * numbers — because that is the point of the feature. So this bar has to name
 * both people (who is being viewed, and who is really signed in) and it has to
 * be impossible to mistake for ordinary chrome. Sticky rather than fixed, so
 * it pushes the page down instead of covering the header.
 *
 * Returning is a HARD navigation, not a react-router one: the new auth cookies
 * belong to a different account, and the React Query cache, the WebSocket
 * subscription and every context still hold the impersonated user's data. A
 * soft navigation would leave the admin looking at someone else's projects
 * under their own name — the exact confusion this banner exists to prevent.
 */
const ImpersonationBanner: React.FC = () => {
  const { impersonatedBy, user } = useAuth();
  const { t } = useLanguage();
  const [isStopping, setIsStopping] = useState(false);

  if (!impersonatedBy) {
    return null;
  }

  const handleStop = async () => {
    if (isStopping) {
      return;
    }
    setIsStopping(true);
    try {
      await apiClient.stopImpersonation();
      // Full reload of the admin user list — see the component docstring.
      window.location.assign('/admin/users');
    } catch (error) {
      logger.error('Failed to stop impersonation:', error);
      toast.error(getErrorMessage(error) || t('admin.stopImpersonationFailed'));
      setIsStopping(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="impersonation-banner"
      className="sticky top-0 z-50 w-full border-b-2 border-amber-600 bg-amber-400 text-amber-950 shadow-md dark:bg-amber-500 dark:text-amber-950"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            <strong className="font-semibold">
              {t('admin.impersonationBannerTitle')}
            </strong>{' '}
            {t('admin.impersonationBannerViewing')}{' '}
            <strong className="font-semibold">{user?.email ?? '—'}</strong>{' '}
            {t('admin.impersonationBannerSignedInAs')}{' '}
            <strong className="font-semibold">{impersonatedBy.email}</strong>
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleStop()}
          disabled={isStopping}
          className="shrink-0 border-amber-900 bg-amber-50 text-amber-950 hover:bg-white"
        >
          {isStopping ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          {t('admin.returnToUserList')}
        </Button>
      </div>
    </div>
  );
};

export default ImpersonationBanner;
