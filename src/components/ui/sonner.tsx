import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/contexts/exports';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * The app's ONE toast outlet, mounted in `App.tsx` inside `ThemeProvider`.
 *
 * Sonner keeps its toasts in module state, so EVERY mounted `<Toaster>` draws
 * every toast: a second one in `main.tsx` showed each message twice, stacked
 * in the same corner. `sonner.test.tsx` fails if a second mount appears.
 *
 * The theme is the app's own setting. It used to come from `next-themes`,
 * whose provider this app never mounted, so every toast followed the OS.
 */
const Toaster = (props: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      richColors
      expand={false}
      {...props}
    />
  );
};

export { Toaster };
