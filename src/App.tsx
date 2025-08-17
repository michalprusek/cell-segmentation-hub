import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ModelProvider } from '@/contexts/ModelContext';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { logger } from '@/lib/logger';

import Index from './pages/Index';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import SegmentationEditor from './pages/segmentation/SegmentationEditor';
import NotFound from './pages/NotFound';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import TermsOfService from './pages/TermsOfService';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Documentation from './pages/Documentation';
import ProjectExport from './pages/export/ProjectExport';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ToastEventProvider } from '@/components/AuthToastProvider';
import { toast } from 'sonner';

// Create a client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 60000, // 1 minute (reduces unnecessary refetches)
    },
    mutations: {
      onError: (error: unknown) => {
        logger.error('Mutation error:', error);
        // Note: Cannot use t() here as this is outside LanguageProvider scope
        toast.error('Failed to update data. Please try again.');
      },
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <WebSocketProvider>
            <ThemeProvider>
              <LanguageProvider>
                <ToastEventProvider>
                  <ModelProvider>
                    <Sonner
                      position="bottom-right"
                      closeButton
                      toastOptions={{
                        className: 'animate-slide-in-right',
                      }}
                    />
                    <div className="app-container animate-fade-in">
                      <Routes>
                        <Route path="/" element={<Index />} />
                        <Route path="/sign-in" element={<SignIn />} />
                        <Route path="/sign-up" element={<SignUp />} />
                        <Route
                          path="/documentation"
                          element={<Documentation />}
                        />
                        <Route
                          path="/terms-of-service"
                          element={<TermsOfService />}
                        />
                        <Route
                          path="/privacy-policy"
                          element={<PrivacyPolicy />}
                        />
                        <Route
                          path="/dashboard"
                          element={
                            <ProtectedRoute>
                              <Dashboard />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/project/:id"
                          element={
                            <ProtectedRoute>
                              <ProjectDetail />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/segmentation/:projectId/:imageId"
                          element={
                            <ProtectedRoute>
                              <SegmentationEditor />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/project/:id/export"
                          element={
                            <ProtectedRoute>
                              <ProjectExport />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/settings"
                          element={
                            <ProtectedRoute>
                              <Settings />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/profile"
                          element={
                            <ProtectedRoute>
                              <Profile />
                            </ProtectedRoute>
                          }
                        />

                        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </div>
                  </ModelProvider>
                </ToastEventProvider>
              </LanguageProvider>
            </ThemeProvider>
          </WebSocketProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
