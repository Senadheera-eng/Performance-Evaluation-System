/**
 * The lecturer's feedback report, drawn to match the faculty's own printed
 * report page for page.
 *
 * Every colour, size and rule here was read out of the reference document
 * rather than guessed: the navy the values are set in, the green and blue that
 * split the averages at 4.5, the five-colour palette the distribution bars
 * cycle through by option order, the amber rule beside each quoted comment,
 * the grey serif the section titles are set in. Where the reference and this
 * file disagree, the reference is right.
 *
 * Two things needed working around. jsPDF has three built-in faces, so the
 * serif headings are set in Times rather than the reference's display serif —
 * the closest match available without shipping a font file. And jsPDF cannot
 * draw colour emoji at all; the section icons are instead painted to an
 * offscreen canvas using the reader's own emoji font and embedded as small
 * images, which puts the real glyphs on the page. If a glyph is unavailable
 * the canvas comes back blank and the icon is simply left out, rather than
 * printing a hollow box.
 */
import jsPDF from "jspdf";
import type {
  CourseFeedbackReport,
  ReportChoice,
  ReportRating,
  ReportSection,
  ReportTally,
  ReportText,
} from "./staffService";

/* ------------------------------------------------------------------ */
/* The reference document's palette                                    */
/* ------------------------------------------------------------------ */

const NAVY = "#0f2d55";
const BLUE = "#1a4a8a";
const GREEN = "#2d6a4f";
const AMBER_TEXT = "#755618";
const AMBER_FILL = "#c9952a";
const PURPLE_TEXT = "#391d4a";
const PURPLE_FILL = "#7b3f9e";
const RED = "#c0392b";
const OLIVE = "#9c8753";
const TITLE_GREY = "#ababab";
const BODY = "#333333";
const MUTED = "#555555";
const LABEL = "#343434";
const ZERO_GREY = "#787878";
const FOOTER_GREY = "#565656";
const CARD_BORDER = "#e0dcd6";
const ROW_RULE = "#eeeeee";
const TRACK = "#e0dcd6";

/** Bars cycle by the order the question lists its options, not by size. */
const BAR_FILL = [NAVY, BLUE, AMBER_FILL, GREEN, PURPLE_FILL];
const BAR_TEXT = [NAVY, BLUE, AMBER_TEXT, GREEN, PURPLE_TEXT];

/** Ranked colours for the skills cloud, as the reference sets them. */
const CLOUD = [NAVY, NAVY, NAVY, GREEN, RED, NAVY];

/* Page geometry, in points, from the reference. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 54;
const CONTENT_W = 487.5;
const PAD = 16;
const TABLE_INSET = 9;
const FOOTER_SPACE = 62;

/* ------------------------------------------------------------------ */
/* Emoji, by way of the browser's own font                             */
/* ------------------------------------------------------------------ */

const emojiCache = new Map<string, string | null>();

/**
 * Paint one emoji to a canvas and hand back a PNG data URL, or null when the
 * glyph did not render. Cached: the same handful of icons repeat on every
 * report, and rasterising is the slow part of building one.
 */
