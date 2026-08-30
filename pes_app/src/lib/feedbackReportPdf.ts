/**
 * The lecturer's feedback report as a PDF, following the faculty's own
 * printed format: a header block naming the course and the reader, the two
 * headline scores, then each section — attribute tables with their averages,
 * choice distributions with counts and shares, and the free text numbered as
 * the printed report numbers it.
 *
 * Deliberate departure from the source document: the printed report sets its
 * headings in colour-filled bands with emoji glyphs. jsPDF's standard fonts
 * have no emoji coverage, and embedding a font that does would add close to a
 * megabyte to the bundle for decoration. Headings here are set in the same
 * order and wording, in the brand colour, without the glyph.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CourseFeedbackReport, ReportSection } from "./staffService";

/** The order the faculty prints its sections in. Mirrors FeedbackReport.tsx. */
const PRINT_ORDER = [
  "lecturers",
  "course_content",
  "learning_resources",
  "delivery_mode",
  "teaching_approach",
  "practical_work",
  "field_visits",
  "course_specific",
  "other_comments",
];

const ADOPTED_FIRST = new Set(["delivery_mode", "teaching_approach"]);
const ADOPTED_LABEL: Record<string, string> = {
  delivery_mode: "MODE ADOPTED",
  teaching_approach: "APPROACH ADOPTED",
};

const MAROON: [number, number, number] = [196, 30, 58];
const INK: [number, number, number] = [33, 33, 33];
const GREY: [number, number, number] = [110, 110, 110];

const MARGIN = 14;

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export function buildFeedbackReportPdf(report: CourseFeedbackReport): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  /* Start a new page when the next block would not fit on this one. */
  const need = (mm: number) => {
    if (y + mm > pageHeight - 18) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const heading = (text: string) => {
    need(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...MAROON);
    doc.text(text, MARGIN, y);
    y += 1.5;
    doc.setDrawColor(...MAROON);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, MARGIN + contentWidth, y);
    y += 5;
    doc.setTextColor(...INK);
  };

  /* ---------------------------------------------------------------- */
  /* Title block                                                       */
  /* ---------------------------------------------------------------- */

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...MAROON);
  doc.text("Student Feedback Report", pageWidth / 2, y, { align: "center" });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(
    "Faculty of Engineering — University of Sri Jayewardenepura",
    pageWidth / 2,
    y,
    { align: "center" },
  );
  y += 8;
  doc.setTextColor(...INK);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.4, textColor: INK },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 34, textColor: GREY },
      1: { cellWidth: "auto" },
    },
    body: [
      ["COURSE", `${report.course_code} – ${report.course_title}`],
      ["LECTURER", report.lecturer_name],
      [
        "FEEDBACK TYPE",
        report.feedback_type === "end_semester"
          ? "End Semester Feedback"
          : "Mid Semester Feedback",
      ],
      ["SEMESTER", `Semester ${report.semester}`],
      ["ACADEMIC YEAR", report.academic_year],
      ["RESPONSES", `${report.response_count} student(s)`],
      ["GENERATED ON", longDate(report.generated_on)],
    ],
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 6;

  /* Headline scores, side by side. */
  const boxWidth = (contentWidth - 4) / 2;
  const scores: [string, number | null][] = [
    ["OVERALL LECTURER SCORE", report.scores.lecturer_overall],
    ["COURSE CONTENT SCORE", report.scores.course_content],
  ];
  need(22);
  scores.forEach(([label, value], i) => {
    const x = MARGIN + i * (boxWidth + 4);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, y, boxWidth, 18, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...MAROON);
    doc.text(value !== null ? value.toFixed(2) : "—", x + 4, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(label, x + 4, y + 14);
  });
  y += 24;
  doc.setTextColor(...INK);

  /* ---------------------------------------------------------------- */
  /* Sections                                                          */
  /* ---------------------------------------------------------------- */

  const byKey = new Map(report.sections.map((s) => [s.section_key, s]));
  const ordered = PRINT_ORDER.map((k) => byKey.get(k)).filter(
    (s): s is ReportSection => s !== undefined,
  );

  ordered.forEach((section) => {
    heading(section.section_title.toUpperCase());

    if (section.average !== null) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...GREY);
      doc.text(`Overall average: ${section.average.toFixed(2)} / 5`, MARGIN, y);
      y += 5;
      doc.setTextColor(...INK);
    }

    if (section.ratings.length > 0) {
      const numbered = section.section_key === "lecturers";
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        theme: "striped",
        headStyles: { fillColor: MAROON, fontSize: 8, halign: "left" },
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        columnStyles: { 1: { halign: "right", cellWidth: 26 } },
        head: [[numbered ? "ATTRIBUTE" : "STATEMENT", "RATING AVG"]],
        body: section.ratings.map((r, i) => [
          numbered ? `${i + 1}. ${r.question}` : r.question,
          r.average.toFixed(2),
        ]),
      });
      y =
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
          .finalY + 5;
    }

    const adoptedFirst =
      ADOPTED_FIRST.has(section.section_key) && section.choices.length > 0;

    if (adoptedFirst) {
      const adopted = section.choices[0];
      if (adopted.tallies.length > 0) {
        need(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...GREY);
        doc.text(ADOPTED_LABEL[section.section_key] ?? "ADOPTED", MARGIN, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(...INK);
        doc.text(adopted.tallies[0].label, MARGIN, y);
        y += 6;
      }
    }

    (adoptedFirst ? section.choices.slice(1) : section.choices).forEach((c) => {
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        theme: "plain",
        headStyles: { fontSize: 7.5, textColor: GREY, fontStyle: "bold" },
        styles: { fontSize: 8.5, cellPadding: 1.2 },
        columnStyles: {
          1: { halign: "right", cellWidth: 18 },
          2: { halign: "right", cellWidth: 18 },
        },
        head: [[c.question.toUpperCase(), "COUNT", "SHARE"]],
        body: c.tallies.map((t) => [t.label, String(t.count), `${t.pct}%`]),
      });
      y =
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
          .finalY + 5;
    });

    section.texts.forEach((t) => {
      need(14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...GREY);
      doc.text(t.question.toUpperCase(), MARGIN, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);

      t.answers.forEach((answer, i) => {
        // Wrap each answer, and break the page mid-list rather than letting a
        // long comment run off the bottom.
        const lines = doc.splitTextToSize(
          answer,
          contentWidth - 6,
        ) as string[];
        need(lines.length * 4 + 2);
        doc.setTextColor(...GREY);
        doc.text(String(i + 1), MARGIN, y);
        doc.setTextColor(...INK);
        doc.text(lines, MARGIN + 6, y);
        y += lines.length * 4 + 1.5;
      });
      y += 3;
    });

    y += 2;
  });

  /* ---------------------------------------------------------------- */
  /* Footer on every page                                              */
  /* ---------------------------------------------------------------- */

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(
      "This report is confidential and intended for the recipient only.",
      MARGIN,
      pageHeight - 12,
    );
    doc.text(
      `Faculty of Engineering — University of Sri Jayewardenepura — ${longDate(report.generated_on)}`,
      MARGIN,
      pageHeight - 8.5,
    );
    doc.text(`${p} / ${pages}`, pageWidth - MARGIN, pageHeight - 8.5, {
      align: "right",
    });
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
