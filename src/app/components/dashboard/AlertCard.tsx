import { AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { Card, CardContent } from "../ui/card";

interface AlertCardProps {
  type: "success" | "warning" | "error" | "info";
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function AlertCard({ type, title, message, action }: AlertCardProps) {
  const config = {
    success: {
      icon: CheckCircle,
      bgColor: "bg-green-50",
      borderColor: "border-green-200",
      iconColor: "text-green-600",
      textColor: "text-green-900",
      buttonColor: "bg-green-600 hover:bg-green-700 text-white",
    },
    warning: {
      icon: AlertTriangle,
      bgColor: "bg-yellow-50",
      borderColor: "border-yellow-200",
      iconColor: "text-yellow-600",
      textColor: "text-yellow-900",
      buttonColor: "bg-yellow-600 hover:bg-yellow-700 text-white",
    },
    error: {
      icon: AlertCircle,
      bgColor: "bg-red-50",
      borderColor: "border-red-200",
      iconColor: "text-red-600",
      textColor: "text-red-900",
      buttonColor: "bg-red-600 hover:bg-red-700 text-white",
    },
    info: {
      icon: Info,
      bgColor: "bg-blue-50",
      borderColor: "border-blue-200",
      iconColor: "text-blue-600",
      textColor: "text-blue-900",
      buttonColor: "bg-blue-600 hover:bg-blue-700 text-white",
    },
  };

  const { icon: Icon, bgColor, borderColor, iconColor, textColor, buttonColor } = config[type];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={`${bgColor} ${borderColor} border-2`}>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Icon className={`h-5 w-5 ${iconColor} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 space-y-1">
              <h4 className={`text-sm font-semibold ${textColor}`}>{title}</h4>
              <p className={`text-sm ${textColor}/80`}>{message}</p>
              {action && (
                <button
                  onClick={action.onClick}
                  className={`mt-2 px-3 py-1.5 rounded-lg text-sm font-medium ${buttonColor} transition-colors`}
                >
                  {action.label}
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
