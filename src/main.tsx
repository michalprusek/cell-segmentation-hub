
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tailwind.css'
import { toast, Toaster } from 'sonner'

// Global error handler
const handleError = (error: ErrorEvent) => {
  console.error('Global error:', error);
  toast.error('Došlo k neočekávané chybě. Prosím, zkuste to znovu.', {
    duration: 3000,
    id: 'global-error', // Prevent duplicate toasts
  });
  
  // Log detailed error information
  if (error.error && error.error.stack) {
    console.error('Error stack:', error.error.stack);
  }
};

// Add global error listener
window.addEventListener('error', handleError);
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  toast.error('Operace selhala. Prosím, zkuste to znovu.', {
    duration: 3000,
    id: 'promise-error', // Prevent duplicate toasts
  });
});

// Add fallback for cursor reset in case mouse up events are missed
window.addEventListener('mouseup', () => {
  // Reset cursor if mouse up happens outside of components
  document.body.style.cursor = '';
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-right" closeButton />
  </React.StrictMode>,
)
