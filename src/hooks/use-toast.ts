
import { toast as sonnerToast, type ToastT } from "sonner";

type ToastProps = {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
};

export function toast({ title, description, variant = "default" }: ToastProps) {
  const options: ToastT = {
    className: variant === "destructive" ? "destructive" : "",
  };

  return sonnerToast(title, {
    description,
    ...options,
  });
}

export const useToast = () => {
  return { toast };
};
