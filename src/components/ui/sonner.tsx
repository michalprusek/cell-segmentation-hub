import { useSyncExternalStore } from 'react';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;
type ResolvedTheme = 'light' | 'dark';

const root = () => document.documentElement;

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(root(), { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

const resolvedTheme = (): ResolvedTheme =>
  root().classList.contains('dark') ? 'dark' : 'light';

/**
 * The app's ONE toast outlet, mounted in `App.tsx` ABOVE every provider.
 *
 * - One: Sonner keeps its toasts in module state, so every mounted `<Toaster>`
 *   draws every toast. A second one in `main.tsx` showed each message twice.
 * - Above the providers: `ThemeProvider` renders nothing until it has a
 *   theme. That is always true on its first render, and for a user already
 *   known when it mounts it lasts until their profile loads. A toast fired
 *   meanwhile reaches no outlet and is lost; a parent provider's mount effect
 *   runs in that same first commit, for instance. So this reads no React
 *   context at all.
 * - The theme is the class `ThemeContext.applyTheme` puts on `<html>`, which
 *   is already resolved: 'system' has become light or dark there, and is kept
 *   current by a listener that cleans up after itself. Passing Sonner the raw
 *   'system' instead would let it add its own OS listener, which it never
 *   removes (1.7.4), so toasts would follow the OS even after the user picked
 *   Dark. It used to come from `next-themes`, which this app never mounted.
 */
const Toaster = (props: ToasterProps) => {
  const theme = useSyncExternalStore<ResolvedTheme>(
    subscribe,
    resolvedTheme,
    () => 'light'
  );

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{ className: 'animate-slide-in-right' }}
      {...props}
    />
  );
};

export { Toaster };
