// Reading one page of the faculty website: the links it leads to, and its
// main text split into sections a search can return on their own.
//
// Kept apart from the crawl so it can be tested on a saved page without a
// network or a database.
import { parseHTML } from "npm:linkedom@0.18.13";

export const SITE_HOST = "eng.sjp.ac.lk";

/* Files, not pages. A PDF may well be worth reading one day, but it needs a
   different reader; for now it is recorded as skipped rather than fed to an
   HTML parser. */
const FILE_EXTENSION =
  /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|mp4|mp3|avi|mov|css|js|xml|json|txt)$/i;

/* Pages that are machinery rather than content, or that multiply without
   end: feeds; tag, author, category and date listings (each post is read on
   its own page); paged archives; the IT-support ticket forms and the LMS
   selector, which are forms, not information; and the site's own
   placeholder pages. */
const SKIP_PATH = new RegExp(
  [
    "^/(wp-admin|wp-login|wp-json|wp-content|wp-includes|xmlrpc|feed|comments|cdn-cgi|ticket|cm)(/|$)",
    "/(tag|author|category)/",
    "/(feed|trackback|embed|amp)/?$",
    "/page/\\d+/?$",
    "/blog/\\d{4}(/\\d{2}){0,2}/?$",
    "^/(sample-page|test-page|coming-soon-page|lobby-display)/?$",
  ].join("|"),
  "i",
);

/* A page still carrying a theme's filler text rather than the faculty's. */
export function isPlaceholder(text: string): boolean {
  return /lorem ipsum|consectetur adipiscing|dummy text of the printing|himenaeos|ullamcorper/i
    .test(text);
}

/** A link as the crawl keeps it, or null for anything it should not visit. */
export function normaliseUrl(href: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== SITE_HOST) return null;
  // A query string is how calendars, searches and filters make endless
  // variations of one page. The site's own pages have none.
  if (u.search) return null;
  if (FILE_EXTENSION.test(u.pathname)) return null;
  if (SKIP_PATH.test(u.pathname)) return null;
  u.protocol = "https:";
  u.hostname = SITE_HOST;
  u.hash = "";
  u.port = "";
  // One spelling per page, so /about and /about/ are not two pages.
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && !path.endsWith("/")) {
    const last = path.split("/").pop() ?? "";
    if (!last.includes(".")) path += "/";
  }
  u.pathname = path;
  return u.toString();
}

/* Everything around the content rather than the content: navigation,
   headers and footers repeated on every page, sidebars, forms, scripts. */
const NOISE = [
  "script", "style", "noscript", "template", "iframe", "svg", "canvas", "form",
  "nav", "header", "footer", "aside", "button", "select",
  "[role=navigation]", "[role=banner]", "[role=contentinfo]", "[aria-hidden=true]",
  ".menu", ".nav", ".navbar", ".sidebar", ".widget", ".breadcrumb", ".breadcrumbs",
  ".site-header", ".site-footer", ".footer", ".header", ".cookie", ".share",
  ".social", ".sharedaddy", ".comments", "#comments", ".screen-reader-text",
  ".skip-link",
].join(",");

/* Where a page's own content usually lives, most specific first. */
const MAIN = [
  "main", "article", "[role=main]", ".entry-content", ".post-content",
  ".page-content", "#content", "#main", ".site-content", ".content",
];

const BLOCK = new Set([
  "p", "div", "section", "article", "main", "li", "ul", "ol", "table", "tr",
  "td", "th", "tbody", "thead", "dl", "dt", "dd", "blockquote", "pre", "br",
  "hr", "figure", "figcaption", "address",
]);

export interface PageSection {
  section: string | null;
  content: string;
}

export interface ReadPage {
  title: string;
  links: string[];
  sections: PageSection[];
  /** The page's whole text, for a hash that says whether it changed. */
  text: string;
  /** Google Sheets the page embeds, as addresses that give their cells as
      CSV. The academic calendar is one: the page itself has no text. */
  sheets: string[];
}

/* On a single post, the list of other posts under it ("Previous Notices",
   "News & Events") is the site's sidebar, not the post: reading stops there. */
const RELATED_HEADING =
  /^(previous|recent|related|latest|more|other) (notices|posts|news|vacancies|events)$|^news (&|and) events$/i;

/* Lines that say nothing: a listing's "Read more »" and the breadcrumb. */
const FILLER_LINE = /^[ \t]*(read more[ \t]*[»›>]*|homepage[ \t]*>.*)[ \t]*$/gim;

const squash = (s: string) =>
  s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

