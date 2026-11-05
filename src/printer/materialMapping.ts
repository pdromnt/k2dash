import type { CfsSlot } from './cfs'

export interface PrintFilament {
  id: string
  type: string
  color: string
}
export interface MaterialMapping extends PrintFilament {
  boxId: number
  materialId: number
}
export type PrintSource =
  | { source: 'spool' }
  | { source: 'cfs'; mappings: MaterialMapping[] }

export function displayFilamentColor(raw: string): string {
  let hex = raw.replace(/^#/, '')
  if (hex.length === 7) hex = hex.slice(1)
  if (hex.length === 8) hex = hex.slice(2) // Creality's #AARRGGBB
  return /^[a-f\d]{6}$/i.test(hex) ? `#${hex}` : '#75796e'
}

// The native file list exposes these fields in the same format consumed by
// CrealityPrint's DeviceFilePrint. No T0/slot assumptions when data is missing.
export function parsePrintFilaments(
  file: Record<string, unknown>,
): PrintFilament[] {
  if (
    typeof file.material !== 'string' ||
    typeof file.materialColors !== 'string'
  )
    return []
  const types = file.material.split(';'),
    colors = file.materialColors.split(';')
  if (
    !types.length ||
    types.length !== colors.length ||
    types.some((t) => !t.trim())
  )
    return []
  // Native metadata includes every configured slicer filament, even ones not
  // used by this plate. Only omit slots explicitly reported as zero weight;
  // keep the original indices so a sole T1B never becomes T1A.
  const weights =
    typeof file.filamentWeight === 'string'
      ? file.filamentWeight.split(',').map((value) => value.trim())
      : []
  const hasWeights =
    weights.length === types.length &&
    weights.every(
      (value) =>
        value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0,
    )
  return types.flatMap((type, index) =>
    hasWeights && Number(weights[index]) === 0
      ? []
      : [
          {
            id: `T${Math.floor(index / 4) + 1}${String.fromCharCode(65 + (index % 4))}`,
            type: type.trim(),
            color: displayFilamentColor(colors[index] || ''),
          },
        ],
  )
}

export function validateMaterialMapping(mappings: MaterialMapping[]) {
  if (!mappings.length) throw new Error('Choose a CFS slot for every filament')
  const ids = new Set<string>()
  for (const m of mappings) {
    if (
      !/^T[1-9]\d*[A-D]$/.test(m.id) ||
      ids.has(m.id) ||
      !m.type.trim() ||
      !Number.isInteger(m.boxId) ||
      m.boxId < 1 ||
      !Number.isInteger(m.materialId) ||
      m.materialId < 0 ||
      m.materialId > 3
    ) {
      throw new Error('Invalid CFS filament mapping')
    }
    ids.add(m.id)
  }
}

export function validateConnectedCfsMappings(
  mappings: MaterialMapping[],
  slots: readonly CfsSlot[],
) {
  validateMaterialMapping(mappings)
  for (const mapping of mappings) {
    if (
      !slots.some(
        (slot) =>
          !slot.isSpool &&
          slot.boxId === mapping.boxId &&
          slot.materialId === mapping.materialId &&
          slot.type.trim().toUpperCase() === mapping.type.trim().toUpperCase(),
      )
    ) {
      throw new Error(
        'A mapped CFS slot is no longer available. Review the filament mapping.',
      )
    }
  }
}
