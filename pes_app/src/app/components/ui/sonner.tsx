import { Toaster as Sonner, ToasterProps } from "sonner";
import { useTheme } from "../../context/ThemeContext";

/**
 * Toast host.
 *
 * The generated version of this file imported `Toaster` from its own path
 * (an infinite self-import) and pulled `useTheme` from `next-themes`, which
 * this project does not use — so it could never be mounted. It now reads the
 * app's own ThemeContext and renders the real sonner Toaster.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { isDark } = useTheme();

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
