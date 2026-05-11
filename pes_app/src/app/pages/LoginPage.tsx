import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import universityLogo from "../../assets/logo.jpg";

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, user, student, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      navigate(student?.role === "dept_admin" ? "/admin" : "/app", {
        replace: true,
      });
    }
  }, [user, student, authLoading, navigate]);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error, role } = await signIn(email, password);

    if (error) {
      setError("Invalid email or password. Please try again.");
      setLoading(false);
      return;
    }

    if (role === "dept_admin") {
      navigate("/admin");
    } else {
      navigate("/app");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Login Form */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white relative overflow-hidden"
      >
        {/* Decorative Elements */}
        <div className="absolute top-0 left-0 w-72 h-72 bg-primary/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-secondary/5 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />

        <div className="w-full max-w-md relative z-10">
          {/* Logo and Branding */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="mb-10"
          >
            <div className="flex items-center gap-4 mb-6">
              <img
                src={universityLogo}
                alt="University Logo"
                className="w-16 h-16 object-cover rounded-lg"
              />
              <div>
                <h1 className="text-2xl font-bold text-foreground">PES</h1>
                <p className="text-sm text-muted-foreground">
                  Performance Evaluation System
                </p>
              </div>
            </div>
            <h2 className="text-3xl font-bold text-foreground mb-2">
              Welcome Back
            </h2>
            <p className="text-muted-foreground">
              Sign in to access your academic dashboard
            </p>
          </motion.div>

          {/* Login Form */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            onSubmit={handleLogin}
            className="space-y-5"
          >
            {/* Email Field */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                University Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="yourname@eng.sjp.ac.lk"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your LMS password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) =>
                    setRememberMe(checked as boolean)
                  }
                />
                <label
                  htmlFor="remember"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  Remember me
                </label>
              </div>
              <button
                type="button"
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 rounded-xl transition-all duration-200"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  Sign In
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </Button>

            {/* Footer Note */}
            <p className="text-center text-xs text-muted-foreground pt-2">
              Use your university email and LMS password to sign in.
              <br />
              Contact the IT department if you face any issues.
            </p>
          </motion.form>
        </div>
      </motion.div>

      {/* Right Side - Decorative Panel */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="hidden lg:flex lg:w-1/2 items-center justify-center p-12 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #C41E3A 0%, #8B1538 50%, #6D28D9 100%)",
        }}
      >
        {/* Background decorative circles */}
        <div
          className="absolute top-0 right-0 w-96 h-96 rounded-full -translate-y-1/2 translate-x-1/2"
          style={{ background: "rgba(255,255,255,0.05)" }}
        />
        <div
          className="absolute bottom-0 left-0 w-64 h-64 rounded-full translate-y-1/2 -translate-x-1/2"
          style={{ background: "rgba(255,255,255,0.05)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 w-80 h-80 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{ background: "rgba(255,255,255,0.05)" }}
        />

        <div className="relative z-10 text-center max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8 }}
          >
            {/* Logo circle */}
            <div
              className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-8"
              style={{
                background: "rgba(255,255,255,0.1)",
                backdropFilter: "blur(10px)",
              }}
            >
              <img
                src={universityLogo}
                alt="USJ Logo"
                className="w-16 h-16 object-cover rounded-2xl"
              />
            </div>

            <h2
              className="text-4xl font-bold mb-4 leading-tight"
              style={{ color: "white" }}
            >
              Faculty of Engineering
            </h2>
            <p
              className="text-lg mb-2"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              University of Sri Jayewardenepura
            </p>
            <p
              className="text-sm mb-10"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              Performance Evaluation System — Your complete academic companion
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-3 justify-center">
              {[
                "GPA Tracking",
                "Attendance Monitor",
                "AI Assistant",
                "Result Predictions",
                "Course Enrollment",
              ].map((feature) => (
                <span
                  key={feature}
                  className="px-4 py-2 rounded-full text-sm"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: "rgba(255,255,255,0.9)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  {feature}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
