import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  // `active:scale-[0.98]` is the cheapest perceived-responsiveness win there
  // is: a press registers on pointerdown instead of waiting for whatever the
  // handler does, so a control that fires a 300ms request no longer reads as
  // dead. It is a compositor-only transform, and `motion-reduce` opts out.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        // High-contrast bordered CTA used by the sign-in / sign-up flows.
        // In dark mode the original "invert to white-on-black" treatment
        // was reported as glary / hard to read, so the dark side uses the
        // brand primary color — which, since `--primary` was pointed at the
        // platform blue, is finally the white-on-blue this comment always
        // claimed rather than the black-on-white it actually rendered.
        framed:
          'bg-black text-white border-2 border-black hover:bg-gray-900 dark:bg-primary dark:text-primary-foreground dark:border-primary dark:hover:bg-primary/90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
