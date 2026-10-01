/**
 * The batches in PES, as the Super Admin manages them: bringing an intake in,
 * dividing it into departments, and removing it once it has left.
 *
 * Reading goes through security-definer RPCs that refuse anyone but the
 * Super Admin. Creating and deleting sign-in accounts needs the service role,
 * so those two go through the manage-batches edge function, which checks the
 * caller the same way before doing anything.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { CreatedStudent } from "./batchIntake";

export interface BatchSummary {
  batch_year: number;
  students: number;
  active: number;
  /** The semester the batch is in: one past its last published results. */
  semester: number;
  departments: { department: string | null; students: number }[];
  last_added: string | null;
}

export interface BatchFootprint {
  batch_year: number;
  semester: number;
  students: number;
  active: number;
  results: number;
  attendance: number;
  enrollments: number;
  medical_submissions: number;
  mentor_messages: number;
  feedback_submissions: number;
  notifications: number;
}

export interface IntakeResult {
  reg_number: string;
  name: string;
  email: string;
  ok: boolean;
  error?: string;
  index_number?: string | null;
  department?: string | null;
  password?: string;
}

export interface RemovalResult {
  batch_year: number;
  removed: BatchFootprint & { files: number; accounts: number; feedback_deleted: number };
  feedback_kept_anonymously: boolean;
  failures: string[];
}

/** A batch's semester in words: past Semester 8 it has finished. */
export const describeStage = (semester: number) =>
  semester > 8 ? "Finished Semester 8" : `Semester ${semester}`;

/** The intake each sheet chunk is sent in: well inside the function's limit. */
export const INTAKE_CHUNK = 40;

async function invoke<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<T>("manage-batches", { body });
  if (error) {
    // The function says what went wrong in its body; the client only says
    // that the status was not 2xx.
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null);
      if (detail?.error) return { data: null, error: String(detail.error) };
    }
    return { data: null, error: error.message };
  }
  return { data: data ?? null, error: null };
}

export function addStudents(
  batchYear: number,
  students: {
    name: string;
    reg_number: string;
    index_number: string | null;
    email: string;
    department: string | null;
  }[],
) {
  return invoke<{ batch_year: number; created: number; results: IntakeResult[] }>({
    action: "intake",
    batch_year: batchYear,
    students,
  });
}

export function removeBatch(batchYear: number, keepFeedback: boolean) {
  return invoke<RemovalResult>({ action: "remove", batch_year: batchYear, keep_feedback: keepFeedback });
}

export const createdStudents = (results: IntakeResult[]): CreatedStudent[] =>
  results
    .filter((r) => r.ok && r.password)
    .map((r) => ({
      name: r.name,
      reg_number: r.reg_number,
      index_number: r.index_number ?? null,
      email: r.email,
      department: r.department ?? null,
      password: r.password!,
    }));
