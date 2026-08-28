import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    indeterminate?: boolean;
  }
>(({ className, indeterminate, ...props }, ref) => {
  // Convert indeterminate to checked state for Radix UI
  // Radix UI uses 'indeterminate' as a value for checked prop
  const checkedState = indeterminate ? 'indeterminate' : props.checked;

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        // `relative` is here so call sites can opt into `touchTargetClass`
        // below. It is deliberately NOT applied by default: several checkbox
        // lists in the export dialog sit on a ~36px row pitch, so a 44px hit
        // area on every checkbox would make adjacent ones overlap and the
        // lower row would steal the upper row's bottom edge.
        'peer relative h-4 w-4 shrink-0 rounded border border-primary ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        className
      )}
      {...props}
      checked={checkedState}
    >
      <CheckboxPrimitive.Indicator
        className={cn('flex items-center justify-center text-current')}
      >
        {indeterminate ? (
          <div className="h-2 w-2 bg-current" />
        ) : (
          <Check className="h-4 w-4" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

/**
 * Opt-in 44px touch target for a checkbox that stands alone and is the only
 * way to perform its action — image selection in the project grid and list.
 * The `after` pseudo-element grows the hit area on phone-width viewports
 * without changing a single pixel of what is drawn; pointer devices keep the
 * tight 16px box.
 *
 * Do NOT apply this to checkboxes stacked in a column: the 44px areas would
 * overlap on any row pitch under 44px and the lower row would capture clicks
 * meant for the one above it.
 */
export const checkboxTouchTargetClass =
  'after:absolute after:-inset-3.5 after:content-[""] sm:after:content-none';

export { Checkbox };
