import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

interface DeleteAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

const DeleteAccountDialog: React.FC<DeleteAccountDialogProps> = ({
  isOpen,
  onClose,
  userEmail,
}) => {
  const { t } = useLanguage();
  const { deleteAccount } = useAuth();
  const [confirmationText, setConfirmationText] = useState('');
  const [password, setPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // The server checks both again; this only keeps the button honest.
  const isConfirmationValid =
    confirmationText === userEmail && password.length > 0;

  const handleDelete = async () => {
    if (!isConfirmationValid) return;

    setIsDeleting(true);
    try {
      // On success the app reloads onto the home page, which announces the
      // deletion - there is nothing left to do here.
      await deleteAccount(confirmationText, password);
    } catch (error) {
      logger.error('Error deleting account:', error);
      // 400 is the server refusing the e-mail or the password - by far the
      // likeliest failure, and one the user can fix by retyping.
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      toast.error(
        status === 400
          ? t('settings.deleteAccountDialog.wrongCredentials')
          : t('settings.deleteAccountError')
      );
      setPassword('');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (!isDeleting) {
      setConfirmationText('');
      setPassword('');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            {t('settings.deleteAccountDialog.title')}
          </DialogTitle>
          <DialogDescription className="text-base leading-relaxed pt-2">
            {t('settings.deleteAccountDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-4">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <h4 className="font-semibold text-red-800 mb-2">
              {t('settings.deleteAccountDialog.whatWillBeDeleted')}
            </h4>
            <ul className="text-sm text-red-700 space-y-1">
              <li>• {t('settings.deleteAccountDialog.deleteItems.account')}</li>
              <li>
                • {t('settings.deleteAccountDialog.deleteItems.projects')}
              </li>
              <li>
                • {t('settings.deleteAccountDialog.deleteItems.segmentation')}
              </li>
              <li>
                • {t('settings.deleteAccountDialog.deleteItems.settings')}
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="confirmation"
              className="text-sm font-medium break-words"
            >
              {t('settings.deleteAccountDialog.confirmationLabel').replace(
                '{email}',
                userEmail
              )}
            </Label>
            <Input
              id="confirmation"
              type="text"
              placeholder={userEmail}
              value={confirmationText}
              onChange={e => setConfirmationText(e.target.value)}
              className="font-mono"
              disabled={isDeleting}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="delete-account-password"
              className="text-sm font-medium break-words"
            >
              {t('settings.deleteAccountDialog.passwordLabel')}
            </Label>
            <Input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isDeleting}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isDeleting}>
            {t('settings.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmationValid || isDeleting}
            className="min-w-[120px]"
          >
            {isDeleting ? t('settings.deleting') : t('settings.deleteAccount')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteAccountDialog;
