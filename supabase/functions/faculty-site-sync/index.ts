// Reads the faculty's website (eng.sjp.ac.lk) into the database, so the AI
// assistant can answer from it as it answers from the handbook.
//
// A round, not a whole crawl: each call reads as many pages as fit in its
// time budget, starting with pages never read and then the stalest, and
// remembers everything it found in faculty_site_pages. Calling it again
// carries on where the last call stopped. A page whose text has not changed
// keeps its sections as they are; one that has changed has them replaced.
//
// Polite by construction: it follows robots.txt, stays on the faculty's own
// host, reads a few pages at a time, and says who it is.
//
// Who may run it: the Super Admin (the dashboard's Refresh button), the
// service role, or the daily schedule, which presents a key kept in the
// vault.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  allowedByRobots,
  chunkSections,
  isPlaceholder,
  normaliseUrl,
  parseRobots,
  readPage,
  readSitemap,
  sheetBlocks,
  SITE_HOST,
} from "./extract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ROOT = `https://${SITE_HOST}/`;
const USER_AGENT =
  "PES-Faculty-Assistant/1.0 (Faculty of Engineering, USJ; reads the faculty website for the student portal's assistant)";

/* Stop starting pages well before the platform's own limit, so a round
   always finishes and reports rather than being killed mid-write. */
const BUDGET_MS = 95_000;
const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 15_000;
/* A ceiling on what one site can grow to, against a link pattern that
   generates pages without end. */
const MAX_PAGES_KNOWN = 2500;
/* A page read within this long is not read again this round. Just under a
   day, so the daily schedule looks at every page again (an unchanged page
   costs one request and a hash) and a new notice is found the day after it
   is posted. */
const FRESH_FOR_MS = 20 * 60 * 60 * 1000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function jwtRole(authHeader: string): string | null {
  try {
    const payload = authHeader.replace(/^Bearer\s+/i, "").split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).role ?? null;
  } catch {
    return null;
  }
}

/* A sheet the page embeds, as blocks of text: the academic calendar lives
   in one. None when the sheet is not public (Google answers with a sign-in
   page instead of CSV). */
