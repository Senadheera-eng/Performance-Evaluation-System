import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, GraduationCap, Landmark, Lock, Mail } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { useAuth } from "../context/AuthContext";
import { homeFor } from "../components/ProtectedRoute";
import type { Role } from "../../lib/types";
import universityLogo from "../../assets/logo.jpg";
import facultyBuilding from "../../assets/faculty-building-wide.png";

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
    navigate(homeFor((role ?? undefined) as Role | undefined));
    setLoading(false);
  };

  return (
    <main className="h-screen overflow-hidden bg-[#f7f8fa] p-3 text-[#111a3a] sm:p-5" style={{ colorScheme: "light" }}>
      <div className="mx-auto flex h-full min-h-0 max-w-[1540px] overflow-hidden rounded-[20px] border border-[#e4e7ec] bg-white shadow-[0_16px_55px_rgba(15,23,42,0.08)]">
        <motion.section
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex min-h-0 w-full items-center justify-center overflow-hidden bg-white px-6 py-5 lg:w-[48%] lg:px-12 xl:px-20"
        >
          <div className="w-full max-w-[520px]">
            <div className="mb-8 flex items-center gap-4">
              <img src={universityLogo} alt="University of Sri Jayewardenepura logo" className="h-16 w-16 rounded-full object-cover shadow-sm" />
              <div>
                <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-[#111a3a]">PES</h1>
                <p className="mt-0.5 text-[16px] text-[#7a8198]">Performance Evaluation System</p>
              </div>
            </div>

            <div className="mb-7">
              <h2 className="text-[34px] font-extrabold tracking-[-0.03em] text-[#111a3a]">Welcome Back</h2>
              <p className="mt-2 text-[18px] text-[#7a8198]">Sign in to access your academic dashboard</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="block text-[15px] font-semibold text-[#111a3a]">University Email</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9299ad]" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="yourname@foe.sjp.ac.lk"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-[52px] rounded-lg border-[#d7dbe4] bg-white pl-12 pr-12 text-[16px] text-[#111a3a] placeholder:text-[#9299ad] focus-visible:border-[#c81436] focus-visible:ring-[#c81436]/15"
                    required
                  />
                  <Lock aria-hidden="true" className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#596079]" />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-[15px] font-semibold text-[#111a3a]">Password</label>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9299ad]" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your LMS password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-[52px] rounded-lg border-[#d7dbe4] bg-white pl-12 pr-12 text-[16px] text-[#111a3a] placeholder:text-[#9299ad] focus-visible:border-[#c81436] focus-visible:ring-[#c81436]/15"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-1 text-[#9299ad] transition-colors hover:text-[#596079] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c81436]/30"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                    className="h-5 w-5 border-[#cfd4df] data-[state=checked]:border-[#c81436] data-[state=checked]:bg-[#c81436]"
                  />
                  <label htmlFor="remember" className="cursor-pointer text-[15px] text-[#5d6479]">Remember me</label>
                </div>
                <button type="button" className="text-[15px] font-semibold text-[#d11238] transition-colors hover:text-[#aa0e2c]">Forgot password?</button>
              </div>

              {error && (
                <div role="alert" className="rounded-lg border border-[#d11238]/20 bg-[#d11238]/[0.06] px-4 py-3 text-sm text-[#b40f30]">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="group h-[52px] w-full rounded-lg bg-[#d11238] text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(209,18,56,0.18)] transition-all hover:bg-[#ba0f32] hover:shadow-[0_10px_24px_rgba(209,18,56,0.25)]"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Sign In
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-7 flex items-center gap-4 text-[#a2a8b8]">
              <span className="h-px flex-1 bg-[#d8dce5]" />
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#d8dce5]">
                <GraduationCap className="h-5 w-5 text-[#596079]" />
              </span>
              <span className="h-px flex-1 bg-[#d8dce5]" />
            </div>

            <footer className="mt-3 text-center text-[15px] text-[#737b91]">
              <p>University of Sri Jayewardenepura</p>
              <p className="mt-2">
                For support, contact{" "}
                <a href="mailto:support@sjp.ac.lk" className="font-semibold text-[#d11238] hover:underline">support@sjp.ac.lk</a>
              </p>
            </footer>
          </div>
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative hidden h-full min-h-0 overflow-hidden lg:block lg:w-[52%]"
          aria-label="Faculty of Engineering"
        >
          <img src={facultyBuilding} alt="Faculty of Engineering, University of Sri Jayewardenepura" className="absolute inset-0 h-full w-full object-cover object-right" />
          <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(188,9,58,0.82)_0%,rgba(139,14,79,0.72)_48%,rgba(69,27,112,0.76)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(183,11,61,0.18)_0%,rgba(102,15,78,0.24)_45%,rgba(31,13,69,0.66)_100%)]" />
          <div
            className="absolute right-0 top-0 h-[38%] w-[44%] opacity-20"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.75) 1px, transparent 1.5px)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="relative z-10 flex min-h-full items-center justify-center px-12 py-16 text-center text-white">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.55 }}
              className="max-w-[560px]"
            >
              <img src={universityLogo} alt="University emblem" className="mx-auto h-[92px] w-[92px] rounded-full object-cover shadow-[0_8px_24px_rgba(0,0,0,0.25)]" />
              <h2 className="mt-8 text-[34px] font-extrabold tracking-[-0.025em] drop-shadow-sm xl:text-[40px]">Faculty of Engineering</h2>
              <p className="mt-3 text-[20px] font-semibold text-white/95 xl:text-[23px]">University of Sri Jayewardenepura</p>
              <div className="mx-auto mt-10 flex max-w-[320px] items-center gap-5 text-white/80">
                <span className="h-px flex-1 bg-white/45" />
                <Landmark className="h-5 w-5" />
                <span className="h-px flex-1 bg-white/45" />
              </div>
              <p className="mt-8 text-[17px] font-medium leading-relaxed text-white/95 xl:text-[19px]">
                Performance Evaluation System
                <br />
                Your complete academic companion
              </p>
            </motion.div>
          </div>
        </motion.aside>
      </div>
    </main>
  );
}
