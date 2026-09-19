import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const input = await FileBlob.load('outputs/me_results_extract/ME_Semester_5_Results_Extracted.xlsx');
const workbook = await SpreadsheetFile.importXlsx(input);
const preview = await workbook.render({ sheetName: 'Source Notes', range: 'A1:B10', scale: 1, format: 'png' });
await fs.writeFile('outputs/me_results_extract/source_notes_preview.png', new Uint8Array(await preview.arrayBuffer()));
console.log('notes rendered');
