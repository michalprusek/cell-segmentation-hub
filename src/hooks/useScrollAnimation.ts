import { useEffect } from 'react';

/**
 * Custom hook for scroll-based animations using IntersectionObserver
 * Adds 'active' class to elements when they enter the viewport
 *
 * @param selector - CSS selector for elements to animate (default: '.animate-on-scroll')
 * @param options - IntersectionObserver options
 */
export function useScrollAnimation(
  selector: string = '.animate-on-scroll',
  options?: IntersectionObserverInit
) {
  useEffect(() => {
    // Feature detection for IntersectionObserver
    if (typeof IntersectionObserver === 'undefined') {
      console.warn('IntersectionObserver not supported, animations disabled');

      // Fallback: immediately add active class to all elements
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        element.classList.add('active');
      });

      return;
    }

    try {
      const observerOptions: IntersectionObserverInit = options || {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px',
      };

      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
          }
        });
      }, observerOptions);

      const elements = document.querySelectorAll(selector);

      if (elements.length === 0) {
        console.debug(`No elements found matching selector: ${selector}`);
      }

      elements.forEach(element => {
        observer.observe(element);
      });

      return () => {
        elements.forEach(element => {
          observer.unobserve(element);
        });
      };
    } catch (error) {
      console.error('Failed to initialize scroll animation observer', error);

      // Fallback on error: show content immediately
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        element.classList.add('active');
      });
    }
  }, [selector, options]);
}
