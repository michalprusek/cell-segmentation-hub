/**
 * Modal colour picker for a single channel. Opens from the small colour
 * swatch icon next to each row in `ChannelOverlayList`. The native
 * `<input type="color">` is a simple, low-dependency picker; presets
 * cover the colours microscopists actually reach for first (white for
 * IRM grayscale, red/green/blue for typical fluorophores).
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';

interface ChannelColorDialogProps {
  open: boolean;
  channelName: string;
  initialColor: string;
  onConfirm: (color: string) => void;
  onClose: () => void;
}

const PRESETS = [
  { color: '#FFFFFF', label: 'White (grayscale)' },
  { color: '#FF0000', label: 'Red' },
  { color: '#00FF00', label: 'Green' },
  { color: '#00FFFF', label: 'Cyan' },
  { color: '#FFFF00', label: 'Yellow' },
  { color: '#FF00FF', label: 'Magenta' },
  { color: '#FFA500', label: 'Orange' },
  { color: '#1E90FF', label: 'Blue' },
];

export function ChannelColorDialog({
  open,
  channelName,
  initialColor,
  onConfirm,
  onClose,
}: ChannelColorDialogProps) {
  const { t } = useLanguage();
  const [color, setColor] = useState(initialColor);

  // Reset when the user reopens for a different channel / value.
  useEffect(() => {
    if (open) setColor(initialColor);
  }, [open, initialColor]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{t('editor.channels.colorDialog.title')}</span>
            <span className="font-mono text-base">{channelName}</span>
          </DialogTitle>
          <DialogDescription>
            {t('editor.channels.colorDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* Preset grid: 2 columns × 4 rows keeps every label readable
              even in long-translation locales (German "Benutzerdefiniert"
              etc.). 4-col was cramming "White (grayscale)" into "White
              (graysc...". */}
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(p => (
              <button
                key={p.color}
                type="button"
                onClick={() => setColor(p.color)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                  color.toLowerCase() === p.color.toLowerCase()
                    ? 'border-blue-500 ring-2 ring-blue-300 bg-blue-50/30 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'
                }`}
                aria-label={p.label}
              >
                <span
                  className="h-5 w-5 rounded-sm border border-black/10 dark:border-white/10 flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                  aria-hidden
                />
                <span className="text-left">{p.label}</span>
              </button>
            ))}
          </div>

          {/* Custom row: native picker + readable hex input on its own
              line below the label so neither gets squeezed by the dialog
              edges. */}
          <div className="space-y-2">
            <label
              htmlFor="channel-color-input"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('editor.channels.colorDialog.customLabel')}
            </label>
            <div className="flex items-center gap-3">
              <input
                id="channel-color-input"
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded border border-gray-300 dark:border-gray-600 bg-transparent flex-shrink-0"
              />
              <input
                type="text"
                value={color}
                onChange={e => {
                  const v = e.target.value;
                  if (/^#?[0-9A-Fa-f]{0,6}$/.test(v.replace(/^#/, ''))) {
                    setColor(v.startsWith('#') ? v : `#${v}`);
                  }
                }}
                spellCheck={false}
                className="h-10 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-transparent px-3 font-mono text-sm uppercase"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm(color)}>{t('common.apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
