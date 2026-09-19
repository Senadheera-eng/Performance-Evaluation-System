import { getSettings } from "./settings";

/**
 * Faculty intake numbering: Batch 1 is the intake year configured as
 * `first_batch_intake_year` in system_settings (2015 for the Faculty of
 * Engineering, which makes the 2021 intake Batch 7).
 */
export function getBatchNumber(batchYear: number): number {
  return batchYear - getSettings().firstBatchIntakeYear + 1;
}

export function describeBatch(batchYear: number | null | undefined): string {
  if (!batchYear) return "—";
  return `Batch ${getBatchNumber(batchYear)} (${batchYear}/${batchYear + 1})`;
}
