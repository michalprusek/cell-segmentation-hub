import { useState, useEffect, useRef, ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

interface LazyImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  placeholder?: string;
  fallbackSrc?: string;
  onLoadingComplete?: () => void;
  showSkeleton?: boolean;
  blurPreview?: boolean;
  aspectRatio?: 'square' | 'video' | 'portrait' | number;
}

export function LazyImage({
  src,
  alt,
  placeholder,
  fallbackSrc = '/placeholder-image.png',
  onLoadingComplete,
  showSkeleton = true,
  blurPreview = true,
  aspectRatio,
  className,
  ...props
}: LazyImageProps) {
  const [imageSrc, setImageSrc] = useState(placeholder || '');
  const [imageRef, setImageRef] = useState<HTMLImageElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Calculate aspect ratio styles
  const aspectRatioStyle = aspectRatio
    ? typeof aspectRatio === 'number'
      ? { aspectRatio: aspectRatio.toString() }
      : aspectRatio === 'square'
        ? { aspectRatio: '1' }
        : aspectRatio === 'video'
          ? { aspectRatio: '16/9' }
          : { aspectRatio: '3/4' }
    : {};

  useEffect(() => {
    if (!imageRef) return;

    // Set up Intersection Observer for lazy loading
    observerRef.current = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observerRef.current?.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before image enters viewport
      }
    );

    observerRef.current.observe(imageRef);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [imageRef]);

  useEffect(() => {
    if (!isInView || !src) return;

    // Preload the image
    const img = new Image();

    img.onload = () => {
      setImageSrc(src);
      setIsLoading(false);
      setHasError(false);
      onLoadingComplete?.();
    };

    img.onerror = () => {
      setImageSrc(fallbackSrc);
      setIsLoading(false);
      setHasError(true);
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [isInView, src, fallbackSrc, onLoadingComplete]);

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={aspectRatioStyle}
    >
      {showSkeleton && isLoading && (
        <Skeleton className="absolute inset-0 w-full h-full" />
      )}

      <img
        ref={setImageRef}
        src={imageSrc || placeholder || fallbackSrc}
        alt={alt}
        className={cn(
          'w-full h-full object-cover transition-all duration-500',
          isLoading && blurPreview && 'blur-md scale-105',
          !isLoading && 'blur-0 scale-100',
          hasError && 'opacity-50'
        )}
        loading="lazy"
        {...props}
      />

      {isLoading && !showSkeleton && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <div className="animate-pulse">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// Optimized image gallery with virtualization support
interface LazyImageGalleryProps {
  images: Array<{
    src: string;
    alt: string;
    id: string | number;
  }>;
  columns?: number;
  gap?: number;
  onImageClick?: (id: string | number) => void;
}

export function LazyImageGallery({
  images,
  columns = 3,
  gap = 16,
  onImageClick,
}: LazyImageGalleryProps) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: `${gap}px`,
      }}
    >
      {images.map((image, index) => (
        <div
          key={image.id}
          className="animate-in fade-in zoom-in-95 duration-500 cursor-pointer hover:scale-105 transition-transform"
          style={{ animationDelay: `${index * 50}ms` }}
          onClick={() => onImageClick?.(image.id)}
        >
          <LazyImage
            src={image.src}
            alt={image.alt}
            aspectRatio="square"
            className="rounded-lg shadow-md"
          />
        </div>
      ))}
    </div>
  );
}
