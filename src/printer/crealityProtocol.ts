export interface CrealityGetParams {
  reqGcodeFile?: 1
  reqGcodeList?: 1
  reqMaterials?: 1
  reqPrintObjects?: 1
  reqElapseVideoList?: 1
  boxsInfo?: 1
  boxConfig?: 1
}

export interface CrealitySetParams {
  gcodeCmd?: string
  lightSw?: 0 | 1
  pause?: 0 | 1
  stop?: 1
  opGcodeFile?: string
  enableSelfTest?: 0 | 1
  ctrlVideoFiles?: {
    cmd: 'remove'
    printId: string
    file: string
  }
}

export type CrealityMessage =
  | { method: 'get'; params: CrealityGetParams }
  | { method: 'set'; params: CrealitySetParams }

export type CrealityFan = 'part' | 'case' | 'side'

const CREALITY_FAN_PINS: Record<CrealityFan, number> = {
  part: 0,
  case: 1,
  side: 2,
}

export function fanGcode(fan: CrealityFan, percent: number): string {
  const pwm = Math.round(255 * (Math.min(100, Math.max(0, percent)) / 100))
  return `M106 P${CREALITY_FAN_PINS[fan]} S${pwm}`
}

export function normalizeCrealityProgress(progress: number): number {
  return Math.round(Math.min(100, Math.max(0, progress)))
}

export function normalizeCrealityLayer(layer: number): number {
  return Math.max(0, Math.round(layer))
}

export const initialStateRequest = (): CrealityMessage => ({
  method: 'get',
  params: {
    reqGcodeFile: 1,
    reqGcodeList: 1,
    reqMaterials: 1,
    boxsInfo: 1,
    boxConfig: 1,
  },
})

export const statusRequest = (): CrealityMessage => ({
  method: 'get',
  params: { reqPrintObjects: 1, reqGcodeFile: 1 },
})

export const timelapseListRequest = (): CrealityMessage => ({
  method: 'get',
  params: { reqElapseVideoList: 1 },
})

export const gcodeCommand = (command: string): CrealityMessage => ({
  method: 'set',
  params: { gcodeCmd: command },
})

export const lightCommand = (enabled: boolean): CrealityMessage => ({
  method: 'set',
  params: { lightSw: enabled ? 1 : 0 },
})

export const pauseCommand = (): CrealityMessage => ({ method: 'set', params: { pause: 1 } })
export const resumeCommand = (): CrealityMessage => ({ method: 'set', params: { pause: 0 } })
export const cancelCommand = (): CrealityMessage => ({ method: 'set', params: { stop: 1 } })

export function toCrealityGcodePath(path: string): string {
  if (path.startsWith('/mnt/UDISK/printer_data/gcodes/')) return path
  const relative = path.replace(/^\/+/, '').replace(/^gcodes\//, '')
  return `/mnt/UDISK/printer_data/gcodes/${relative}`
}

export const startPrintCommand = (path: string): CrealityMessage => ({
  method: 'set',
  params: {
    opGcodeFile: `printprt:${toCrealityGcodePath(path)}`,
    enableSelfTest: 0,
  },
})

export const deleteTimelapseCommand = (file: string): CrealityMessage => ({
  method: 'set',
  params: { ctrlVideoFiles: { cmd: 'remove', printId: '', file } },
})

export function hasTimelapseList(message: Record<string, unknown>): boolean {
  return Array.isArray(message.elapseVideoList)
}

export function hasTimelapseDeleteResult(message: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(message, 'ctrlVideoFiles')
}
