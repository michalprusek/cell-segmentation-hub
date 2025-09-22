import { describe, test, expect } from 'vitest';
import { cn } from '../utils';

describe('Utils', () => {
  describe('cn function', () => {
    test('should merge class names correctly', () => {
      const result = cn('class1', 'class2');
      expect(result).toBe('class1 class2');
    });

    test('should handle conditional classes', () => {
      const result = cn('base-class', 'conditional-class', '');
      expect(result).toBe('base-class conditional-class');
    });

    test('should handle array of classes', () => {
      const result = cn(['class1', 'class2'], 'class3');
      expect(result).toBe('class1 class2 class3');
    });

    test('should handle object with boolean values', () => {
      const result = cn({
        'always-present': true,
        'conditionally-present': true,
        'never-present': false,
      });
      expect(result).toBe('always-present conditionally-present');
    });

    test('should merge Tailwind CSS classes correctly', () => {
      // Test Tailwind merge functionality - conflicting classes should be resolved
      const result = cn('px-2 py-1', 'px-4');
      expect(result).toBe('py-1 px-4'); // px-4 should override px-2
    });

    test('should handle multiple Tailwind conflicts', () => {
      const result = cn('bg-red-500 text-white', 'bg-blue-500 text-black');
      // tw-merge should resolve conflicts by applying the last class for each utility type
      expect(result).toContain('bg-blue-500');
      expect(result).toContain('text-black');
      expect(result).not.toContain('bg-red-500');
      expect(result).not.toContain('text-white');
    });

    test('should handle empty and falsy values', () => {
      const result = cn('', null, undefined, 0, false, 'valid-class');
      expect(result).toBe('valid-class');
    });

    test('should handle complex nested conditionals', () => {
      const isActive = true;
      const isDisabled = false;
      const variant = 'primary';

      const result = cn(
        'base-button',
        {
          'button-active': isActive,
          'button-disabled': isDisabled,
          'button-primary': variant === 'primary',
          'button-secondary': variant === 'secondary',
        },
        isActive && 'hover:bg-blue-600',
        !isDisabled && 'cursor-pointer'
      );

      expect(result).toBe(
        'base-button button-active button-primary hover:bg-blue-600 cursor-pointer'
      );
    });

    test('should handle responsive and state variants', () => {
      const result = cn(
        'text-sm md:text-base lg:text-lg',
        'hover:text-blue-500 focus:text-blue-700',
        'transition-colors duration-200'
      );

      expect(result).toBe(
        'text-sm md:text-base lg:text-lg hover:text-blue-500 focus:text-blue-700 transition-colors duration-200'
      );
    });

    test('should handle spacing conflicts correctly', () => {
      // Test that Tailwind merge resolves spacing conflicts properly
      const result = cn('p-2 px-4 py-3', 'm-1 mx-2');
      // Check that the result contains the expected classes without asserting order
      expect(result).toContain('py-3');
      expect(result).toContain('px-4');
      expect(result).toContain('mx-2');
      expect(result).toContain('m-1');
      expect(result).not.toContain('p-2'); // Should be overridden by px-4 and py-3
    });

    test('should handle color conflicts', () => {
      const result = cn('text-red-500', 'text-blue-600');
      expect(result).toBe('text-blue-600'); // Later color should win
    });

    test('should handle mixed types input', () => {
      const result = cn(
        'base',
        ['array1', 'array2'],
        { 'object-true': true, 'object-false': false },
        'conditional',
        'final'
      );

      expect(result).toBe('base array1 array2 object-true conditional final');
    });

    test('should handle nested arrays', () => {
      const result = cn(['outer1', ['nested1', 'nested2'], 'outer2']);
      expect(result).toBe('outer1 nested1 nested2 outer2');
    });

    test('should handle function results', () => {
      const getClasses = () => 'function-class';
      const result = cn('base', getClasses());
      expect(result).toBe('base function-class');
    });

    test('should handle large number of classes deterministically', () => {
      const manyClasses = Array.from({ length: 100 }, (_, i) => `class-${i}`);
      const result = cn(...manyClasses);

      expect(result).toContain('class-0');
      expect(result).toContain('class-99');
      expect(result.split(' ')).toHaveLength(100);
    });

    test('should handle edge case with only falsy values', () => {
      const result = cn(false, null, undefined, '');
      expect(result).toBe('');
    });

    test('should handle whitespace normalization', () => {
      const result = cn('  class1  ', '  class2  ');
      expect(result).toBe('class1 class2');
    });

    test('should handle duplicate classes', () => {
      const result = cn('duplicate', 'unique', 'duplicate');
      // clsx should deduplicate, but the exact behavior depends on implementation
      expect(result).toContain('duplicate');
      expect(result).toContain('unique');
    });

    test('should work with component props pattern', () => {
      // Common React pattern
      interface ButtonProps {
        variant?: 'primary' | 'secondary';
        size?: 'sm' | 'md' | 'lg';
        disabled?: boolean;
        className?: string;
      }

      const getButtonClasses = (props: ButtonProps) => {
        return cn(
          'btn',
          {
            'btn-primary': props.variant === 'primary',
            'btn-secondary': props.variant === 'secondary',
            'btn-sm': props.size === 'sm',
            'btn-md': props.size === 'md',
            'btn-lg': props.size === 'lg',
            'btn-disabled': props.disabled,
          },
          props.className
        );
      };

      const result1 = getButtonClasses({
        variant: 'primary',
        size: 'lg',
        disabled: false,
        className: 'custom-class',
      });

      expect(result1).toBe('btn btn-primary btn-lg custom-class');

      const result2 = getButtonClasses({
        variant: 'secondary',
        disabled: true,
      });

      expect(result2).toBe('btn btn-secondary btn-disabled');
    });

    test('should maintain class order for non-conflicting classes', () => {
      const result = cn('first', 'second', 'third');
      expect(result).toBe('first second third');
    });

    test('should handle numeric values correctly', () => {
      const result = cn('class', 1, 0, 5, 'end');
      // Numbers are truthy except 0
      expect(result).toBe('class 1 5 end');
    });
  });
});
