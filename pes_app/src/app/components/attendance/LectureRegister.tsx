import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, Clock, PlayCircle, Plus, Square, Users } from "lucide-react";
import { Button } from "../ui/button";
import { ErrorState, SectionCard, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";

interface RosterRow {
  student_id: string;
  name: string;
  index_number: string | null;
  checked_in_at: string | null;
}

interface SessionState {
  session_id: string;
  status: "open" | "closed";
  closes_at: string;
  lecture_date: string;
  students: RosterRow[];
}

interface TokenPayload {
  open: boolean;
  token?: string;
  code?: string;
  rotate_seconds?: number;
  expires_in?: number;
  closes_at: string;
}

/**
 * The register a lecture signs itself.
 *
 * The code on the screen is an HMAC over a ten-second window, so it is stale
 * before a photograph of it is worth sending. The lecturer's screen therefore
 * has to keep asking for a new one, which is all the polling below is: a fresh
 * code on its own clock, and the roster on a slower one.
 *
 * Nothing reaches the attendance table until Close. Until then a check-in is
 * evidence, not a fact, so a lecture interrupted halfway leaves no half-marked
 * register behind.
 */
export function LectureRegister({
  offeringId,
  courseLabel,
  onClosed,
}: {
  offeringId: string;
  courseLabel: string;
  onClosed?: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [token, setToken] = useState<TokenPayload | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);

  const tokenTimer = useRef<number | null>(null);
  const stateTimer = useRef<number | null>(null);

  const stopTimers = () => {
    if (tokenTimer.current) window.clearInterval(tokenTimer.current);
    if (stateTimer.current) window.clearInterval(stateTimer.current);
    tokenTimer.current = null;
    stateTimer.current = null;
  };

  const refreshToken = useCallback(async (id: string) => {
    const { data, error: rpcError } = await supabase.rpc(
      "attendance_session_token",
      { p_session_id: id },
    );
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const payload = data as TokenPayload;
    setToken(payload);
    if (payload.open && payload.token) {
      setQrUrl(
        await QRCode.toDataURL(payload.token, { width: 360, margin: 1 }),
      );
    }
  }, []);

  const refreshState = useCallback(async (id: string) => {
    const { data, error: rpcError } = await supabase.rpc(
      "attendance_session_state",
      { p_session_id: id },
    );
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setState(data as SessionState);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    refreshToken(sessionId);
    refreshState(sessionId);
    // The code turns over every ten seconds; the roster does not need to.
    tokenTimer.current = window.setInterval(() => refreshToken(sessionId), 5000);
    stateTimer.current = window.setInterval(() => refreshState(sessionId), 4000);
    return stopTimers;
  }, [sessionId, refreshToken, refreshState]);

  /* Counts down to when the window shuts, so the lecturer can see whether to
     extend before students start finding it closed. */
  useEffect(() => {
    if (!token?.closes_at) return;
    const tick = () =>
      setRemaining(
        Math.max(
          0,
          Math.round((new Date(token.closes_at).getTime() - Date.now()) / 1000),
        ),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [token?.closes_at]);

  // Offering changed under us — an open register belongs to one course.
  useEffect(() => {
    stopTimers();
    setSessionId(null);
    setToken(null);
    setQrUrl(null);
    setState(null);
  }, [offeringId]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc(
      "start_attendance_session",
      { p_offering_id: offeringId, p_minutes: 5 },
    );
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSessionId(data as string);
  };

  const extend = async () => {
    if (!sessionId) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("extend_attendance_session", {
      p_session_id: sessionId,
      p_minutes: 2,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    refreshToken(sessionId);
  };

  const close = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "close_attendance_session",
      { p_session_id: sessionId },
    );
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    stopTimers();
    const written = (data as { rows_written: number })?.rows_written ?? 0;
    setNotice(
      `Register closed. ${written} student${written === 1 ? "" : "s"} recorded — anyone who could not sign in can still be marked by hand below.`,
    );
    setSessionId(null);
    setToken(null);
    setQrUrl(null);
    setState(null);
    onClosed?.();
  };

  const present = state?.students.filter((s) => s.checked_in_at).length ?? 0;
  const total = state?.students.length ?? 0;

  if (!sessionId) {
    return (
      <SectionCard
        title="Sign-in register"
        description="Put a rotating code on the screen and let students sign themselves in. Marking by hand still works either way."
      >
        {error && <ErrorState message={error} size="inline" />}
        {notice && (
          <div className="mb-3 rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
            {notice}
          </div>
        )}
        <Button onClick={start} disabled={busy || !offeringId}>
          <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {busy ? "Opening…" : "Open register for 5 minutes"}
        </Button>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={`Sign-in register — ${courseLabel}`}
      description="Show this on the projector. The code changes every few seconds, so a photograph of it is worthless within one."
    >
      {error && <ErrorState message={error} size="inline" />}

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex flex-col items-center gap-3">
          {qrUrl ? (
            <img
              src={qrUrl}
              alt="Attendance code. The six digits below it do the same thing."
              className="w-[260px] rounded-xl border border-border bg-white p-2"
            />
          ) : (
            <div className="h-[260px] w-[260px] animate-pulse rounded-xl bg-muted" />
          )}

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              Or type this code
            </p>
            <p className="font-mono text-3xl font-bold tracking-[0.25em] text-foreground">
              {token?.code ?? "······"}
            </p>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {remaining > 0 ? (
              <span>
                Closes in {Math.floor(remaining / 60)}:
                {String(remaining % 60).padStart(2, "0")}
              </span>
            ) : (
              <span>Window closed — extend or close the register.</span>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={extend} disabled={busy}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />2 minutes
            </Button>
            <Button size="sm" onClick={close} disabled={busy}>
              <Square className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Close and record
            </Button>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-3">
            <StatusBadge tone="success" icon={CheckCircle2}>
              {present} signed in
            </StatusBadge>
            <StatusBadge tone="neutral" icon={Users}>
              {total} enrolled
            </StatusBadge>
          </div>

          <ul className="max-h-[320px] divide-y divide-border/70 overflow-y-auto rounded-xl border border-border">
            {state?.students.map((s) => (
              <li
                key={s.student_id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">
                    {s.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {s.index_number ?? "—"}
                  </span>
                </span>
                {s.checked_in_at ? (
                  <span className="whitespace-nowrap text-xs text-success-fg">
                    {new Date(s.checked_in_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                ) : (
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    not yet
                  </span>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-muted-foreground">
            Nothing is written until you close the register. A student whose
            phone failed can be marked by hand afterwards.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
