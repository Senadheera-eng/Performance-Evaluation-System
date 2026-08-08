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

  // Wrong role → send them to the portal their own role owns, rather than
  // bouncing everyone to /app where a lecturer or admin has nothing.
  if (allowedRoles && (!student || !allowedRoles.includes(student.role))) {
    return <Navigate to={homeFor(student?.role)} replace />;
  }

  return <>{children}</>;
}

/** The portal a role belongs to. Kept next to the guard so a new role can
 *  never be added to `Role` without a home being decided for it. */
export function homeFor(role: Role | undefined): string {
  switch (role) {
    case "dept_admin":
    case "super_admin":
      return "/admin";
    case "lecturer":
      return "/staff";
    default:
      return "/app";
  }
}
