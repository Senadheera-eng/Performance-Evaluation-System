import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const workDir = 'outputs/me_results_extract';
const outputDir = 'outputs/me_results_extract';
const csvText = await fs.readFile(path.join(workDir, 'classified_rows_v4.csv'), 'utf8');
const lines = csvText.trim().split(/\r?\n/);
const rows = lines.map(line => line.split(','));
const headers = rows[0];
const data = rows.slice(1).map(r => {
  while (r.length < headers.length) r.push('');
  r[16] = (r[16] || '').includes('Dean') ? "Dean's List" : '';
  return r;
});
// clear false OCR remarks from stamp/signature area
for (const r of data) {
  if (r[0] === '42' || r[0] === '43') r[16] = '';
}

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('ME Sem 5 Results');
sheet.showGridLines = false;
sheet.getRange('A1:Q1').merge();
sheet.getRange('A1').values = [['Mechanical Engineering Semester 05 Results - Extracted from ME.pdf']];
sheet.getRange('A2:Q2').merge();
sheet.getRange('A2').values = [['University of Sri Jayewardenepura | Faculty of Engineering | Academic Year 2024/2025 | Board of Examiners Date 2026-04-02']];
sheet.getRange('A4:Q4').values = [headers];
sheet.getRangeByIndexes(4,0,data.length,headers.length).values = data.map(r => r.map((v,i) => {
  if ([0,13,14,15].includes(i) && v !== '') return Number(v);
  return v;
}));

const used = sheet.getRange(`A4:Q${4+data.length}`);
const title = sheet.getRange('A1:Q1');
title.format = { fill: '#8B1538', font: { bold: true, color: '#FFFFFF', size: 14 }, horizontalAlignment: 'center' };
sheet.getRange('A2:Q2').format = { fill: '#FDE68A', font: { color: '#111827', italic: true }, horizontalAlignment: 'center' };
sheet.getRange('A4:Q4').format = { fill: '#C41E3A', font: { bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', wrapText: true };
used.format.borders = { preset: 'all', style: 'thin', color: '#D9D9D9' };
sheet.getRange(`A5:B${4+data.length}`).format.horizontalAlignment = 'center';
sheet.getRange(`C5:M${4+data.length}`).format.horizontalAlignment = 'center';
sheet.getRange(`N5:P${4+data.length}`).format.horizontalAlignment = 'right';
sheet.getRange(`N5:N${4+data.length}`).format.numberFormat = '#,##0';
sheet.getRange(`O5:P${4+data.length}`).format.numberFormat = '0.00';
sheet.getRange(`Q5:Q${4+data.length}`).format.horizontalAlignment = 'center';
sheet.getRange(`Q5:Q${4+data.length}`).format.font = { bold: true, color: '#8B1538' };

// widths
const widths = [7,14,9,9,9,9,9,9,9,9,9,9,9,11,12,12,15];
for (let i=0;i<widths.length;i++) sheet.getRangeByIndexes(0,i,1,1).format.columnWidth = widths[i];
sheet.getRange('A1:Q2').format.rowHeight = 26;
sheet.getRange('A4:Q4').format.rowHeight = 42;
sheet.freezePanes.freezeRows(4);
const table = sheet.tables.add(`A4:Q${4+data.length}`, true, 'MechanicalSem5Results');
table.style = 'TableStyleMedium2';
table.showFilterButton = true;

const notes = workbook.worksheets.add('Source Notes');
notes.showGridLines = false;
notes.getRange('A1:D1').merge();
notes.getRange('A1').values = [['Extraction Notes']];
notes.getRange('A1:D1').format = { fill: '#8B1538', font: { bold: true, color: '#FFFFFF', size: 14 }, horizontalAlignment: 'center' };
notes.getRange('A3:B10').values = [
  ['Source PDF', 'E:/Results/Sem 5/ME.pdf'],
  ['Department', 'Mechanical Engineering'],
  ['Batch', '2021/2022'],
  ['Academic Year / Semester', '2024/2025 - Semester 05'],
  ['Exam Duration', '2025-10-07 to 2025-11-01'],
  ['Board of Examiners Date', '2026-04-02'],
  ['Rows Extracted', data.length],
  ['Important Note', 'Extracted from scanned PDF images using OCR + table-grid/template matching. Please review against source before database upload.']
];
notes.getRange('A3:A10').format = { fill: '#F3F4F6', font: { bold: true } };
notes.getRange('A3:B10').format.borders = { preset: 'all', style: 'thin', color: '#D9D9D9' };
notes.getRange('A:A').format.columnWidth = 28;
notes.getRange('B:B').format.columnWidth = 95;
notes.getRange('B10').format.wrapText = true;
notes.getRange('B10').format.rowHeight = 48;

const inspect = await workbook.inspect({ kind: 'table', sheetId: 'ME Sem 5 Results', range: 'A4:Q12', include: 'values', tableMaxRows: 10, tableMaxCols: 17, maxChars: 3000 });
console.log(inspect.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 50 }, summary: 'final formula error scan' });
console.log(errors.ndjson);
const preview = await workbook.render({ sheetName: 'ME Sem 5 Results', range: 'A1:Q22', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'me_sem5_preview.png'), new Uint8Array(await preview.arrayBuffer()));
await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(path.join(outputDir, 'ME_Semester_5_Results_Extracted.xlsx'));
console.log('saved', path.resolve(outputDir, 'ME_Semester_5_Results_Extracted.xlsx'));
