export interface CfsSlot {
  boxId: number
  materialId: number
  type: string
  color: string
  name: string
  vendor: string
  percent: number | null
  remainingLengthMm: number | null
  minTemp: number
  maxTemp: number
  state: number
  isSpool: boolean
}

export interface CfsUnit {
  id: number
  name: string
  humidity: number | null
  temperature: number | null
  slots: CfsSlot[]
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const text = (value: unknown) => (typeof value === 'string' ? value : '')

// CrealityPrint replaces materialBoxs as a complete snapshot. A box's numeric
// state and its slots' state are NOT connection flags; connected empty units
// must remain visible. Missing boxes disappear, rather than leaving stale slots.
export function parseCfsSnapshot(
  info: Record<string, unknown>,
): { units: CfsUnit[]; spoolSlots: CfsSlot[] } | null {
  if (!Array.isArray(info.materialBoxs)) return null
  const units = new Map<number, CfsUnit>()
  const spoolSlots = new Map<string, CfsSlot>()
  for (const box of info.materialBoxs) {
    if (!record(box) || (box.type !== 0 && box.type !== 1)) continue
    const id = number(box.id)
    if (id === null || !Number.isInteger(id) || id < (box.type === 0 ? 1 : 0))
      continue
    const slots = new Map<number, CfsSlot>()
    for (const mat of Array.isArray(box.materials) ? box.materials : []) {
      if (!record(mat)) continue
      const materialId = number(mat.id)
      if (
        materialId === null ||
        !Number.isInteger(materialId) ||
        materialId < 0 ||
        materialId > 3
      )
        continue
      const color = text(mat.color)
      const type = text(mat.type)
      const rawPercent = number(mat.percent)
      const percent = rawPercent !== null && rawPercent >= 0 && rawPercent <= 100
        ? rawPercent
        : null
      const length = number(mat.remaining_length)
      slots.set(materialId, {
        boxId: id,
        materialId,
        type,
        color: color && !color.startsWith('#') ? '#' + color : color,
        name: text(mat.name),
        vendor: text(mat.vendor),
        percent,
        // A default 100% without a length is not a measured estimate.
        remainingLengthMm: box.type === 0 && type && length !== null &&
          (length > 0 || (length === 0 && percent === 0)) ? length : null,
        minTemp: number(mat.minTemp) ?? 0,
        maxTemp: number(mat.maxTemp) ?? 0,
        state: number(mat.state) ?? 0,
        isSpool: box.type === 1,
      })
    }
    const ordered = [...slots.values()].sort(
      (a, b) => a.materialId - b.materialId,
    )
    if (box.type === 1)
      ordered.forEach((slot) =>
        spoolSlots.set(`${slot.boxId}:${slot.materialId}`, slot),
      )
    else {
      const humidity = number(box.humidity)
      units.set(id, {
        id,
        name: text(box.name) || text(info.name),
        humidity:
          humidity !== null && humidity >= 0 && humidity <= 100
            ? humidity
            : null,
        temperature: number(box.temp),
        slots: ordered,
      })
    }
  }
  return {
    units: [...units.values()].sort((a, b) => a.id - b.id),
    spoolSlots: [...spoolSlots.values()],
  }
}
