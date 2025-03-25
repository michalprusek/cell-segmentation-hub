
import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import { X } from "lucide-react" 
import { toast } from "sonner"
import { Button } from "./button"
import { useLanguage } from '@/contexts/LanguageContext';

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const { t } = useLanguage();

  const handleCloseAll = () => {
    toast.dismiss();
  }

  return (
    <>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        position="bottom-right"
        closeButton
        richColors
        expand={false}
        toastOptions={{
          classNames: {
            toast:
              "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            description: "group-[.toast]:text-muted-foreground",
            actionButton:
              "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
            cancelButton:
              "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          },
        }}
        {...props}
      />
      <Button 
        variant="outline" 
        size="sm" 
        className="fixed bottom-4 right-4 z-[100] opacity-0 group-[.toaster]:opacity-100 transition-opacity duration-200"
        onClick={handleCloseAll}
      >
        <X className="h-4 w-4 mr-2" />
        {t('common.cancel')}
      </Button>
    </>
  )
}

export { Toaster }
