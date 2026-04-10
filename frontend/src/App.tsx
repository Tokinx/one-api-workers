import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout";
import { Toaster } from "./components/ui/toaster";
import { useAuthStore } from "./store/auth";
import { Dashboard } from "./pages/Dashboard";
import { Channels } from "./pages/Channels";
import { Tokens } from "./pages/Tokens";
import { Pricing } from "./pages/Pricing";
import { ApiTest } from "./pages/ApiTest";
import { NotFound } from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function HomeRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return <Navigate to="/channels" replace />;
  }

  return <Dashboard />;
}

function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AppLayout>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route
              path="/api-test"
              element={
                <ProtectedRoute>
                  <ApiTest />
                </ProtectedRoute>
              }
            />
            <Route
              path="/channels"
              element={
                <ProtectedRoute>
                  <Channels />
                </ProtectedRoute>
              }
            />
            <Route
              path="/channels/new"
              element={
                <ProtectedRoute>
                  <Channels createMode />
                </ProtectedRoute>
              }
            />
            <Route
              path="/channels/edit/:key"
              element={
                <ProtectedRoute>
                  <Channels editRoute />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tokens"
              element={
                <ProtectedRoute>
                  <Tokens />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tokens/new"
              element={
                <ProtectedRoute>
                  <Tokens createMode />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tokens/edit/:key"
              element={
                <ProtectedRoute>
                  <Tokens editRoute />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pricing"
              element={
                <ProtectedRoute>
                  <Pricing />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
}

export default App;
