/** Job usage estimates, not remaining stock on any particular spool. */
export function estimateJobFilament(
  usedMm: number | null,
  totalMm: number,
  totalGrams: number,
) {
  if (
    usedMm === null || usedMm < 0 || !Number.isFinite(usedMm) ||
    totalMm <= 0 || !Number.isFinite(totalMm)
  ) return null

  const remainingMm = Math.max(0, totalMm - usedMm)
  // The slicer accounts for material density. Without per-material live
  // usage, both weights use the job's average grams per metre.
  const estimateGrams = (mm: number) =>
    totalGrams > 0 && Number.isFinite(totalGrams) ? (mm / totalMm) * totalGrams : null
  return {
    usedGrams: estimateGrams(usedMm),
    remainingMm,
    remainingGrams: estimateGrams(remainingMm),
  }
}
