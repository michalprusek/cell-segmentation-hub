import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ModelProvider } from '@/contexts/ModelContext';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { logger } from '@/lib/logger';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ToastEventProvider } from '@/components/AuthToastProvider';
import { toast } from 'sonner';
import PageLoadingFallback from '@/components/PageLoadingFallback';

// Lazy load all page components for code splitting
const Index = lazy(() => import('./pages/Index'));
const SignIn = lazy(() => import('./pages/SignIn'));
const SignUp = lazy(() => import('./pages/SignUp'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const SegmentationEditor = lazy(
  () => import('./pages/segmentation/SegmentationEditor')
);
const NotFound = lazy(() => import('./pages/NotFound'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const Documentation = lazy(() => import('./pages/Documentation'));
const ProjectExport = lazy(() => import('./pages/export/ProjectExport'));

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
      <BrowserRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
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
                      <ErrorBoundary>
                        <Routes>
                          <Route
                            path="/"
                            element={
                              <Suspense fallback={<PageLoadingFallback />}>
                                <Index />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/sign-in"
                            element={
                              <Suspense
                                fallback={<PageLoadingFallback type="form" />}
                              >
                                <SignIn />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/sign-up"
                            element={
                              <Suspense
                                fallback={<PageLoadingFallback type="form" />}
                              >
                                <SignUp />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/forgot-password"
                            element={
                              <Suspense
                                fallback={<PageLoadingFallback type="form" />}
                              >
                                <ForgotPassword />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/documentation"
                            element={
                              <Suspense fallback={<PageLoadingFallback />}>
                                <Documentation />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/terms-of-service"
                            element={
                              <Suspense fallback={<PageLoadingFallback />}>
                                <TermsOfService />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/privacy-policy"
                            element={
                              <Suspense fallback={<PageLoadingFallback />}>
                                <PrivacyPolicy />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/dashboard"
                            element={
                              <ProtectedRoute>
                                <Suspense
                                  fallback={
                                    <PageLoadingFallback type="dashboard" />
                                  }
                                >
                                  <Dashboard />
                                </Suspense>
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/project/:id"
                            element={
                              <ProtectedRoute>
                                <Suspense
                                  fallback={
                                    <PageLoadingFallback type="dashboard" />
                                  }
                                >
                                  <ProjectDetail />
                                </Suspense>
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/segmentation/:projectId/:imageId"
                            element={
                              <ProtectedRoute>
                                <Suspense
                                  fallback={
                                    <PageLoadingFallback type="editor" />
                                  }
                                >
                                  <SegmentationEditor />
                                </Suspense>
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/project/:id/export"
                            element={
                              <ProtectedRoute>
                                <Suspense fallback={<PageLoadingFallback />}>
                                  <ProjectExport />
                                </Suspense>
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/settings"
                            element={
                              <ProtectedRoute>
                                <Suspense
                                  fallback={<PageLoadingFallback type="form" />}
                                >
                                  <Settings />
                                </Suspense>
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/profile"
                            element={
                              <ProtectedRoute>
                                <Suspense
                                  fallback={<PageLoadingFallback type="form" />}
                                >
                                  <Profile />
                                </Suspense>
                              </ProtectedRoute>
                            }
                          />

                          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                          <Route
                            path="*"
                            element={
                              <Suspense fallback={<PageLoadingFallback />}>
                                <NotFound />
                              </Suspense>
                            }
                          />
                        </Routes>
                      </ErrorBoundary>
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
