import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { Student, StaffContext } from "../../lib/types";
import { loadSettings } from "../../lib/settings";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  student: Student | null;
  /** Set only for lecturers; carries the HOD appointment if they hold one. */
  staff: StaffContext | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; role: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [staff, setStaff] = useState<StaffContext | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Resolve the signed-in user against the three identity tables, in the same
   * order the database's own get_my_role() helper uses so the client and RLS
   * can never disagree about who someone is: admins, then lecturers, then
   * students. Each is normalised into the one Student shape.
   */
  const fetchProfile = async (
    userId: string,
  ): Promise<{ profile: Student | null; staff: StaffContext | null }> => {
    const { data: admin } = await supabase
      .from("admins")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (admin) {
      return {
        profile: {
          id: admin.id,
          reg_number: null,
          index_number: null,
          name: admin.name,
          email: admin.email,
          department: admin.department,
          batch_year: null,
          role: admin.role,
          status: admin.status,
          created_at: admin.created_at,
        } as Student,
        staff: null,
      };
    }

    const { data: lecturer } = await supabase
      .from("lecturers")
      .select("id, name, title, email, department, status, created_at")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (lecturer) {
      // The headship is a separate, time-bounded row rather than a column on
      // the lecturer, so an appointment can end without touching the person.
      const { data: appointment } = await supabase
        .from("hod_appointments")
        .select("department")
        .eq("lecturer_id", lecturer.id)
        .eq("is_active", true)
        .maybeSingle();

      return {
        profile: {
          id: userId,
          reg_number: null,
          index_number: null,
          name: lecturer.title ? `${lecturer.title} ${lecturer.name}` : lecturer.name,
          email: lecturer.email,
          department: lecturer.department,
          batch_year: null,
          role: "lecturer",
          status: lecturer.status === "active" ? "active" : "withdrawn",
          created_at: lecturer.created_at,
        } as Student,
        staff: {
          lecturerId: lecturer.id,
          department: lecturer.department,
          title: lecturer.title ?? null,
          hodDepartment: appointment?.department ?? null,
        },
      };
    }

    const { data } = await supabase
      .from("students")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    return { profile: (data as Student | null) ?? null, staff: null };
  };

  // Pull the regulation engine (attendance thresholds, grading scale, etc.)
  // once per session; every consumer falls back to faculty defaults until
  // this resolves, so nothing blocks on it.
  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep this synchronous — no Supabase DB calls here.
      // Calling supabase.from() inside onAuthStateChange deadlocks
      // because the client is still processing the auth response.
      setSession(session ?? null);
      setUser(session?.user ?? null);
      if (!session?.user) {
        setStudent(null);
        setStaff(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Resolve the profile whenever the logged-in user changes
  useEffect(() => {
    if (!user) return;
    fetchProfile(user.id).then(({ profile, staff: staffContext }) => {
      setStudent(profile);
      setStaff(staffContext);
    });
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { error: error.message, role: null };
    if (!data.user) return { error: null, role: "student" };

    // Same resolution order as fetchProfile, so the post-login redirect lands
    // on the portal the profile will actually resolve to.
    const { data: adminData } = await supabase
      .from("admins")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (adminData) return { error: null, role: adminData.role };

    const { data: lecturerData } = await supabase
      .from("lecturers")
      .select("id")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (lecturerData) return { error: null, role: "lecturer" };

    const { data: studentData } = await supabase
      .from("students")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    return { error: null, role: studentData?.role ?? "student" };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, student, staff, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
