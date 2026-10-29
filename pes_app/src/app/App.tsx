import { MotionConfig } from "framer-motion";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "./components/ui/sonner";

function App() {
  return (
    // Reduced motion, once for the whole app: framer-motion drops transforms
    // and keeps only fades for anyone who asked their device for less motion.
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          {/* Toast host — sonner was installed but never mounted, so no
              transient success/error feedback was possible anywhere. */}
          <Toaster position="bottom-right" richColors closeButton />
        </AuthProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
