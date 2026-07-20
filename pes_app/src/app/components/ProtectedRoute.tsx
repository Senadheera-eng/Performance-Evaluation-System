import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../../lib/types";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRole?: Role | Role[];
}

export default function ProtectedRoute({
  children,
  allowedRole,
}: ProtectedRouteProps) {
  const { user, student, loading } = useAuth();
  const allowedRoles = allowedRole
    ? Array.isArray(allowedRole)
      ? allowedRole
      : [allowedRole]
    : null;

  // Still checking auth — show spinner
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in → go to login
  if (!user) return <Navigate to="/" replace />;

  // Logged in but student profile not loaded yet — wait
  if (allowedRole && !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Loading profile...</p>
        </div>
      </div>
    );
  }

  // Wrong role → redirect
  if (allowedRoles && (!student || !allowedRoles.includes(student.role))) {
    if (student?.role === "dept_admin" || student?.role === "super_admin") {
      return <Navigate to="/admin" replace />;
    }
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
