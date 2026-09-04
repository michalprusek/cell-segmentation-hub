import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  Loader2,
  LogIn,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import DashboardHeader from '@/components/DashboardHeader';
import { PageContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth, useLanguage } from '@/contexts/exports';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import { getErrorMessage, type AdminUserSummary } from '@/types';

const PAGE_SIZE = 25;

/**
 * The admin's user list, and the entry point to "log in as" a user.
 *
 * Everything here is server-gated (`requireAdmin`); the page renders nothing
 * the API would not also authorise. `AdminRoute` only keeps a non-admin from
 * seeing an empty table and a 403 toast.
 */
const AdminUsers: React.FC = () => {
  const { t } = useLanguage();
  const { user: currentUser } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  // Debounced so typing an e-mail does not fire a request per keystroke
  // against a rate-limited endpoint (60 per 5 min per admin).
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'users', page, search],
    queryFn: () => apiClient.listAdminUsers({ page, limit: PAGE_SIZE, search }),
  });

  const handleImpersonate = async (target: AdminUserSummary) => {
    if (impersonatingId) {
      return;
    }
    setImpersonatingId(target.id);
    try {
      await apiClient.impersonateUser(target.id);
      // HARD navigation on purpose: the auth cookies now belong to someone
      // else, but the React Query cache, the WebSocket subscription and every
      // context still hold the admin's data. A react-router navigate would
      // render the target's account out of the admin's cache.
      window.location.assign('/dashboard');
    } catch (err) {
      logger.error('Impersonation failed:', err);
      toast.error(getErrorMessage(err) || t('admin.impersonateFailed'));
      setImpersonatingId(null);
    }
  };

  const users = data?.users ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <>
      <DashboardHeader />
      <PageContainer>
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-semibold dark:text-gray-100">
            <Users className="h-6 w-6" />
            {t('admin.usersTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.usersDescription')}
          </p>
        </div>

        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('admin.searchPlaceholder') as string}
            aria-label={t('admin.searchPlaceholder') as string}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : isError ? (
          <Card className="flex items-center gap-3 p-6 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-5 w-5" />
            {getErrorMessage(error) || t('admin.loadUsersFailed')}
          </Card>
        ) : users.length === 0 ? (
          <Card className="p-6 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.noUsersFound')}
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-200 text-left dark:border-gray-700">
                <tr className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 font-medium">{t('common.email')}</th>
                  <th className="px-4 py-3 font-medium">
                    {t('admin.columnUsername')}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t('admin.columnProjects')}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t('admin.columnRegistered')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isSelf = u.id === currentUser?.id;
                  // The server refuses both of these too (400 / 403) — this
                  // only saves the round-trip and says WHY the button is off.
                  const blocked = isSelf || u.isAdmin;
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                    >
                      <td className="px-4 py-3 dark:text-gray-200">
                        <span className="flex items-center gap-2">
                          {u.email}
                          {u.isAdmin && (
                            <Badge
                              variant="secondary"
                              className="gap-1 text-xs"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              {t('admin.badgeAdmin')}
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {u.username || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {u.projectCount}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={blocked || impersonatingId !== null}
                          title={
                            isSelf
                              ? (t('admin.cannotImpersonateSelf') as string)
                              : u.isAdmin
                                ? (t('admin.cannotImpersonateAdmin') as string)
                                : undefined
                          }
                          onClick={() => void handleImpersonate(u)}
                        >
                          {impersonatingId === u.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <LogIn className="mr-2 h-4 w-4" />
                          )}
                          {t('admin.logInAs')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              {t('common.back')}
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t('admin.pageOf', { page, total: totalPages })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              {t('admin.nextPage')}
            </Button>
          </div>
        )}
      </PageContainer>
    </>
  );
};

export default AdminUsers;
