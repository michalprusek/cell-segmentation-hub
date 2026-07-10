import { useEffect, useRef, useState, type RefObject } from 'react';

export interface ContainerSize {
  ref: RefObject<HTMLDivElement>;
  width: number;
  height: number;
}

/**
 * Tracks a container element's content-box size via `ResizeObserver`. Used
 * to feed the editor's centering/zoom-constraint math (which needs the
 * canvas viewport's pixel dimensions), since the editor route has no fixed
 * layout size — it fills whatever space the flex layout gives it.
 */
export function useContainerSize(): ContainerSize {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize(prev =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height }
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
