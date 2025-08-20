import { Skeleton } from '@/components/ui/skeleton';

interface PageLoadingFallbackProps {
  type?: 'dashboard' | 'editor' | 'form' | 'default';
}

const PageLoadingFallback = ({
  type = 'default',
}: PageLoadingFallbackProps) => {
  switch (type) {
    case 'dashboard':
      return (
        <div className="container mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-48 w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      );

    case 'editor':
      return (
        <div className="h-screen flex">
          <div className="flex-1 flex flex-col">
            <Skeleton className="h-16 w-full" />
            <div className="flex-1 flex">
              <Skeleton className="flex-1 m-4 rounded-lg" />
              <div className="w-80 p-4 space-y-4">
                <Skeleton className="h-6 w-32" />
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            </div>
          </div>
        </div>
      );

    case 'form':
      return (
        <div className="container mx-auto max-w-md p-6 space-y-6">
          <Skeleton className="h-8 w-48 mx-auto" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      );

    default:
      return (
        <div className="container mx-auto p-6">
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      );
  }
};

export default PageLoadingFallback;
