/**
 * The app's toast outlet. Until 2026-11-13 it went wrong in several ways at
 * once, and each is pinned here:
 *
 * - A SECOND outlet in `main.tsx` drew every toast twice. Sonner keeps toasts
 *   in module state, and a render test of `App` cannot see a mount outside it,
 *   so the source scan below catches that.
 * - Its theme was not the app's setting. It came from `next-themes`, which the
 *   app never mounted, so toasts followed the OS. Handing Sonner the raw
 *   'system' would be no better: Sonner 1.7.4 adds an OS listener for it and
 *   never removes it.
 * - A "close all" button sat beside the outlet at `opacity-0` with pointer
 *   events on: an invisible click target over the bottom-right corner of
 *   every page.
 * - It must be mounted above every provider. `ThemeProvider` renders nothing
 *   until the profile loads, and a toast fired while no outlet is mounted is
 *   lost.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { Toaster } from '../sonner';

/** What `ThemeContext.applyTheme` does: the RESOLVED theme as a class. */
const setAppTheme = (theme: 'light' | 'dark') => {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
};

/** Make the OS prefer dark, so an outlet that followed the OS would go dark. */
const osPrefersDark = () =>
  vi.mocked(window.matchMedia).mockImplementation(
    query =>
      ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList
  );

/** Does this source reach sonner's `Toaster` — named, aliased, through a
 *  namespace, a re-export or a dynamic import? Importing only `toast` does not. */
const touchesSonnerToaster = (text: string): boolean => {
  const from = String.raw`\s*from\s*['"]sonner['"]`;
  const namespace = text.match(
    new RegExp(String.raw`import\s*\*\s*as\s+(\w+)` + from)
  )?.[1];
  return (
    [
      // import { Toaster } / { toast, Toaster as T } from 'sonner'
      new RegExp(String.raw`import\s*\{[^}]*\bToaster\b[^}]*\}` + from),
      // export { Toaster } / export * from 'sonner'
      new RegExp(String.raw`export\s*(?:\*|\{[^}]*\bToaster\b[^}]*\})` + from),
      // import * as S from 'sonner' … <S.Toaster />
      namespace && new RegExp(String.raw`\b${namespace}\.Toaster\b`),
    ].some(re => re && re.test(text)) ||
    // import('sonner').then(m => m.Toaster)
    (/import\(\s*['"]sonner['"]\s*\)/.test(text) && /\.Toaster\b/.test(text))
  );
};

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
  document.documentElement.classList.remove('light', 'dark');
  vi.mocked(window.matchMedia).mockImplementation(
    query =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList
  );
});

// Every render below has NO provider around it: the outlet must work without
// any context, which is what lets App.tsx mount it above all of them.
describe('Toaster — the toast outlet', () => {
  it("draws toasts in the app's theme even when the OS prefers the other", async () => {
    osPrefersDark();
    setAppTheme('light');
    render(<Toaster />);

    const list = await showToast('light app, dark OS');

    expect(list).toHaveAttribute('data-theme', 'light');
  });

  it('draws toasts dark in a dark app', async () => {
    setAppTheme('dark');
    render(<Toaster />);

    const list = await showToast('dark app');

    expect(list).toHaveAttribute('data-theme', 'dark');
  });

  it('follows a theme change while it is mounted', async () => {
    setAppTheme('light');
    render(<Toaster />);
    const list = await showToast('before the switch');
    expect(list).toHaveAttribute('data-theme', 'light');

    act(() => setAppTheme('dark'));

    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toaster]')).toHaveAttribute(
        'data-theme',
        'dark'
      )
    );
  });

  it('adds nothing clickable outside the toasts themselves', async () => {
    render(<Toaster />);

    const list = await showToast('Saved');

    const buttons = screen.getAllByRole('button');
    // The toast's own close button exists, so this is not vacuous…
    expect(buttons.length).toBeGreaterThan(0);
    // …and every button lives inside the toast list.
    for (const button of buttons) {
      expect(list.contains(button), button.outerHTML).toBe(true);
    }
  });

  it('keeps the slide-in animation the App outlet always had', async () => {
    render(<Toaster />);

    await showToast('Animated');

    expect(document.querySelector('[data-sonner-toast]')).toHaveClass(
      'animate-slide-in-right'
    );
  });
});

describe('there is exactly one toast outlet, above every provider', () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  let sources: { file: string; text: string }[] = [];
  let app = '';

  // In beforeAll, not at collection: a run filtered to other tests (`-t`)
  // should not read 300+ files.
  beforeAll(() => {
    sources = (readdirSync(srcRoot, { recursive: true }) as string[])
      .filter(f => /\.(ts|tsx)$/.test(f) && !/__tests__|\.test\./.test(f))
      .map(file => ({ file, text: readFileSync(join(srcRoot, file), 'utf8') }));
    app = sources.find(s => s.file === 'App.tsx')?.text ?? '';
  });

  it('scans the whole source tree', () => {
    // A scan that silently found nothing would pass every test below.
    expect(sources.some(s => s.file === 'main.tsx')).toBe(true);
    expect(sources.length).toBeGreaterThan(300);
    expect(app).not.toBe('');
  });

  it("only the wrapper touches sonner's Toaster, in any import form", () => {
    const files = sources
      .filter(s => touchesSonnerToaster(s.text))
      .map(s => s.file);

    expect(files).toEqual(['components/ui/sonner.tsx']);
  });

  it('recognises every form of reaching Toaster, and not toast alone', () => {
    // The detector itself, so a green scan means "none found", not "none seen".
    expect(touchesSonnerToaster("import { Toaster } from 'sonner';")).toBe(
      true
    );
    expect(
      touchesSonnerToaster("import { toast, Toaster as T } from 'sonner';")
    ).toBe(true);
    expect(
      touchesSonnerToaster("import * as S from 'sonner';\n<S.Toaster />")
    ).toBe(true);
    expect(touchesSonnerToaster("export { Toaster } from 'sonner';")).toBe(
      true
    );
    expect(touchesSonnerToaster("export * from 'sonner';")).toBe(true);
    expect(touchesSonnerToaster("import('sonner').then(m => m.Toaster)")).toBe(
      true
    );
    expect(
      touchesSonnerToaster(
        "import { toast } from 'sonner';\nimport { Toaster } from '@/components/ui/sonner';"
      )
    ).toBe(false);
  });

  it('the wrapper is imported by App.tsx alone, by any path, and mounted once', () => {
    // The alias or any relative path ('./components/ui/sonner', './sonner').
    const wrapperPath =
      /(?:from\s*|import\(\s*)['"](?:[^'"]*\/ui\/sonner|\.\/sonner)['"]/;
    const importers = sources
      .filter(s => wrapperPath.test(s.text))
      .map(s => s.file);

    expect(importers).toEqual(['App.tsx']);
    expect(app.match(/<Sonner\b/g)).toHaveLength(1);
  });

  it('mounts it above every provider of the app', () => {
    const outlet = app.indexOf('<Sonner');
    const providers = [...app.matchAll(/<(\w+Provider)\b/g)].filter(
      m => m[1] !== 'QueryClientProvider'
    );

    expect(providers.map(m => m[1])).toContain('ThemeProvider');
    for (const m of providers) {
      expect(outlet, `<Sonner /> must come before <${m[1]}>`).toBeLessThan(
        m.index!
      );
    }
  });
});
