
import { toast as sonnerToast, type ToastT } from "sonner";
import { useState, useEffect } from "react";
import { ReactElement } from "react";

type ToastProps = {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
};

type Toast = {
  id: string | number;
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
  action?: ReactElement;
};

export function toast({ title, description, variant = "default" }: ToastProps) {
  const options: ToastT = {
    id: Date.now(),
    className: variant === "destructive" ? "destructive" : "",
  };

  return sonnerToast(title, {
    description,
    ...options,
  });
}

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Pro účely zobrazení v Toaster komponentě
  // (Ve skutečnosti používáme sonner, ale toaster.tsx to očekává)
  return { 
    toast,
    toasts 
  };
};
