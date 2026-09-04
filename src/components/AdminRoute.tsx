import { Loader2, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth, useLanguage } from '@/contexts/exports';
import ProtectedRoute from '@/components/ProtectedRoute';

interface AdminRouteProps {
  children: React.ReactNode;
}

/**
 * Renders `children` only for an account carrying the platform-admin flag.
 *
 * This is a UI gate, NOT a security boundary — it decides what to draw, and
 * nothing more. Every endpoint behind it re-checks the flag server-side
 * (`requireAdmin` in the backend's auth middleware, which re-reads the `users`
 * row on every request), so editing `isAdmin` in devtools gets you a page that
 * renders and an API that says 403.
 *
 * A non-admin gets an explicit "not authorised" panel rather than a redirect:
 * bouncing them to the dashboard would look identical to the page not
 * existing, and the difference matters when the maintainer is checking whether
 * the flag was actually granted.
 */
const AdminRoute = ({ children }: AdminRouteProps) => {
  const { isAdmin, loading, profile } = useAuth();
  const { t } = useLanguage();

  return (
    <ProtectedRoute>
      {/* `profile` arrives one request after `user` does, and `isAdmin` lives
          on it — so without this the admin page would flash "not authorised"
          on every load before the profile landed. */}
      {loading || !profile ? (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        </div>
      ) : isAdmin ? (
        <>{children}</>
      ) : (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <ShieldAlert className="h-12 w-12 mx-auto text-amber-500" />
            <h1 className="mt-4 text-xl font-semibold dark:text-gray-100">
              {t('admin.notAuthorizedTitle')}
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t('admin.notAuthorizedDescription')}
            </p>
            <Link
              to="/dashboard"
              className="mt-6 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              {t('common.dashboard')}
            </Link>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
};

export default AdminRoute;
