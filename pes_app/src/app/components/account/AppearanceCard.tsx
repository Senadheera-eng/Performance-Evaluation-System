import { motion } from "framer-motion";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { SPRING, SectionCard } from "../common";
import { cn } from "../ui/utils";
import { useTheme, type MainColour } from "../../context/ThemeContext";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "Auto", icon: Monitor },
] as const;

/* The main colours, in the order they are offered. Each swatch is drawn
   with --swatch-*, in the shade the current mode will use. */
const MAIN_COLOUR_OPTIONS: { value: MainColour; label: string }[] = [
  { value: "crimson", label: "Crimson" },
  { value: "blue", label: "Blue" },
  { value: "indigo", label: "Indigo" },
  { value: "violet", label: "Violet" },
  { value: "teal", label: "Teal" },
  { value: "graphite", label: "Graphite" },
];

/**
 * How PES looks on this device: light, dark or the device's own setting,
 * and the main colour. Shared by every portal's Settings page, so a
 * lecturer and an admin choose exactly as a student does. Both choices are
 * kept by ThemeContext in this browser, not on the account.
 */
export function AppearanceCard({ className }: { className?: string }) {
  const { theme, setTheme, mainColour, setMainColour } = useTheme();

  return (
    <SectionCard
      title="Appearance"
      description="How PES looks on this device."
      className={className}
    >
      <h3 id="settings-theme-label" className="mb-2 text-xs font-medium text-muted-foreground">
        Theme
      </h3>
      <div
        role="radiogroup"
        aria-labelledby="settings-theme-label"
        aria-describedby="settings-theme-hint"
        className="grid grid-cols-3 gap-3"
      >
        {THEMES.map(({ value, label, icon: Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(value)}
              className={cn(
                "relative rounded-control border-2 border-border p-3 text-center transition-colors",
                !active && "hover:border-primary/40 hover:bg-muted/40",
              )}
            >
              {/* The selection slides from one option to the next, with
                  the tabs' spring. */}
              {active && (
                <motion.span
                  layoutId="settings-theme-active"
                  transition={SPRING}
                  className="absolute -inset-0.5 rounded-control border-2 border-primary bg-primary/5"
                  aria-hidden="true"
                />
              )}
              <span className="relative block">
                <Icon
                  className={cn(
                    "mx-auto mb-1.5 h-5 w-5 transition-colors",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                />
                <span className="block text-sm font-medium text-foreground">{label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p id="settings-theme-hint" className="mt-2 text-xs text-muted-foreground">
        Auto follows your device's light or dark setting.
      </p>

      <div className="mt-5 border-t border-border/70 pt-4">
        <h3 id="settings-colour-label" className="mb-2 text-xs font-medium text-muted-foreground">
          Main colour
        </h3>
        <div
          role="radiogroup"
          aria-labelledby="settings-colour-label"
          aria-describedby="settings-colour-hint"
          className="grid grid-cols-3 gap-2 sm:gap-3"
        >
          {MAIN_COLOUR_OPTIONS.map(({ value, label }) => {
            const active = mainColour === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMainColour(value)}
                className={cn(
                  "relative flex min-w-0 items-center gap-2 rounded-control border-2 border-border px-2.5 py-2 text-left transition-colors",
                  !active && "hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="settings-colour-active"
                    transition={SPRING}
                    className="absolute -inset-0.5 rounded-control border-2 border-primary bg-primary/5"
                    aria-hidden="true"
                  />
                )}
                <span
                  className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
                  style={{ backgroundColor: `var(--swatch-${value})` }}
                  aria-hidden="true"
                >
                  {active && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </span>
                <span className="relative truncate text-sm font-medium text-foreground">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
        <p id="settings-colour-hint" className="mt-2 text-xs text-muted-foreground">
          Buttons, links and highlights take this colour. Warnings and
          failing grades stay red whichever you choose.
        </p>
      </div>
    </SectionCard>
  );
}
