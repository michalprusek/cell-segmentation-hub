import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

interface SkeletonCardProps {
  className?: string;
  showImage?: boolean;
  lines?: number;
}

export function SkeletonCard({
  className,
  showImage = true,
  lines = 2,
}: SkeletonCardProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {showImage && <Skeleton className="h-48 w-full rounded-lg" />}
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}

interface SkeletonImageGridProps {
  count?: number;
  className?: string;
}

export function SkeletonImageGrid({
  count = 6,
  className,
}: SkeletonImageGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4',
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="space-y-2 animate-in fade-in duration-500"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div className={cn('w-full', className)}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex gap-4 pb-2 border-b">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex gap-4 animate-in fade-in duration-500"
            style={{ animationDelay: `${rowIndex * 50}ms` }}
          >
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton key={colIndex} className="h-8 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface SkeletonProjectCardProps {
  className?: string;
}

export function SkeletonProjectCard({ className }: SkeletonProjectCardProps) {
  return (
    <div className={cn('space-y-3 p-4 rounded-lg border', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="h-32 w-full rounded" />
      <div className="flex gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex justify-between">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}

interface SkeletonSegmentationEditorProps {
  className?: string;
}

export function SkeletonSegmentationEditor({
  className,
}: SkeletonSegmentationEditorProps) {
  return (
    <div className={cn('flex h-screen', className)}>
      {/* Sidebar */}
      <div className="w-64 border-r p-4 space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>

      {/* Main Canvas */}
      <div className="flex-1 p-4">
        <div className="h-full flex flex-col gap-4">
          {/* Toolbar */}
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-10" />
            ))}
          </div>

          {/* Canvas Area */}
          <Skeleton className="flex-1 w-full rounded-lg" />

          {/* Bottom Controls */}
          <div className="flex justify-between">
            <div className="flex gap-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface SkeletonDashboardStatsProps {
  className?: string;
}

export function SkeletonDashboardStats({
  className,
}: SkeletonDashboardStatsProps) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-4', className)}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="p-6 rounded-lg border space-y-2 animate-in fade-in duration-500"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-5 rounded" />
          </div>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
