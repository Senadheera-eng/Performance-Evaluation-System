import { useEffect, useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { SectionCard, SkeletonRows, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";
import { relativeTime } from "../../../lib/notifications";

interface SiteStatus {
  pages_known: number;
  pages_read: number;
  pages_pending: number;
  pages_failed: number;
  sections: number;
  last_read_at: string | null;
}

interface RoundSummary {
  read: number;
  changed: number;
  unchanged: number;
  failed: number;
  discovered: number;
  pending_left: number;
}

const SITE = "https://eng.sjp.ac.lk/";

/**
 * What the AI assistant knows from the faculty's website, for the Super
 * Admin's dashboard: how much of eng.sjp.ac.lk it has read and when.
 *
 * The site is read again every night on its own. "Read now" is for the day
 * a notice goes up that students will ask about before morning.
 */
export function FacultyWebsiteCard() {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const load = async () => {
    const { data, error: rpcError } = await supabase.rpc("get_faculty_site_status");
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setError(null);
    setStatus((Array.isArray(data) ? data[0] : data) as SiteStatus);
  };

  useEffect(() => {
    load();
  }, []);

  const readNow = async () => {
    setReading(true);
    const { data, error: fnError } = await supabase.functions.invoke<RoundSummary>(
      "faculty-site-sync",
      { body: {} },
    );
    setReading(false);
    if (fnError || !data) {
      toast.error("The website could not be read just now. Try again in a few minutes.");
      return;
    }
    const parts = [
      `${data.changed} updated`,
      `${data.unchanged} unchanged`,
      data.discovered ? `${data.discovered} new found` : null,
      data.failed ? `${data.failed} failed` : null,
    ].filter(Boolean);
    toast.success(
      data.read === 0
        ? "Everything was already up to date."
        : `Read ${data.read} page${data.read === 1 ? "" : "s"}: ${parts.join(", ")}.`,
    );
    if (data.pending_left > 0) {
      toast.info(`${data.pending_left} pages are left for the next round.`);
    }
    await load();
  };

  return (
    <SectionCard
      title="Faculty website"
      description="What the AI assistant knows from eng.sjp.ac.lk: notices, news, the academic calendar and the faculty's pages. Read again every night."
      actions={
        <Button size="sm" variant="outline" onClick={readNow} disabled={reading}>
          {reading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          {reading ? "Reading…" : "Read now"}
        </Button>
      }
    >
      {error ? (
        <p className="text-sm text-danger-fg">{error}</p>
      ) : !status ? (
        <SkeletonRows count={1} height="h-12" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Globe className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {status.pages_read} page{status.pages_read === 1 ? "" : "s"} read
                <span className="font-normal text-muted-foreground">
                  {" "}· {status.sections} passages the assistant can quote
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {status.last_read_at
                  ? `Last read ${relativeTime(status.last_read_at)}`
                  : "Not read yet"}
                {reading && " · reading takes up to two minutes"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status.pages_pending > 0 && (
              <StatusBadge tone="info">{status.pages_pending} waiting</StatusBadge>
            )}
            {status.pages_failed > 0 && (
              <StatusBadge tone="warning">{status.pages_failed} unreadable</StatusBadge>
            )}
            <a
              href={SITE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open the site
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