export function readPage(html: string, url: string): ReadPage {
  const { document } = parseHTML(html);

  // Links first, before anything is removed: the menu is exactly what leads
  // to the rest of the site.
  const links = new Set<string>();
  for (const a of document.querySelectorAll("a[href]")) {
    const n = normaliseUrl(a.getAttribute("href") ?? "", url);
    if (n) links.add(n);
  }

  /* The page's own name, not a slogan: the page title with the site name
     cut off comes first, the first heading only when there is no title. */
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
  const docTitle = (document.querySelector("title")?.textContent ?? "")
    .split(/\s[|–—-]\s/)[0];
  const h1 = document.querySelector("h1")?.textContent;
  const title = (ogTitle || docTitle || h1 || url)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const sheets = new Set<string>();
  for (const f of document.querySelectorAll("iframe[src]")) {
    const csv = sheetCsvUrl(f.getAttribute("src") ?? "");
    if (csv) sheets.add(csv);
  }

  for (const el of document.querySelectorAll(NOISE)) el.remove();

  let root = document.body ?? document.documentElement;
  for (const sel of MAIN) {
    const el = document.querySelector(sel);
    if (el && squash(el.textContent ?? "").length > 200) {
      root = el;
      break;
    }
  }

  /* Walk the content, starting a new section at each heading. A heading
     with only a line under it (a listing's "Read more » 24 September") is
     too little to stand alone, so it is carried into the next section
     instead of dropped: a list of notices reads as one section. */
  const sections: PageSection[] = [];
  let current: string | null = null;
  let buf: string[] = [];
  let carry = "";
  let carryFrom: string | null = null;
  const flush = () => {
    const content = squash(buf.join("").replace(FILLER_LINE, ""));
    buf = [];
    if (content.length >= 40) {
      sections.push({
        section: current,
        content: carry ? squash(`${carry}\n${current ?? ""}\n${content}`) : content,
      });
      carry = "";
      carryFrom = null;
      return;
    }
    const piece = squash(`${current ?? ""}\n${content}`);
    if (!piece) return;
    if (!carry) carryFrom = current;
    carry = squash(`${carry}\n${piece}`);
  };
  const isPost = new URL(url).pathname.startsWith("/blog/");
  let stopped = false;
  // deno-lint-ignore no-explicit-any
  const walk = (node: any) => {
    for (const child of node.childNodes ?? []) {
      if (stopped) return;
      if (child.nodeType === 3) {
        buf.push(child.textContent ?? "");
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = String(child.tagName).toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const heading = squash(child.textContent ?? "").slice(0, 200);
        if (isPost && RELATED_HEADING.test(heading)) {
          stopped = true;
          return;
        }
        flush();
        current = heading || null;
        continue;
      }
      /* A notice is often only a button ("Click here to view notice") to a
         PDF or a Drive folder: keep where it leads, so the assistant can
         hand the student the link and not just the words. */
      if (tag === "a") {
        walk(child);
        const target = fileOrExternal(child.getAttribute("href") ?? "", url);
        if (target) buf.push(` (${target})`);
        continue;
      }
      if (tag === "td" || tag === "th") {
        walk(child);
        buf.push(" | ");
        continue;
      }
      const block = BLOCK.has(tag);
      if (block) buf.push("\n");
      walk(child);
      if (block) buf.push("\n");
    }
  };
  walk(root);
  flush();
  if (carry.length >= 40) sections.push({ section: carryFrom, content: carry });

  /* A theme's filler left in one block (a testimonial, a sample post) goes;
     the faculty's own text around it stays. */
  const kept = sections.filter((s) => !isPlaceholder(`${s.section ?? ""} ${s.content}`));

  const text = kept.map((s) => `${s.section ?? ""}\n${s.content}`).join("\n\n");
  return { title, links: [...links], sections: kept, text, sheets: [...sheets] };
}

/** Where a link leads when that is worth keeping in the text: a file, or a
    page off the faculty's site (a form, a Drive folder). Null for the site's
    own pages, anchors, mail and phone links. */
function fileOrExternal(href: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const own = u.hostname.toLowerCase().replace(/^www\./, "") === SITE_HOST;
  if (own && !FILE_EXTENSION.test(u.pathname)) return null;
  return u.toString().slice(0, 300);
}

/** The CSV export of an embedded Google Sheet, or null for any other frame. */
export function sheetCsvUrl(src: string): string | null {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return null;
  }
  if (u.hostname !== "docs.google.com") return null;
  const id = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (!id || id === "e") return null; // "/d/e/…" is a published copy, a different form
  const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/** A CSV's rows and cells, whitespace collapsed, empty cells kept in place. */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell.replace(/\s+/g, " ").trim());
    cell = "";
  };
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  endCell();
  rows.push(row);
  return rows;
}

const DATE_CELL = /^(\d{1,2}[-/ ]([A-Za-z]{3,9}|\d{1,2})[-/ ]\d{2,4}|\d{4}-\d{2}-\d{2})$/;

