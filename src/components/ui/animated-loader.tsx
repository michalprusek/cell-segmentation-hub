import { cn } from '@/lib/utils';
import { Progress } from './progress';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface AnimatedLoaderProps {
  message?: string;
  subMessage?: string;
  progress?: number;
  isIndeterminate?: boolean;
  className?: string;
  showPercentage?: boolean;
  estimatedTime?: number; // in seconds
}

export function AnimatedLoader({
  message = 'Loading...',
  subMessage,
  progress,
  isIndeterminate = false,
  className,
  showPercentage = true,
  estimatedTime,
}: AnimatedLoaderProps) {
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [dots, setDots] = useState('');

  // Simulate progress for indeterminate loaders
  useEffect(() => {
    if (isIndeterminate && !progress) {
      const interval = setInterval(() => {
        setSimulatedProgress(prev => {
          if (prev >= 95) return prev;
          // Logarithmic growth - fast at start, slow near end
          const increment = Math.max(0.5, (100 - prev) / 20);
          return Math.min(95, prev + increment);
        });
      }, 200);

      return () => clearInterval(interval);
    }
  }, [isIndeterminate, progress]);

  // Animated dots for loading message
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const displayProgress = progress ?? simulatedProgress;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center space-y-4 p-8',
        className
      )}
    >
      <div className="relative">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        {showPercentage && displayProgress > 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-semibold">
              {Math.round(displayProgress)}%
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2 text-center">
        <p className="text-lg font-medium">
          {message}
          <span className="inline-block w-8 text-left">{dots}</span>
        </p>
        {subMessage && (
          <p className="text-sm text-muted-foreground animate-in fade-in duration-500">
            {subMessage}
          </p>
        )}
      </div>

      {(progress !== undefined || isIndeterminate) && (
        <Progress
          value={displayProgress}
          className="w-64 h-2 animate-in fade-in duration-500"
        />
      )}

      {estimatedTime && (
        <p className="text-xs text-muted-foreground animate-pulse">
          Estimated time:{' '}
          {formatTime(
            estimatedTime - Math.floor((displayProgress / 100) * estimatedTime)
          )}
        </p>
      )}
    </div>
  );
}

interface StepLoaderProps {
  steps: {
    id: string;
    label: string;
    status: 'pending' | 'loading' | 'completed' | 'error';
  }[];
  currentMessage?: string;
  className?: string;
}

export function StepLoader({
  steps,
  currentMessage,
  className,
}: StepLoaderProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={cn(
            'flex items-center space-x-3 transition-all duration-300',
            step.status === 'loading' && 'scale-105',
            step.status === 'pending' && 'opacity-50'
          )}
        >
          <div className="relative">
            {step.status === 'completed' && (
              <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center animate-in zoom-in duration-300">
                <svg
                  className="h-4 w-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            )}
            {step.status === 'loading' && (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            )}
            {step.status === 'pending' && (
              <div className="h-6 w-6 rounded-full border-2 border-muted" />
            )}
            {step.status === 'error' && (
              <div className="h-6 w-6 rounded-full bg-red-500 flex items-center justify-center animate-in zoom-in duration-300">
                <svg
                  className="h-4 w-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
            )}
          </div>

          <div className="flex-1">
            <p
              className={cn(
                'text-sm font-medium transition-colors duration-300',
                step.status === 'completed' &&
                  'text-green-600 dark:text-green-400',
                step.status === 'error' && 'text-red-600 dark:text-red-400',
                step.status === 'loading' && 'text-primary'
              )}
            >
              {step.label}
            </p>
            {step.status === 'loading' &&
              currentMessage &&
              index === steps.findIndex(s => s.status === 'loading') && (
                <p className="text-xs text-muted-foreground mt-1 animate-in fade-in duration-500">
                  {currentMessage}
                </p>
              )}
          </div>

          {index < steps.length - 1 && (
            <div
              className={cn(
                'absolute left-3 top-8 w-px h-8 transition-colors duration-500',
                steps[index + 1].status !== 'pending'
                  ? 'bg-primary'
                  : 'bg-muted'
              )}
              style={{ transform: 'translateX(-50%)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
