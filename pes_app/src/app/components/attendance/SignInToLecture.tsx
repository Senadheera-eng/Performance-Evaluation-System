import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, CheckCircle2, Keyboard, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CourseCode, ErrorState, SectionCard, StatusBadge } from "../common";
import { departmentByCourseCode } from "../../../lib/departments";
import { supabase } from "../../../lib/supabase";
import { getDeviceId } from "../../../lib/deviceId";

interface OpenSession {
  session_id: string;
  course_code: string;
  course_title: string;
  closes_at: string;
  already_checked_in: boolean;
}

interface PendingCheck {
  pending: boolean;
  check_id?: string;
  course_code?: string;
  seconds_left?: number;
}

/**
 * Where this browser thinks it is, or nothing.
 *
 * Never blocks and never fails the caller: a denied permission, a phone
 * indoors with no fix, a browser without the API — all of them return null and
 * the check-in goes ahead. Location only ever adds a note for the lecturer.
 */
async function currentPosition(): Promise<GeolocationCoordinates | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

/**
 * Signing the lecture register from the student's own phone.
 *
 * Renders nothing at all unless a register is open on a course this student is
 * enrolled in, so it costs an empty page nothing.
 *
 * Two ways in, because a camera is not a given: read the code off the screen,
 * or type the six digits beside it. Both land on the same check, so neither is
 * the weaker door.
 */
export function SignInToLecture({ onCheckedIn }: { onCheckedIn?: () => void }) {
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [active, setActive] = useState<OpenSession | null>(null);
  const [mode, setMode] = useState<"idle" | "camera" | "code">("idle");
  const [pending, setPending] = useState<PendingCheck | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc(
      "my_open_attendance_sessions",
    );
    if (rpcError) {
      // A register nobody can see is better than an error on the page.
      console.error("[attendance sessions]", rpcError);
      return;
    }
    setSessions((data ?? []) as OpenSession[]);
  }, []);

  useEffect(() => {
    load();
    // Registers open and close during a lecture, so this cannot be read once.
    const id = window.setInterval(load, 20000);
    return () => window.clearInterval(id);
  }, [load]);

  /* A presence check is a question with a deadline, so it has to be looked for
     often enough that ninety seconds is not mostly spent waiting to hear it. */
  useEffect(() => {
    const poll = async () => {
      const { data } = await supabase.rpc("my_pending_presence_check");
      setPending((data as PendingCheck) ?? null);
    };
    poll();
    const id = window.setInterval(poll, 8000);
    return () => window.clearInterval(id);
  }, []);

  /* Counts down locally between polls, so the number moves every second
     rather than in eight-second jumps. */
  useEffect(() => {
    if (!pending?.pending) return;
    const id = window.setInterval(
      () =>
        setPending((p) =>
          p?.pending && (p.seconds_left ?? 0) > 0
            ? { ...p, seconds_left: (p.seconds_left ?? 0) - 1 }
            : p,
        ),
      1000,
    );
    return () => window.clearInterval(id);
  }, [pending?.pending, pending?.check_id]);

  const confirmPresence = async () => {
    if (!pending?.check_id) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("confirm_presence", {
      p_check_id: pending.check_id,
      p_device_hash: getDeviceId() || null,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    const result = data as { ok: boolean; message: string };
    if (!result.ok) return setError(result.message);
    setPending({ pending: false });
    setDone(result.message);
  };

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const submit = async (token: string | null, typed: string | null) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);

    const device = getDeviceId();
    const here = await currentPosition();
    const place = {
      p_lat: here?.latitude ?? null,
      p_lng: here?.longitude ?? null,
    };

    const { data, error: rpcError } = token
      ? await supabase.rpc("check_in_to_lecture", {
          p_token: token,
          p_device_hash: device || null,
          ...place,
        })
      : await supabase.rpc("check_in_with_code", {
          p_code: typed,
          p_device_hash: device || null,
          ...place,
        });

    setBusy(false);
    submitting.current = false;

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const result = data as { ok: boolean; message: string };
    if (!result.ok) {
      // Wrong or stale code: stay on camera so the next frame can succeed.
      setError(result.message);
      return;
    }

    stopCamera();
    setMode("idle");
    setActive(null);
    setCode("");
    setDone(result.message);
    await load();
    onCheckedIn?.();
  };

  const startCamera = async (session: OpenSession) => {
    setActive(session);
    setError(null);
    setDone(null);
    setMode("camera");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const scan = () => {
        if (!streamRef.current || !ctx || video.readyState !== 4) {
          rafRef.current = requestAnimationFrame(scan);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height);
        if (found?.data) {
          submit(found.data, null);
        }
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    } catch {
      setMode("code");
      setError(
        "The camera could not be opened. Type the six digits shown beside the code instead.",
      );
    }
  };

  const cancel = () => {
    stopCamera();
    setMode("idle");
    setActive(null);
    setError(null);
  };

  if (sessions.length === 0 && !done && !pending?.pending) return null;

  /* A presence check outranks everything else on this card: it has a deadline
     and the rest does not. */
  if (pending?.pending) {
    return (
      <SectionCard
        title="Are you still in the lecture?"
        description={
          <>
            Your lecturer is checking the room
            {pending.course_code && (
              <>
                {" "}for <CourseCode code={pending.course_code} />
              </>
            )}
            . Confirm from the phone you signed in with.
          </>
        }
      >
        {error && <ErrorState message={error} size="inline" />}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={confirmPresence} disabled={busy}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {busy ? "Confirming…" : "Yes, I'm here"}
          </Button>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {pending.seconds_left ?? 0}s left
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          If this runs out, your lecturer sees that you did not answer. Tell
          them if your phone was the problem — it does not mark you absent on
          its own.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Sign in to a lecture"
      description="Your lecturer has a register open. Read the code on the screen, or type the six digits beside it."
    >
      {done && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {done}
        </div>
      )}
      {error && <ErrorState message={error} size="inline" />}

      {mode === "idle" && (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.session_id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 ${
                departmentByCourseCode(s.course_code)?.rowClass ?? ""
              }`}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <CourseCode code={s.course_code} className="text-sm" />
                  <span className="truncate text-sm text-foreground">
                    {s.course_title}
                  </span>
                  {s.already_checked_in && (
                    <StatusBadge tone="success" icon={CheckCircle2}>
                      Signed in
                    </StatusBadge>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  closes at{" "}
                  {new Date(s.closes_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>

              {!s.already_checked_in && (
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => startCamera(s)}>
                    <Camera className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Scan
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setActive(s);
                      setMode("code");
                      setError(null);
                      setDone(null);
                    }}
                  >
                    <Keyboard className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Type code
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {mode === "camera" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Point your camera at the code for <CourseCode code={active?.course_code} />.
          </p>
          <video
            ref={videoRef}
            className="mx-auto w-full max-w-sm rounded-xl border border-border bg-black"
            muted
            playsInline
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={cancel}>
              <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                stopCamera();
                setMode("code");
                setError(null);
              }}
            >
              <Keyboard className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Type the code instead
            </Button>
          </div>
        </div>
      )}

      {mode === "code" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground">
            Six digits from the screen
            {active && (
              <>
                {" — "}
                <CourseCode code={active.course_code} />
              </>
            )}
          </label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="000000"
            className="max-w-[12rem] font-mono text-xl tracking-[0.3em]"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={code.length !== 6 || busy}
              onClick={() => submit(null, code)}
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