/**
 * A sheet as blocks of text a search can return on their own.
 *
 * A calendar sheet is a grid: one row of dates across the top, a row per
 * batch below, a code in each cell ("S7", "V", "E"). Flattened, a cell loses
 * the date it sits under, so each row is written out as runs instead —
 * "Batch 06: S7 (29-Dec-2025 to 26-Jan-2026); V (2-Feb-2026 to 9-Feb-2026)"
 * — and the lines outside the grid (the year, the key to the codes) go with
 * every block, so a block found alone still says what "V" means.
 * A sheet with no row of dates is written a row per line.
 */
export function sheetBlocks(csv: string, size = 1100): string[] {
  const rows = parseCsv(csv);
  const headerAt = rows.findIndex((r) => r.filter((c) => DATE_CELL.test(c)).length >= 5);
  const plain = (r: string[]) => r.filter(Boolean).join(" | ");

  const lines: string[] = [];
  const notes: string[] = [];
  if (headerAt < 0) {
    lines.push(...rows.map(plain).filter(Boolean));
  } else {
    const header = rows[headerAt];
    const dateCols = header.flatMap((c, i) => (DATE_CELL.test(c) ? [i] : []));
    /* A row of the grid fills a good part of it; the key to the codes, even
       when typed under the dates, fills a few cells. */
    const gridRow = Math.max(3, Math.ceil(dateCols.length / 4));
    let label = "";
    rows.forEach((r, n) => {
      if (n === headerAt) return;
      if (n < headerAt || dateCols.filter((i) => r[i]).length < gridRow) {
        const t = plain(r);
        if (t) notes.push(t);
        return;
      }
      // A row with no label of its own continues the batch above it.
      label = plain(r.slice(0, dateCols[0])) || label;
      const runs: string[] = [];
      for (let i = 0; i < dateCols.length;) {
        const v = r[dateCols[i]];
        if (!v) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < dateCols.length && r[dateCols[j + 1]] === v) j++;
        const from = header[dateCols[i]];
        runs.push(i === j ? `${v} (${from})` : `${v} (${from} to ${header[dateCols[j]]})`);
        i = j + 1;
      }
      let line = "";
      for (const run of runs) {
        if (line && line.length + run.length > 400) {
          lines.push(`${label || "Row"}: ${line}`);
          line = "";
        }
        line = line ? `${line}; ${run}` : run;
      }
      if (line) lines.push(`${label || "Row"}: ${line}`);
    });
  }

  const key = notes.join("\n").slice(0, 600);
  const room = Math.max(300, size - key.length);
  const blocks: string[] = [];
  let block = "";
  for (const line of lines) {
    if (block && block.length + line.length + 1 > room) {
      blocks.push(block);
      block = "";
    }
    block = block ? `${block}\n${line}` : line;
  }
  if (block) blocks.push(block);
  if (blocks.length === 0) return key ? [key] : [];
  return key ? blocks.map((b) => `${key}\n${b}`) : blocks;
}

/**
 * Sections cut to a size a search result can carry: about 1,200 characters,
 * broken at a sentence or line where one is near, with a short overlap so a
 * fact is not split from its context at the seam.
 */
export function chunkSections(
  sections: PageSection[],
  size = 1200,
  overlap = 150,
): PageSection[] {
  const out: PageSection[] = [];
  /* A short section joins the one before it, heading and all, while the two
     fit: a page of many small headings (a list of centres, of policies)
     makes a few useful chunks rather than many scraps. */
  const add = (piece: PageSection) => {
    const prev = out[out.length - 1];
    const joined = prev && `${prev.content}\n\n${piece.section ?? ""}\n${piece.content}`.trim();
    if (prev && (prev.content.length < 400 || piece.content.length < 400) && joined.length <= size) {
      prev.content = joined;
    } else {
      out.push({ ...piece });
    }
  };
  for (const s of sections) {
    let text = s.content;
    while (text.length > size) {
      const window = text.slice(0, size);
      const cut = Math.max(
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
      );
      const end = cut > size * 0.5 ? cut + 1 : size;
      out.push({ section: s.section, content: text.slice(0, end).trim() });
      text = text.slice(Math.max(0, end - overlap)).trim();
    }
    if (text.length >= 40) add({ section: s.section, content: text });
  }
  return out;
}

/** The Disallow rules robots.txt sets for every crawler. */
export function parseRobots(txt: string): string[] {
  const rules: string[] = [];
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    else if (key === "disallow" && applies && value) rules.push(value);
  }
  return rules;
}

export function allowedByRobots(url: string, disallow: string[]): boolean {
  const path = new URL(url).pathname;
  return !disallow.some((rule) => path.startsWith(rule.replace(/\*.*$/, "")));
}

/** Page addresses listed in a sitemap, and the sitemaps it points to. */
export function readSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&")
  );
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}
