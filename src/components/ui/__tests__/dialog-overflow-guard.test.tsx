/**
 * @vitest-environment jsdom
 */

/**
 * Regression guard for the dialog-layout class of bug.
 *
 * Reported symptom: adding an image channel with a long name broke the modal
 * layout. Root cause: `DialogContent` and `AlertDialogContent` are `grid`
 * containers, so each direct child is a grid item whose default
 * `min-width: auto` is a CONTENT-based minimum. One unbreakable 128-character
 * string therefore widened the implicit track past `max-w-lg` and pushed the
 * dialog -- footer buttons included -- outside the viewport. Every dialog in
 * the app had to defend against this individually, and most did not.
 *
 * WHAT THIS TEST CAN AND CANNOT DO: jsdom performs no layout, so nothing here
 * measures a pixel. Asserting on the class list is the honest limit -- it
 * catches the realistic regression (someone rewrites the `cn(...)` string and
 * drops the guard) and nothing more. The visual behaviour still has to be
 * eyeballed in a browser with a genuinely long name.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// 128 characters, no spaces: exactly what AddChannelDialog's MAX_NAME_LEN allows
// a user to type into a channel name, and the shape that defeats normal wrapping.
const LONG_NAME = 'x'.repeat(128);

describe('dialog primitives constrain their grid children', () => {
  it('DialogContent caps its children so long content cannot widen it', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>{LONG_NAME}</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByRole('dialog');
    expect(content.className).toContain('[&>*]:min-w-0');
    expect(content.className).toContain('max-w-lg');
  });

  it('AlertDialogContent does the same', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>{LONG_NAME}</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    );
    const content = screen.getByRole('alertdialog');
    expect(content.className).toContain('[&>*]:min-w-0');
    expect(content.className).toContain('max-w-lg');
  });

  it('a caller-supplied className does not displace the guard', () => {
    // cn() merges rather than replaces, but a future refactor to a plain
    // template string would silently drop the guard for every dialog that
    // passes its own sizing -- and several do (max-w-2xl, max-w-4xl).
    render(
      <Dialog open>
        <DialogContent className="max-w-4xl">
          <DialogTitle>{LONG_NAME}</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole('dialog').className).toContain('[&>*]:min-w-0');
  });
});
