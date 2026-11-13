/**
 * The app's toast outlet. Three things went wrong with it at once until
 * 2026-11-13, and each is pinned here:
 *
 * - A SECOND outlet in `main.tsx` drew every toast twice. Sonner keeps toasts
 *   in module state, so a render test of `App` cannot see a mount outside it —
 *   hence the source scan below.
 * - The theme came from `next-themes`, whose provider the app never mounted, so
 *   toasts followed the OS rather than the app's own setting.
 * - A "close all" button sat beside the outlet at `opacity-0` with pointer
 *   events on, an invisible click target over the bottom-right corner of every
 *   page.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { ThemeContext, type Theme } from '@/contexts/ThemeContext.types';
import { Toaster } from '../sonner';

const renderInTheme = (theme: Theme) =>
  render(
    <ThemeContext.Provider value={{ theme, setTheme: () => {} }}>
      <Toaster />
    </ThemeContext.Provider>
  );

const showToast = async (text: string) => {
  act(() => {
    toast(text);
  });
  await screen.findByText(text);
  const list = document.querySelector('[data-sonner-toaster]');
  expect(list, 'no toast list rendered').not.toBeNull();
  return list as HTMLElement;
};

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

describe('Toaster — the toast outlet', () => {
  // `dark` is the discriminating case: jsdom's matchMedia reports no dark
  // preference, so an outlet that followed the OS would draw it light.
  it.each(['dark', 'light'] as const)(
    "draws toasts in the app's own theme (%s)",
    async theme => {
      renderInTheme(theme);

      const list = await showToast(`in ${theme}`);

      expect(list).toHaveAttribute('data-theme', theme);
    }
  );

  it('adds nothing clickable outside the toasts themselves', async () => {
    renderInTheme('light');

    const list = await showToast('Saved');

    const buttons = screen.getAllByRole('button');
    // The toast's own close button exists, so this is not vacuous…
    expect(buttons.length).toBeGreaterThan(0);
    // …and every button lives inside the toast list.
    for (const button of buttons) {
      expect(list.contains(button), button.outerHTML).toBe(true);
    }
  });
});

describe('there is exactly one toast outlet', () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const sources = (readdirSync(srcRoot, { recursive: true }) as string[])
    .filter(f => /\.(ts|tsx)$/.test(f) && !/__tests__|\.test\./.test(f))
    .map(file => ({ file, text: readFileSync(join(srcRoot, file), 'utf8') }));

  it('scans the whole source tree', () => {
    // A scan that silently found nothing would pass the two tests below.
    expect(sources.some(s => s.file === 'main.tsx')).toBe(true);
    expect(sources.length).toBeGreaterThan(300);
  });

  it("only the wrapper imports sonner's Toaster", () => {
    const importers = sources
      .filter(s =>
        /import\s*\{[^}]*\bToaster\b[^}]*\}\s*from\s*['"]sonner['"]/.test(
          s.text
        )
      )
      .map(s => s.file);

    expect(importers).toEqual(['components/ui/sonner.tsx']);
  });

  it('the wrapper is mounted once, in App.tsx', () => {
    const importers = sources
      .filter(s => /from\s*['"]@\/components\/ui\/sonner['"]/.test(s.text))
      .map(s => s.file);
    expect(importers).toEqual(['App.tsx']);

    const app = sources.find(s => s.file === 'App.tsx')!.text;
    expect(app.match(/<Sonner\b/g)).toHaveLength(1);
  });
});
