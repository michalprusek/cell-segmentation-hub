import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import {
  createLazyComponent,
  LazyWrapper,
} from '@/components/LazyComponentWrapper';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ModelProvider } from '@/contexts/ModelContext';
import WebSocketProvider from '@/contexts/WebSocketContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { logger } from '@/lib/logger';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ToastEventProvider } from '@/components/AuthToastProvider';
import { toast } from 'sonner';
import PageLoadingFallback from '@/components/PageLoadingFallback';

// Enhanced lazy load with better error handling and displayName support
const Index = createLazyComponent(() => import('./pages/Index'), 'Index');
const SignIn = createLazyComponent(() => import('./pages/SignIn'), 'SignIn');
const SignUp = createLazyComponent(() => import('./pages/SignUp'), 'SignUp');
const ForgotPassword = createLazyComponent(
  () => import('./pages/ForgotPassword'),
  'ForgotPassword'
);
const Dashboard = createLazyComponent(
  () => import('./pages/Dashboard'),
  'Dashboard'
);
const ProjectDetail = createLazyComponent(
  () => import('./pages/ProjectDetail'),
  'ProjectDetail'
);
const SegmentationEditor = createLazyComponent(
  () => import('./pages/segmentation/SegmentationEditor'),
  'SegmentationEditor'
);
const NotFound = createLazyComponent(
  () => import('./pages/NotFound'),
  'NotFound'
);
const Settings = createLazyComponent(
  () => import('./pages/Settings'),
  'Settings'
);
const Profile = createLazyComponent(() => import('./pages/Profile'), 'Profile');
const TermsOfService = createLazyComponent(
  () => import('./pages/TermsOfService'),
  'TermsOfService'
);
const PrivacyPolicy = createLazyComponent(
  () => import('./pages/PrivacyPolicy'),
  'PrivacyPolicy'
);
const Documentation = createLazyComponent(
  () => import('./pages/Documentation'),
  'Documentation'
);
const ProjectExport = createLazyComponent(
  () => import('./pages/export/ProjectExport'),
  'ProjectExport'
);
const ShareAccept = createLazyComponent(
  () => import('./pages/ShareAccept'),
  'ShareAccept'
);

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
                            path="/share/accept/:token"
                            element={
                              <Suspense fallback={<PageLoadingFallback />}>
                                <ShareAccept />
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
