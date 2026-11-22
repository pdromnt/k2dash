/** Remaining job usage, not remaining stock on any particular spool. */
export function estimateFilamentLeft(
  usedMm: number | null,
  totalMm: number,
  totalGrams: number,
) {
  if (usedMm === null || usedMm < 0 || !Number.isFinite(usedMm) ||
      totalMm <= 0 || !Number.isFinite(totalMm)) return null

  const mm = Math.max(0, totalMm - usedMm)
  return {
    mm,
    // The slicer already accounts for the materials' densities. Without
    // per-material live usage this is the job's average grams per metre.
    grams: totalGrams > 0 && Number.isFinite(totalGrams)
      ? (mm / totalMm) * totalGrams
      : null,
  }
}
