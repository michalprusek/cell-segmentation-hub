import React, { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';
import FeedbackDialog from './FeedbackDialog';

/**
 * Header button that opens the FeedbackDialog.
 *
 * It carries its purpose in words, not only in the icon: a speech-bubble glyph
 * says "there is a conversation here" but not that this is where you report a
 * bug or ask for a feature, which is the only thing the dialog does. The label
 * is `feedback.buttonLabel` rather than the existing `feedback.buttonTitle`
 * ("Send feedback") for the same reason — it names the two things the dialog
 * offers (`typeBug` / `typeFeature`) instead of describing the act of sending.
 *
 * The text is hidden below `lg`, where the header row has no width for it; the
 * icon plus `aria-label` carry it there, and the mobile header does not render
 * this button at all.
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
        size="sm"
        className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
        onClick={() => setOpen(true)}
        title={t('feedback.buttonTitle', 'Send feedback') as string}
        aria-label={
          t('feedback.buttonAriaLabel', 'Open feedback form') as string
        }
        data-testid="feedback-button"
      >
        <MessageSquarePlus className="h-5 w-5 lg:mr-2" />
        <span className="hidden lg:inline">
          {String(t('feedback.buttonLabel'))}
        </span>
      </Button>
      {open && <FeedbackDialog open={open} onOpenChange={setOpen} />}
    </>
  );
};

export default FeedbackButton;