async function readSheet(url: string): Promise<string[]> {
  try {
    const res = await fetchText(url);
    if (res.status >= 400 || !/csv/i.test(res.type)) return [];
    return sheetBlocks(res.body.slice(0, 200_000)).slice(0, 60);
  } catch {
    return [];
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchText(url: string): Promise<{ status: number; type: string; body: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,*/*;q=0.5" },
      redirect: "follow",
      signal: ctl.signal,
    });
    const type = res.headers.get("content-type") ?? "";
    // Only HTML is worth downloading in full.
    const body = /html|xml|text\/plain|text\/csv/i.test(type) ? await res.text() : "";
    return { status: res.status, type, body };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---- Who is asking -------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const syncKey = req.headers.get("x-sync-key");
  let allowed = jwtRole(authHeader) === "service_role";
  if (!allowed && syncKey) {
    const { data } = await admin.rpc("faculty_site_sync_key_ok", { p_key: syncKey });
    allowed = data === true;
  }
  if (!allowed && authHeader) {
    const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: who } = await user.auth.getUser();
    if (who?.user) {
      const { data: row } = await admin
        .from("admins")
        .select("role")
        .eq("id", who.user.id)
        .maybeSingle();
      allowed = row?.role === "super_admin";
    }
  }
  if (!allowed) return json({ error: "Only the Super Admin can refresh the website." }, 403);

  /* Inspect one page without saving anything: its raw HTML, less scripts
     and styles, and what the reader makes of it. For tuning the reader
     against the site's real markup. */
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));
  if (typeof body?.inspect === "string") {
    const target = normaliseUrl(body.inspect, ROOT);
    if (!target) return json({ error: "Not a faculty-site page address." }, 400);
    const res = await fetchText(target);
    const read = readPage(res.body, target);
    const cleaned = res.body
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/\s{2,}/g, " ");
    return json({
      status: res.status,
      type: res.type,
      html_length: res.body.length,
      title: read.title,
      sections: chunkSections(read.sections),
      sheets: await Promise.all(
        read.sheets.map(async (url) => ({ url, blocks: await readSheet(url) })),
      ),
      html: cleaned.slice(0, Number(body.max_html ?? 60000)),
    });
  }

  const startedAt = Date.now();
  const summary = {
    read: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    discovered: 0,
    pending_left: 0,
    notes: [] as string[],
  };

  // ---- robots.txt ----------------------------------------------------
  let disallow: string[] = [];
  try {
    const robots = await fetchText(`${ROOT}robots.txt`);
    if (robots.status === 200) disallow = parseRobots(robots.body);
  } catch (e) {
    summary.notes.push(`robots.txt unreadable: ${e instanceof Error ? e.message : e}`);
  }

  async function discover(urls: string[]) {
    const fresh = [...new Set(urls)].filter((u) => allowedByRobots(u, disallow));
    if (fresh.length === 0) return;
    const { count } = await admin
      .from("faculty_site_pages")
      .select("*", { count: "exact", head: true });
    const room = MAX_PAGES_KNOWN - (count ?? 0);
    if (room <= 0) return;
    const rows = fresh.slice(0, room).map((url) => ({ url }));
    const { data } = await admin
      .from("faculty_site_pages")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
      .select("url");
    summary.discovered += data?.length ?? 0;
  }

  // ---- Tidy: drop pages the rules now exclude -------------------------
  /* When the rules of what to read change, pages read under the old rules
     go, with their sections, rather than lingering in search results. */
  {
    const { data: all } = await admin.from("faculty_site_pages").select("url");
    const gone = (all ?? [])
      .map((r) => r.url as string)
      .filter((u) => normaliseUrl(u, ROOT) !== u || !allowedByRobots(u, disallow));
    for (let i = 0; i < gone.length; i += 100) {
      await admin.from("faculty_site_pages").delete().in("url", gone.slice(i, i + 100));
    }
    if (gone.length) summary.notes.push(`dropped ${gone.length} pages the rules now exclude`);
  }

  // ---- Seeds: the home page and the sitemaps, first time only --------
  const { count: known } = await admin
    .from("faculty_site_pages")
    .select("*", { count: "exact", head: true });
  if (!known) {
    const seeds = [ROOT];
    const sitemapQueue = [`${ROOT}sitemap.xml`, `${ROOT}sitemap_index.xml`, `${ROOT}wp-sitemap.xml`];
    const seen = new Set<string>();
    while (sitemapQueue.length && seen.size < 40) {
      const sm = sitemapQueue.shift()!;
      if (seen.has(sm)) continue;
      seen.add(sm);
      try {
        const res = await fetchText(sm);
        if (res.status !== 200 || !/<(urlset|sitemapindex)/i.test(res.body)) continue;
        const { pages, sitemaps } = readSitemap(res.body);
        for (const p of pages) {
          const n = normaliseUrl(p, ROOT);
          if (n) seeds.push(n);
        }
        sitemapQueue.push(...sitemaps.filter((s) => s.includes(SITE_HOST)));
      } catch {
        // No sitemap at that address; the links will find the pages.
      }
    }
    await discover(seeds);
    summary.notes.push(`seeded ${seeds.length} addresses (${seen.size} sitemap addresses tried)`);
  }

  // ---- The round -----------------------------------------------------
  async function nextBatch(n: number): Promise<{ url: string; content_hash: string | null }[]> {
    const { data: pending } = await admin
      .from("faculty_site_pages")
      .select("url, content_hash")
      .eq("status", "pending")
      .order("discovered_at")
      .limit(n);
    if (pending && pending.length) return pending;
    const staleBefore = new Date(Date.now() - FRESH_FOR_MS).toISOString();
    const { data: stale } = await admin
      .from("faculty_site_pages")
      .select("url, content_hash")
      // Skipped pages too: an empty page may have been filled since.
      .in("status", ["ok", "error", "skipped"])
      .lt("fetched_at", staleBefore)
      .order("fetched_at")
      .limit(n);
    return stale ?? [];
  }

  async function readOne(page: { url: string; content_hash: string | null }) {
    const now = new Date().toISOString();
    try {
      const res = await fetchText(page.url);
      if (res.status >= 400) {
        summary.failed++;
        await admin.from("faculty_site_pages").update({
          status: "error", http_status: res.status, error: `HTTP ${res.status}`, fetched_at: now,
        }).eq("url", page.url);
        return;
      }
      if (!/html/i.test(res.type)) {
        summary.skipped++;
        await admin.from("faculty_site_pages").update({
          status: "skipped", http_status: res.status, error: res.type || "not HTML", fetched_at: now,
        }).eq("url", page.url);
        return;
      }

      const read = readPage(res.body, page.url);
      await discover(read.links);
      summary.read++;

      /* A sample page the theme left behind, named in filler text: keep it
         known (its links still lead somewhere) but give search nothing from
         it. Filler inside a real page is dropped by readPage. */
      if (isPlaceholder(read.title) || (read.sections.length === 0 && read.sheets.length === 0 &&
        isPlaceholder(res.body))) {
        summary.skipped++;
        await admin.from("faculty_site_chunks").delete().eq("url", page.url);
        await admin.from("faculty_site_pages").update({
          status: "skipped", title: read.title, http_status: res.status,
          content_hash: null, error: "placeholder text", fetched_at: now,
        }).eq("url", page.url);
        return;
      }

      for (const sheet of read.sheets.slice(0, 3)) {
        for (const block of await readSheet(sheet)) {
          read.sections.push({ section: read.title, content: block });
          read.text += `\n\n${block}`;
        }
      }

      const hash = await sha256(read.title + "\n" + read.text);

      if (hash === page.content_hash) {
        summary.unchanged++;
        await admin.from("faculty_site_pages").update({
          status: "ok", http_status: res.status, error: null, fetched_at: now,
        }).eq("url", page.url);
        return;
      }

      const chunks = chunkSections(read.sections);
      await admin.from("faculty_site_chunks").delete().eq("url", page.url);
      if (chunks.length) {
        const { error } = await admin.from("faculty_site_chunks").insert(
          chunks.map((c, i) => ({
            url: page.url,
            title: read.title,
            section: c.section,
            chunk_index: i,
            content: c.content,
          })),
        );
        if (error) throw new Error(`saving sections: ${error.message}`);
      }
      summary.changed++;
      await admin.from("faculty_site_pages").update({
        status: chunks.length ? "ok" : "skipped",
        title: read.title,
        http_status: res.status,
        content_hash: hash,
        error: chunks.length ? null : "no readable text",
        fetched_at: now,
        changed_at: now,
      }).eq("url", page.url);
    } catch (e) {
      summary.failed++;
      await admin.from("faculty_site_pages").update({
        status: "error",
        error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        fetched_at: now,
      }).eq("url", page.url);
    }
  }

  while (Date.now() - startedAt < BUDGET_MS) {
    const batch = await nextBatch(CONCURRENCY * 4);
    if (batch.length === 0) break;
    for (let i = 0; i < batch.length && Date.now() - startedAt < BUDGET_MS; i += CONCURRENCY) {
      await Promise.all(batch.slice(i, i + CONCURRENCY).map(readOne));
    }
  }

  const { count: pendingLeft } = await admin
    .from("faculty_site_pages")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  summary.pending_left = pendingLeft ?? 0;
  return json({ ok: true, seconds: Math.round((Date.now() - startedAt) / 1000), ...summary });
});