function emojiImage(ch: string, px = 72): string | null {
  if (emojiCache.has(ch)) return emojiCache.get(ch) ?? null;
  let result: string | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const g = canvas.getContext("2d");
    if (g) {
      g.clearRect(0, 0, px, px);
      g.font = `${Math.round(px * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(ch, px / 2, px / 2 + px * 0.04);
      // A glyph the platform does not have leaves the canvas untouched, and
      // an empty image is worse than none.
      const { data } = g.getImageData(0, 0, px, px);
      let painted = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) {
          painted = true;
          break;
        }
      }
      if (painted) result = canvas.toDataURL("image/png");
    }
  } catch {
    result = null;
  }
  emojiCache.set(ch, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* What the printed report puts on each card                           */
/* ------------------------------------------------------------------ */

interface TextBlock {
  label?: string;
  answers: string[];
}

interface Card {
  icon: string;
  title: string;
  ratings?: ReportRating[];
  ratingHeader?: string;
  numbered?: boolean;
  overallAverage?: number | null;
  adopted?: { label: string; value: string };
  distributions?: { label: string; choice: ReportChoice }[];
  cloud?: { label: string; tallies: ReportTally[] };
  textBlocks?: TextBlock[];
}

const textsOf = (s: ReportSection): ReportText[] => s.texts ?? [];

/**
 * The reference splits some sections across several cards — the lecturer's
 * ratings, what students liked and what they would change each get their own
 * heading and icon, though the student answered them in one block. This maps
 * the generic sections the database returns onto the cards the report prints.
 */
function buildCards(report: CourseFeedbackReport): Card[] {
  const by = new Map(report.sections.map((s) => [s.section_key, s]));
  const cards: Card[] = [];

  const lecturers = by.get("lecturers");
  if (lecturers) {
    cards.push({
      icon: "👨‍🏫",
      title: "Lecturer Performance Ratings",
      ratings: lecturers.ratings,
      ratingHeader: "ATTRIBUTE",
      numbered: true,
      overallAverage: lecturers.average,
    });
    const t = textsOf(lecturers);
    if (t[0]?.answers.length)
      cards.push({
        icon: "💬",
        title: "What Students Liked Most about the Lecturer",
        textBlocks: [{ answers: t[0].answers }],
      });
    if (t[1]?.answers.length)
      cards.push({
        icon: "💡",
        title: "Suggestions to Improve Delivery",
        textBlocks: [{ answers: t[1].answers }],
      });
  }

  const content = by.get("course_content");
  if (content) {
    cards.push({
      icon: "📚",
      title: "Course Content Ratings",
      ratings: content.ratings,
      ratingHeader: "STATEMENT",
    });
    const t = textsOf(content);
    if (t.length > 0)
      cards.push({
        icon: "📋",
        title: "Course Content Suggestions",
        textBlocks: [
          { label: "TOPICS TO ADD", answers: t[0]?.answers ?? [] },
          { label: "TOPICS TO REMOVE", answers: t[1]?.answers ?? [] },
        ].filter((b) => b.answers.length > 0),
      });
  }

  const resources = by.get("learning_resources");
  if (resources)
    cards.push({
      icon: "🗂️",
      title: "Learning Resources",
      ratings: resources.ratings,
      ratingHeader: "RESOURCE",
    });

  const delivery = by.get("delivery_mode");
  if (delivery && delivery.choices.length > 0)
    cards.push({
      icon: "🖥️",
      title: "Delivery Mode",
      adopted: {
        label: "MODE ADOPTED",
        value: delivery.choices[0].tallies[0]?.label ?? "—",
      },
      distributions: [
        delivery.choices[1] && {
          label: "STUDENTS' PREFERRED MODE",
          choice: delivery.choices[1],
        },
        delivery.choices[2] && {
          label: "OVERALL RATING OF DELIVERY",
          choice: delivery.choices[2],
        },
      ].filter(Boolean) as { label: string; choice: ReportChoice }[],
    });

  const approach = by.get("teaching_approach");
  if (approach && approach.choices.length > 0)
    cards.push({
      icon: "🎯",
      title: "Teaching Approach",
      adopted: {
        label: "APPROACH ADOPTED",
        value: approach.choices[0].tallies[0]?.label ?? "—",
      },
      distributions: [
        approach.choices[1] && {
          label: "STUDENTS' PREFERRED APPROACH",
          choice: approach.choices[1],
        },
      ].filter(Boolean) as { label: string; choice: ReportChoice }[],
    });

  const lab = by.get("practical_work");
  if (lab) {
    const skills = lab.choices.find((c) => c.question_type === "multi_select");
    cards.push({
      icon: "🔬",
      title: "Practical Work / Lab",
      ratings: lab.ratings,
      ratingHeader: "STATEMENT",
      cloud: skills
        ? { label: "SKILLS DEVELOPED", tallies: skills.tallies }
        : undefined,
      textBlocks: textsOf(lab)
        .filter((t) => t.answers.length > 0)
        .map((t) => ({ label: "ADDITIONAL COMMENTS", answers: t.answers })),
    });
  }

  const visits = by.get("field_visits");
  if (visits)
    cards.push({
      icon: "🏭",
      title: "Field Visits",
      textBlocks: textsOf(visits)
        .filter((t) => t.answers.length > 0)
        .map((t) => ({ label: t.question.toUpperCase(), answers: t.answers })),
    });

  const specific = by.get("course_specific");
  if (specific)
    cards.push({
      icon: "➕",
      title: "Course-Specific Questions",
      ratings: specific.ratings,
      ratingHeader: "STATEMENT",
      distributions: specific.choices.map((c) => ({
        label: c.question.toUpperCase(),
        choice: c,
      })),
      textBlocks: textsOf(specific)
        .filter((t) => t.answers.length > 0)
        .map((t) => ({ label: t.question.toUpperCase(), answers: t.answers })),
    });

  const other = by.get("other_comments");
  if (other)
    cards.push({
      icon: "🗒️",
      title: "Other Comments",
      textBlocks: textsOf(other)
        .filter((t) => t.answers.length > 0)
        .map((t) => ({ answers: t.answers })),
    });

  return cards;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** Green from 4.5, blue below it — the split the reference uses. */
const avgColour = (v: number) => (v >= 4.5 ? GREEN : v >= 3 ? BLUE : RED);

export function buildFeedbackReportPdf(report: CourseFeedbackReport): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const right = MARGIN + CONTENT_W;
  let y = 0;

  /* A card that runs past the bottom of a page is drawn as one bordered box
     per page it touches, the way the reference's long tables carry over.
     The boxes are collected while the contents are laid out and stroked at
     the end, because a box's height is not known until its contents stop. */
  let segments: { page: number; top: number; bottom: number }[] = [];
  let segTop: number | null = null;

  const newPage = () => {
    if (segTop !== null) {
      segments.push({
        page: doc.getNumberOfPages(),
        top: segTop,
        bottom: PAGE_H - FOOTER_SPACE + 10,
      });
    }
    doc.addPage();
    y = MARGIN;
    if (segTop !== null) segTop = y - 10;
  };

  const need = (h: number) => {
    if (y + h > PAGE_H - FOOTER_SPACE) newPage();
  };

  const sans = (size: number, colour: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(colour);
  };
  const serif = (size: number, colour: string) => {
    doc.setFont("times", "normal");
    doc.setFontSize(size);
    doc.setTextColor(colour);
  };

  /** Small caps with the letter-spacing the reference sets them in. */
  const tracked = (text: string, x: number, yy: number, gap = 0.6) => {
    let cx = x;
    for (const ch of text) {
      doc.text(ch, cx, yy);
      cx += doc.getTextWidth(ch) + gap;
    }
    return cx - x;
  };

  const icon = (ch: string, x: number, yy: number, size: number) => {
    const png = emojiImage(ch);
    if (png) doc.addImage(png, "PNG", x, yy, size, size);
  };

  /* ---------------- masthead ---------------- */

  y = 92;
  icon("🎓", MARGIN + 6, y - 14, 20);
  serif(15.6, TITLE_GREY);
  doc.text("Student Feedback Report", MARGIN + 40, y);
  y += 17;
  sans(10.2, OLIVE, true);
  doc.text("Department of Computer Engineering", MARGIN + 40, y);
  y += 15;
  sans(9.4, TITLE_GREY);
  doc.text(
    "Faculty of Engineering — University of Sri Jayewardenepura",
    MARGIN + 40,
    y,
  );
  y += 34;

  /* ---------------- meta card ---------------- */

  const meta: [string, string, string, boolean][] = [
    ["COURSE", `${report.course_code} – ${report.course_title}`, NAVY, true],
    ["LECTURER", report.lecturer_name, NAVY, true],
    [
      "FEEDBACK TYPE",
      report.feedback_type === "end_semester"
        ? "End Semester Feedback"
        : "Mid Semester Feedback",
      BLUE,
      true,
    ],
    ["SEMESTER", `Semester ${report.semester}`, BODY, false],
    ["ACADEMIC YEAR", report.academic_year, BODY, false],
    ["RESPONSES", `${report.response_count} student(s)`, BODY, false],
    ["GENERATED ON", longDate(report.generated_on), BODY, false],
  ];
  const metaH = 26 + meta.length * 19;
  need(metaH);
  doc.setDrawColor(CARD_BORDER);
  doc.setFillColor("#ffffff");
  doc.setLineWidth(0.8);
  doc.roundedRect(MARGIN, y, CONTENT_W, metaH, 7, 7, "FD");
  let my = y + 24;
  meta.forEach(([label, value, colour, bold]) => {
    sans(9.6, LABEL);
    tracked(label, MARGIN + 20, my);
    sans(10.8, colour, bold);
    doc.text(value, MARGIN + 176, my);
    my += 19;
  });
  y += metaH + 14;

  /* ---------------- the two headline scores ---------------- */

  const cardW = (CONTENT_W - 10) / 2;
  const scoreH = 62;
  need(scoreH + 10);
  ([
    ["OVERALL LECTURER SCORE", report.scores.lecturer_overall, GREEN],
    ["COURSE CONTENT SCORE", report.scores.course_content, BLUE],
  ] as [string, number | null, string][]).forEach(([label, value, colour], i) => {
    const x = MARGIN + i * (cardW + 10);
    doc.setDrawColor(CARD_BORDER);
    doc.setFillColor("#ffffff");
    doc.roundedRect(x, y, cardW, scoreH, 7, 7, "FD");
    // The coloured edge the reference caps each score card with.
    doc.setFillColor(colour);
    doc.roundedRect(x + 1, y, cardW - 2, 3, 1.5, 1.5, "F");
    sans(24, colour, true);
    doc.text(value !== null ? value.toFixed(2) : "—", x + cardW / 2, y + 34, {
      align: "center",
    });
    sans(8.6, LABEL);
    const w = label.length * 0.6;
    doc.text(label, x + cardW / 2, y + 50, { align: "center" });
    void w;
  });
  y += scoreH + 16;

  /* ---------------- section cards ---------------- */

  /* Five-pointed stars, drawn rather than typed: none of jsPDF's three
     built-in faces carries a star glyph, and the reference reaches for a
     CJK font to get one. */
  const star = (cx: number, cy: number, r: number, colour: string) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.42;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    const deltas = pts
      .slice(1)
      .map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]] as [number, number]);
    doc.setFillColor(colour);
    doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], "F", true);
  };

  const drawStars = (avg: number, x: number, yy: number) => {
    const filled = Math.round(avg);
    for (let i = 1; i <= 5; i++) {
      star(x + (i - 1) * 12 + 5, yy - 3, 5.2, i <= filled ? AMBER_FILL : "#c9c9c9");
    }
    return 5 * 12;
  };

  const cards = buildCards(report);

  cards.forEach((card) => {
    /* Card header: icon, serif title, and the top edge of a box whose
       height is only known once its contents are laid out. So the border is
       drawn last, from the remembered start. */
    // Enough for the heading and the first rows under it: a card title alone
    // at the foot of a page, with its contents overleaf, reads as an error.
    need(120);
    segments = [];
    segTop = y;
    y += 26;
    icon(card.icon, MARGIN + PAD, y - 12, 15);
    serif(12, TITLE_GREY);
    doc.text(card.title, MARGIN + PAD + 22, y);
    y += 16;

    if (card.overallAverage !== null && card.overallAverage !== undefined) {
      sans(10.2, MUTED);
      doc.text("Overall Average:", MARGIN + PAD, y + 6);
      const w = drawStars(card.overallAverage, MARGIN + PAD + 78, y + 6);
      sans(10.2, MUTED);
      doc.text(
        `${card.overallAverage.toFixed(2)} / 5`,
        MARGIN + PAD + 84 + w,
        y + 6,
      );
      y += 18;
    }

    /* ----- rating table ----- */
    if (card.ratings && card.ratings.length > 0) {
      y += 8;
      const drawHead = () => {
        sans(9, MUTED);
        tracked(card.ratingHeader ?? "STATEMENT", MARGIN + TABLE_INSET, y);
        tracked("RATING", MARGIN + CONTENT_W * 0.63, y);
        const avgW = doc.getTextWidth("AVG") + 2 * 0.6;
        tracked("AVG", right - TABLE_INSET - avgW, y);
        y += 8;
        doc.setDrawColor(CARD_BORDER);
        doc.setLineWidth(0.6);
        doc.line(MARGIN + TABLE_INSET, y, right - TABLE_INSET, y);
        y += 4;
      };
      drawHead();

      card.ratings.forEach((r, i) => {
        sans(9.8, BODY);
        const label = card.numbered ? `${i + 1}. ${r.question}` : r.question;
        const lines = doc.splitTextToSize(
          label,
          CONTENT_W * 0.6 - TABLE_INSET,
        ) as string[];
        const rowH = Math.max(20, lines.length * 12 + 8);
        if (y + rowH > PAGE_H - FOOTER_SPACE) {
          newPage();
          y += 18;
          drawHead();
        }
        doc.text(lines, MARGIN + TABLE_INSET, y + 12);
        sans(10.2, avgColour(r.average), true);
        doc.text(r.average.toFixed(2), right - TABLE_INSET, y + 12, {
          align: "right",
        });
        y += rowH;
        doc.setDrawColor(ROW_RULE);
        doc.setLineWidth(0.5);
        doc.line(MARGIN + TABLE_INSET, y, right - TABLE_INSET, y);
      });
      y += 8;
    }

    /* ----- what was actually used ----- */
    if (card.adopted) {
      need(40);
      y += 8;
      sans(9.4, LABEL, true);
      tracked(card.adopted.label, MARGIN + PAD, y);
      y += 18;
      sans(12, NAVY, true);
      doc.text(card.adopted.value, MARGIN + PAD + 10, y);
      y += 14;
    }

    /* ----- distributions ----- */
    (card.distributions ?? []).forEach((d) => {
      need(30);
      y += 10;
      sans(9.4, LABEL, true);
      tracked(d.label, MARGIN + PAD, y);
      y += 6;

      const barX = MARGIN + PAD;
      const barW = CONTENT_W * 0.62;
      d.choice.tallies.forEach((t, i) => {
        need(26);
        y += 14;
        const fill = BAR_FILL[i % BAR_FILL.length];
        const ink = t.count === 0 ? ZERO_GREY : BAR_TEXT[i % BAR_TEXT.length];
        sans(9.6, BODY);
        doc.text(t.label, barX, y);
        sans(9.6, ink, true);
        doc.text(`${t.count}  (${t.pct}%)`, right - PAD, y, { align: "right" });
        y += 6;
        doc.setFillColor(TRACK);
        doc.roundedRect(barX, y, barW, 5, 2.5, 2.5, "F");
        if (t.pct > 0) {
          doc.setFillColor(fill);
          const w = Math.max(8, (barW * t.pct) / 100);
          doc.roundedRect(barX, y, w, 5, 2.5, 2.5, "F");
        }
        y += 5;
      });
      y += 6;
    });

    /* ----- skills cloud ----- */
    if (card.cloud && card.cloud.tallies.length > 0) {
      need(80);
      y += 12;
      sans(9.4, LABEL, true);
      tracked(card.cloud.label, MARGIN + PAD, y);
      y += 8;

      const counts = card.cloud.tallies.map((t) => t.count);
      const hi = Math.max(...counts, 1);
      const lo = Math.min(...counts);
      const boxX = MARGIN + PAD;
      const boxW = CONTENT_W - PAD * 2;

      // Lay the words out in rows, largest first, wrapping at the box edge.
      type Word = { text: string; size: number; colour: string; w: number };
      const words: Word[] = card.cloud.tallies.map((t, i) => {
        const span = hi === lo ? 1 : (t.count - lo) / (hi - lo);
        const size = 9 + span * 10.5;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        return {
          text: t.label,
          size,
          colour: CLOUD[i % CLOUD.length],
          w: doc.getTextWidth(t.label),
        };
      });

      const rows: Word[][] = [];
      let row: Word[] = [];
      let used = 0;
      words.forEach((w) => {
        if (used + w.w + 18 > boxW - 30 && row.length > 0) {
          rows.push(row);
          row = [];
          used = 0;
        }
        row.push(w);
        used += w.w + 18;
      });
      if (row.length > 0) rows.push(row);

      const boxH = rows.length * 30 + 18;
      need(boxH + 6);
      doc.setDrawColor(CARD_BORDER);
      doc.setFillColor("#ffffff");
      doc.roundedRect(boxX, y, boxW, boxH, 5, 5, "FD");
      let ry = y + 24;
      rows.forEach((r) => {
        let rx = boxX + 16;
        r.forEach((w) => {
          sans(w.size, w.colour, true);
          doc.text(w.text, rx, ry);
          rx += w.w + 18;
        });
        ry += 30;
      });
      y += boxH + 10;
    }

    /* ----- quoted comments ----- */
    (card.textBlocks ?? []).forEach((block) => {
      if (block.answers.length === 0) return;
      need(30);
      y += 10;
      if (block.label) {
        sans(9.6, NAVY, true);
        tracked(block.label, MARGIN + PAD, y);
        y += 6;
      }
      block.answers.forEach((answer, i) => {
        sans(10.2, BODY);
        const lines = doc.splitTextToSize(
          answer,
          CONTENT_W - PAD * 2 - 34,
        ) as string[];
        const h = Math.max(20, lines.length * 12 + 8);
        need(h + 4);
        y += 14;
        sans(8.4, TITLE_GREY);
        doc.text(String(i + 1), MARGIN + PAD + 8, y + 2, { align: "right" });
        // The amber rule the reference sets beside every quoted comment.
        doc.setFillColor(AMBER_FILL);
        doc.roundedRect(MARGIN + PAD + 20, y - 8, 2, h - 6, 1, 1, "F");
        sans(10.2, BODY);
        doc.text(lines, MARGIN + PAD + 32, y + 2);
        y += h - 8;
      });
      y += 8;
    });

    /* Close the card: one bordered box per page it touched. */
    y += 10;
    segments.push({
      page: doc.getNumberOfPages(),
      top: segTop ?? y,
      bottom: y,
    });
    segTop = null;

    const here = doc.getNumberOfPages();
    doc.setDrawColor(CARD_BORDER);
    doc.setLineWidth(0.8);
    segments.forEach((s) => {
      doc.setPage(s.page);
      doc.roundedRect(MARGIN, s.top, CONTENT_W, s.bottom - s.top, 7, 7, "S");
    });
    doc.setPage(here);
    y += 14;
  });

  /* ---------------- footer on every page ---------------- */

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(CARD_BORDER);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, PAGE_H - 52, right, PAGE_H - 52);
    sans(9, FOOTER_GREY);
    doc.text(
      "This report is confidential and intended for the recipient only.",
      PAGE_W / 2,
      PAGE_H - 36,
      { align: "center" },
    );
    doc.text(
      `Department of Computer Engineering — Faculty of Engineering — University of Sri Jayewardenepura — ${longDate(report.generated_on)}`,
      PAGE_W / 2,
      PAGE_H - 22,
      { align: "center" },
    );
  }

  return doc;
}

/** Filename in the shape the faculty's own files use. */
export function feedbackReportFilename(report: CourseFeedbackReport): string {
  const type =
    report.feedback_type === "end_semester" ? "End Semester" : "Mid Semester";
  const safe = report.lecturer_name.replace(/[\\/:*?"<>|]/g, "");
  return `${report.course_code} ${report.academic_year.replace("/", "-")} ${type} Feedback ${safe}.pdf`;
}
