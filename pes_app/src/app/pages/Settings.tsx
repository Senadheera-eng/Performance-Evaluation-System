import { useState } from "react";
import { motion } from "framer-motion";
import { User, Bell, Shield, Palette, Globe, Moon, Sun } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../../lib/supabase";

export default function Settings() {
  const [activeTab, setActiveTab] = useState("Account");
  const { theme, setTheme } = useTheme();
  const { student } = useAuth();

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const handleChangePassword = async () => {
    setFormError(null);
    setFormSuccess(null);
    if (newPassword.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setFormSuccess("Password updated successfully.");
    setNewPassword("");
    setConfirmPassword("");
    setTimeout(() => {
      setPasswordDialogOpen(false);
      setFormSuccess(null);
    }, 1500);
  };

  const settings = [
    { icon: User, label: "Account" },
    { icon: Bell, label: "Notifications" },
    { icon: Palette, label: "Appearance" },
    { icon: Shield, label: "Privacy & Security" },
    { icon: Globe, label: "Language" },
  ];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account preferences and application settings.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Settings Navigation */}
        <div className="lg:col-span-1">
          <Card className="border-border">
            <CardContent className="p-3">
              <nav className="space-y-1">
                {settings.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setActiveTab(item.label)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      activeTab === item.label
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </nav>
            </CardContent>
          </Card>
        </div>

        {/* Settings Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Account Settings */}
          {activeTab === "Account" && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Card className="border-border">
                <CardHeader>
                  <CardTitle>Account Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="email">Email Address</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {student?.email ?? "—"}
                      </p>
                    </div>
                    <Separator />
                    <div>
                      <Label htmlFor="index-number">Index Number</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {student?.index_number ?? "—"}
                      </p>
                    </div>
                    <Separator />
                    <div>
                      <Label htmlFor="reg-number">Registration Number</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {student?.reg_number ? `EN${student.reg_number}` : "—"}
                      </p>
                    </div>
                    <Separator />
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setFormError(null);
                          setFormSuccess(null);
                          setPasswordDialogOpen(true);
                        }}
                      >
                        Change Password
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Notification Settings */}
          {activeTab === "Notifications" && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-primary" />
                    Notification Preferences
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Attendance Alerts</Label>
                        <p className="text-sm text-muted-foreground">
                          Get notified when attendance drops below 80%
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Result Announcements</Label>
                        <p className="text-sm text-muted-foreground">
                          Receive notifications when new results are published
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>AI Assistant Insights</Label>
                        <p className="text-sm text-muted-foreground">
                          Get personalized academic recommendations
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Course Updates</Label>
                        <p className="text-sm text-muted-foreground">
                          Updates about course materials and announcements
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Email Notifications</Label>
                        <p className="text-sm text-muted-foreground">
                          Receive email summaries of important updates
                        </p>
                      </div>
                      <Switch />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Appearance Settings */}
          {activeTab === "Appearance" && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5 text-primary" />
                    Appearance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div>
                      <Label className="mb-2 block">Theme</Label>
                      <div className="grid grid-cols-3 gap-3">
                        <button
                          onClick={() => setTheme("light")}
                          className={`p-3 rounded-xl border-2 transition-colors ${
                            theme === "light"
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <Sun
                            className={`h-5 w-5 mx-auto mb-1.5 ${theme === "light" ? "text-primary" : "text-muted-foreground"}`}
                          />
                          <p className="text-sm font-medium">Light</p>
                        </button>
                        <button
                          onClick={() => setTheme("dark")}
                          className={`p-3 rounded-xl border-2 transition-colors ${
                            theme === "dark"
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <Moon
                            className={`h-5 w-5 mx-auto mb-1.5 ${theme === "dark" ? "text-primary" : "text-muted-foreground"}`}
                          />
                          <p className="text-sm font-medium">Dark</p>
                        </button>
                        <button
                          onClick={() => setTheme("auto")}
                          className={`p-3 rounded-xl border-2 transition-colors ${
                            theme === "auto"
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <div
                            className={`h-5 w-5 mx-auto mb-1.5 rounded-full bg-gradient-to-r from-yellow-400 to-blue-600 ${theme === "auto" ? "" : "opacity-75"}`}
                          />
                          <p className="text-sm font-medium">Auto</p>
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        {theme === "light" && "Using light theme"}
                        {theme === "dark" && "Using dark theme"}
                        {theme === "auto" && "Following system preferences"}
                      </p>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Compact Mode</Label>
                        <p className="text-sm text-muted-foreground">
                          Use a more compact layout to show more content
                        </p>
                      </div>
                      <Switch />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Privacy & Security */}
          {activeTab === "Privacy & Security" && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    Privacy & Security
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Two-Factor Authentication</Label>
                        <p className="text-sm text-muted-foreground">
                          Add an extra layer of security to your account
                        </p>
                      </div>
                      <Switch />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Profile Visibility</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow other students to view your profile
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Show Online Status</Label>
                        <p className="text-sm text-muted-foreground">
                          Let others see when you're active
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <Separator />
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                      >
                        Delete Account
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Language Settings */}
          {activeTab === "Language" && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-primary" />
                    Language & Region
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="language">Language</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        English (US)
                      </p>
                    </div>
                    <Separator />
                    <div>
                      <Label htmlFor="timezone">Timezone</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Asia/Colombo (UTC +5:30)
                      </p>
                    </div>
                    <Separator />
                    <div>
                      <Label htmlFor="date-format">Date Format</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        DD/MM/YYYY
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      </div>

      {/* Change Password Dialog */}
      <Dialog
        open={passwordDialogOpen}
        onOpenChange={(open) => {
          setPasswordDialogOpen(open);
          if (!open) {
            setNewPassword("");
            setConfirmPassword("");
            setFormError(null);
            setFormSuccess(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter a new password for your account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            {formSuccess && (
              <p className="text-sm text-green-600">{formSuccess}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPasswordDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleChangePassword} disabled={saving}>
              {saving ? "Saving..." : "Save Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
