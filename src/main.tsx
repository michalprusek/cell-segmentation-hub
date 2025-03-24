
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tailwind.css'
import { toast } from 'sonner'

// Global error handler
const handleError = (error: ErrorEvent) => {
  console.error('Global error:', error);
  toast.error('An unexpected error occurred. Please try again.');
  
  // Log detailed error information
  if (error.error && error.error.stack) {
    console.error('Error stack:', error.error.stack);
  }
};

// Add global error listener
window.addEventListener('error', handleError);
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  toast.error('An operation failed. Please try again.');
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
