import React, { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';
import FeedbackDialog from './FeedbackDialog';

/**
 * Header icon button that opens the FeedbackDialog. Sized to align with
 * the UserProfileDropdown trigger next to it (32 px ghost button).
 *
 * The dialog is mounted only when opened to keep the header light —
 * react-dropzone + form state cost ~10 KB but only when needed.
 */
const FeedbackButton: React.FC = () => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
        onClick={() => setOpen(true)}
        title={t('feedback.buttonTitle', 'Send feedback') as string}
        aria-label={
          t('feedback.buttonAriaLabel', 'Open feedback form') as string
        }
      >
        <MessageSquarePlus className="h-5 w-5" />
      </Button>
      {open && <FeedbackDialog open={open} onOpenChange={setOpen} />}
    </>
  );
};

export default FeedbackButton;
