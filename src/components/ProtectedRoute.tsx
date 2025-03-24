
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isRedirecting, setIsRedirecting] = useState(false);
  
  useEffect(() => {
    // Only redirect if not loading and no user
    if (!loading && !user && !isRedirecting) {
      setIsRedirecting(true);
      navigate(`/sign-in?returnTo=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
  }, [user, loading, navigate, location.pathname, isRedirecting]);

  // If loading or we have a user but data is still being loaded
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
          <p className="mt-4 text-gray-600">Loading your account...</p>
        </div>
      </div>
    );
  }

  // If we have a user and not loading, render children
  return user ? <>{children}</> : null;
};

export default ProtectedRoute;
