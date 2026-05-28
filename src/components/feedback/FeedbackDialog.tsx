import React, { useState, useCallback } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Bug, Lightbulb, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import FeedbackAttachmentDropzone from './FeedbackAttachmentDropzone';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FeedbackType = 'bug' | 'feature';

const TITLE_MAX = 200;
const BODY_MAX = 5000;

/**
 * Drop-in feedback dialog. Two-option type picker (bug / feature),
 * title + body text fields, optional drag-and-drop screenshot.
 *
 * State is local `useState` — no react-hook-form. Matches the
 * DeleteAccountDialog pattern in the codebase (~150 LOC, terminal
 * component, throw-away state on close).
 */
const FeedbackDialog: React.FC<FeedbackDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useLanguage();
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const reset = useCallback(() => {
    setType('bug');
    setTitle('');
    setBody('');
    setFile(null);
    setUploadPct(null);
  }, []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (submitting) return;
      onOpenChange(next);
      if (!next) reset();
    },
    [submitting, onOpenChange, reset]
  );

  const canSubmit =
    !submitting && title.trim().length > 0 && body.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setUploadPct(file ? 0 : null);
    try {
      await apiClient.submitFeedback(
        { type, title: title.trim(), body: body.trim() },
        file ?? undefined,
        file ? setUploadPct : undefined
      );
      toast.success(
        t(
          'feedback.submittedSuccess',
          'Thanks! Your feedback was sent.'
        ) as string
      );
      onOpenChange(false);
      reset();
    } catch (err) {
      logger.error('Feedback submit failed', err);
      const fallback = t(
        'feedback.submitFailed',
        "Couldn't send feedback"
      ) as string;
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? // axios error shape
            ((err as { response?: { data?: { error?: string } } }).response
              ?.data?.error ?? '')
          : '';
      toast.error(fallback, detail ? { description: detail } : undefined);
    } finally {
      setSubmitting(false);
      setUploadPct(null);
    }
  };

  // Type-picker tile — large hit area, dark-mode-aware, mirrors the
  // RadioCard pattern used in upload type pickers elsewhere in the app.
  const TypeTile: React.FC<{
    value: FeedbackType;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }> = ({ value, icon: Icon, label }) => {
    const selected = type === value;
    return (
      <button
        type="button"
        onClick={() => setType(value)}
        disabled={submitting}
        aria-pressed={selected}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border px-4 py-4 transition-colors ${
          selected
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
            : 'border-gray-300 hover:border-blue-400 dark:border-gray-700 dark:hover:border-blue-600'
        } ${submitting ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <Icon
          className={`h-5 w-5 ${
            selected
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        />
        <span
          className={`text-sm font-medium ${
            selected
              ? 'text-blue-700 dark:text-blue-300'
              : 'text-gray-700 dark:text-gray-200'
          }`}
        >
          {label}
        </span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('feedback.title', 'Send feedback')}</DialogTitle>
          <DialogDescription>
            {t(
              'feedback.subtitle',
              'Found a bug or have an idea? Tell us — we read every report.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <TypeTile
              value="bug"
              icon={Bug}
              label={t('feedback.typeBug', 'Bug report') as string}
            />
            <TypeTile
              value="feature"
              icon={Lightbulb}
              label={t('feedback.typeFeature', 'Feature request') as string}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-title">
              {t('feedback.titleLabel', 'Title')}
            </Label>
            <Input
              id="feedback-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              placeholder={
                t('feedback.titlePlaceholder', 'Short summary') as string
              }
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-body">
              {t('feedback.bodyLabel', 'Details')}
            </Label>
            <Textarea
              id="feedback-body"
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={BODY_MAX}
              placeholder={
                t(
                  'feedback.bodyPlaceholder',
                  'Steps to reproduce, what you expected, screenshots if relevant...'
                ) as string
              }
              disabled={submitting}
              className="min-h-[140px]"
            />
            <p className="text-xs text-right text-gray-500 dark:text-gray-400">
              {body.length}/{BODY_MAX}
            </p>
          </div>

          <FeedbackAttachmentDropzone
            file={file}
            onChange={setFile}
            disabled={submitting}
          />

          {submitting && file && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${uploadPct ?? 0}%` }}
                />
              </div>
              <p className="text-right text-xs text-gray-500 dark:text-gray-400">
                {t('feedback.uploading', 'Uploading…')} {uploadPct ?? 0}%
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={submitting}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="min-w-[120px]"
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('feedback.submit', 'Submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackDialog;
