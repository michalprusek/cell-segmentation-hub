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
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
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
  const [isDeleting, setIsDeleting] = useState(false);

  const isConfirmationValid = confirmationText === userEmail;

  const handleDelete = async () => {
    if (!isConfirmationValid) return;

    setIsDeleting(true);
    try {
      await deleteAccount(confirmationText);
      toast.success(t('settings.accountDeleted'));
      onClose();
    } catch (error) {
      logger.error('Error deleting account:', error);
      toast.error(t('settings.deleteAccountError'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (!isDeleting) {
      setConfirmationText('');
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

        <div className="space-y-4 py-4">
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
            <Label htmlFor="confirmation" className="text-sm font-medium">
              {t('settings.deleteAccountDialog.confirmationLabel').replace(
                '{0}',
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
