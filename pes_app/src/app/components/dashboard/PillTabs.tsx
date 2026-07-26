import { motion } from "framer-motion";

export interface PillTabItem {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
}

interface PillTabsProps {
  tabs: PillTabItem[];
  activeTab: string;
  onChange: (value: string) => void;
  className?: string;
  layoutId?: string;
}

/**
 * Shared pill-style tab bar with an animated sliding red highlight on the
 * active tab. Used across Courses, Enrollment, Graduation Planner, and
 * Results so the "which tab am I on" indicator looks and behaves the same
 * everywhere, in both light and dark mode.
 */
export function PillTabs({
  tabs,
  activeTab,
  onChange,
  className = "",
  layoutId = "pill-tab-indicator",
}: PillTabsProps) {
  return (
    <div
      className={`flex gap-1 p-1 rounded-lg bg-muted overflow-x-auto no-scrollbar ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className="relative flex-shrink-0 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium whitespace-nowrap"
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg"
                style={{ backgroundColor: "#C41E3A" }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span
              className={`relative z-10 flex items-center gap-2 ${
                isActive ? "text-white" : "text-muted-foreground"
              }`}
            >
              {Icon && <Icon className="h-4 w-4" />}
              {tab.label}
            </span>
            {tab.count !== undefined && (
              <span
                className="relative z-10 text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={
                  isActive
                    ? {
                        backgroundColor: "rgba(255,255,255,0.25)",
                        color: "white",
                      }
                    : { backgroundColor: "rgba(128,128,128,0.2)" }
                }
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
