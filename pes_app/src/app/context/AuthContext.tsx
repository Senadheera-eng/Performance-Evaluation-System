import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { Student } from "../../lib/types";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  student: Student | null;
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
  const [loading, setLoading] = useState(true);

  const fetchStudentProfile = async (userId: string) => {
    // Admins live in a separate table from students — check there first.
    // Normalized into the same Student shape (with the student-only fields
    // nulled out) so every existing consumer of `student` keeps working
    // unchanged regardless of which table the profile came from.
    const { data: admin } = await supabase
      .from("admins")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (admin) {
      return {
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
      } as Student;
    }

    const { data } = await supabase
      .from("students")
      .select("*")
      .eq("id", userId)
      .single();
    return data as Student | null;
  };

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep this synchronous — no Supabase DB calls here.
      // Calling supabase.from() inside onAuthStateChange deadlocks
      // because the client is still processing the auth response.
      setSession(session ?? null);
      setUser(session?.user ?? null);
      if (!session?.user) setStudent(null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch student profile whenever the logged-in user changes
  useEffect(() => {
    if (!user) return;
    fetchStudentProfile(user.id).then((profile) => setStudent(profile));
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { error: error.message, role: null };

    if (data.user) {
      const { data: adminData } = await supabase
        .from("admins")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      if (adminData) return { error: null, role: adminData.role };

      const { data: studentData } = await supabase
        .from("students")
        .select("role")
        .eq("id", data.user.id)
        .single();

      return { error: null, role: studentData?.role ?? "student" };
    }

    return { error: null, role: "student" };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, student, loading, signIn, signOut }}
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
