// Faculty intake numbering: Batch 1 corresponds to the 2015/2016 intake
// (batch_year 2015). Derived from the existing "Batch 7" label already used
// throughout the app for batch_year 2021 (2021 - 2015 + 1 = 7).
const FIRST_BATCH_INTAKE_YEAR = 2015;

export function getBatchNumber(batchYear: number): number {
  return batchYear - FIRST_BATCH_INTAKE_YEAR + 1;
}

export function describeBatch(batchYear: number | null | undefined): string {
  if (!batchYear) return "—";
  return `Batch ${getBatchNumber(batchYear)} (${batchYear}/${batchYear + 1})`;
}
