import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

const LoadingSpinner = ({ size = 'md', message }: LoadingSpinnerProps) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] space-y-4">
      <Loader2
        className={`animate-spin text-muted-foreground ${sizeClasses[size]}`}
      />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
