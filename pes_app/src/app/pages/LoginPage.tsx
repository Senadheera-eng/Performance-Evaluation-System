import { useState } from "react";
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
  const { signIn } = useAuth();
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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        backgroundColor: "white",
        colorScheme: "light" as const,
      }}
    >
      {/* Left Side */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          backgroundColor: "white",
          position: "relative",
          overflow: "hidden",
        }}
        className="w-full lg:w-1/2 flex items-center justify-center p-8"
      >
        <div
          className="absolute top-0 left-0 w-72 h-72 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"
          style={{ background: "rgba(196,30,58,0.05)" }}
        />
        <div
          className="absolute bottom-0 right-0 w-96 h-96 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"
          style={{ background: "rgba(196,30,58,0.03)" }}
        />

        <div className="w-full max-w-md relative z-10">
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
                <h1 className="text-2xl font-bold" style={{ color: "#111827" }}>
                  PES
                </h1>
                <p className="text-sm" style={{ color: "#6b7280" }}>
                  Performance Evaluation System
                </p>
              </div>
            </div>
            <h2
              className="text-3xl font-bold mb-2"
              style={{ color: "#111827" }}
            >
              Welcome Back
            </h2>
            <p style={{ color: "#6b7280" }}>
              Sign in to access your academic dashboard
            </p>
          </motion.div>

          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            onSubmit={handleLogin}
            className="space-y-6"
          >
            {/* Email */}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium"
                style={{ color: "#111827" }}
              >
                University Email
              </label>
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5"
                  style={{ color: "#9ca3af" }}
                />
                <Input
                  id="email"
                  type="email"
                  placeholder="yourname@foe.sjp.ac.lk"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12"
                  style={{
                    backgroundColor: "#f9fafb",
                    color: "#111827",
                    borderColor: "#e5e7eb",
                  }}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium"
                style={{ color: "#111827" }}
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5"
                  style={{ color: "#9ca3af" }}
                />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your LMS password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-12"
                  style={{
                    backgroundColor: "#f9fafb",
                    color: "#111827",
                    borderColor: "#e5e7eb",
                  }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "#9ca3af" }}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) =>
                    setRememberMe(checked as boolean)
                  }
                />
                <label
                  htmlFor="remember"
                  className="text-sm cursor-pointer"
                  style={{ color: "#6b7280" }}
                >
                  Remember me
                </label>
              </div>
              <button
                type="button"
                className="text-sm font-medium"
                style={{ color: "#C41E3A" }}
              >
                Forgot password?
              </button>
            </div>

            {/* Error */}
            {error && (
              <div
                className="p-3 rounded-lg"
                style={{
                  backgroundColor: "rgba(196,30,58,0.08)",
                  border: "1px solid rgba(196,30,58,0.2)",
                }}
              >
                <p className="text-sm" style={{ color: "#C41E3A" }}>
                  {error}
                </p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 font-semibold group"
              style={{ backgroundColor: "#C41E3A", color: "white" }}
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div
                    className="w-4 h-4 border-2 rounded-full animate-spin"
                    style={{
                      borderColor: "rgba(255,255,255,0.3)",
                      borderTopColor: "white",
                    }}
                  />
                  Signing in...
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  Sign In
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </div>
              )}
            </Button>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div
                  className="w-full border-t"
                  style={{ borderColor: "#e5e7eb" }}
                />
              </div>
              <div className="relative flex justify-center text-sm">
                <span
                  className="px-4 text-sm"
                  style={{ backgroundColor: "white", color: "#9ca3af" }}
                >
                  University of Sri Jayewardenepura
                </span>
              </div>
            </div>

            {/* Footer */}
            <p className="text-center text-sm" style={{ color: "#9ca3af" }}>
              For support, contact{" "}
              <a
                href="mailto:support@sjp.ac.lk"
                className="font-medium"
                style={{ color: "#C41E3A" }}
              >
                support@sjp.ac.lk
              </a>
            </p>
          </motion.form>
        </div>
      </motion.div>

      {/* Right Side */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="hidden lg:flex lg:w-1/2 relative items-center justify-center overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #C41E3A 0%, #8B1538 50%, #6D28D9 100%)",
        }}
      >
        <div className="absolute inset-0">
          <motion.div
            animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl"
            style={{ background: "rgba(255,255,255,0.08)" }}
          />
          <motion.div
            animate={{ scale: [1.2, 1, 1.2], rotate: [90, 0, 90] }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full blur-3xl"
            style={{ background: "rgba(255,255,255,0.06)" }}
          />
        </div>

        <div className="absolute inset-0" style={{ opacity: 0.08 }}>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)",
              backgroundSize: "50px 50px",
            }}
          />
        </div>

        <div className="relative z-10 text-center px-12">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="space-y-6"
          >
            <div
              className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <img
                src={universityLogo}
                alt="USJ Logo"
                className="w-16 h-16 object-cover rounded-2xl"
              />
            </div>

            <h2
              className="text-4xl font-bold leading-tight"
              style={{ color: "white" }}
            >
              Faculty of Engineering
            </h2>
            <p className="text-lg" style={{ color: "rgba(255,255,255,0.85)" }}>
              University of Sri Jayewardenepura
            </p>
            <p
              className="text-sm max-w-sm mx-auto"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              Performance Evaluation System — Your complete academic companion
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
