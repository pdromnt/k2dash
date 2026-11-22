import type { BeltCalibrationDirection, BeltModule, BeltModuleReadback } from './beltCalibrationTypes'
export type { BeltModule, BeltModuleReadback } from './beltCalibrationTypes'

interface BeltCalibrationTransportOptions {
  send: (gcode: string) => Promise<unknown>
  subscribe: (listener: (text: string) => void) => () => void
  canSend: () => boolean
  signal?: AbortSignal
  timeoutMs?: number
}

const WAIT_MS = 12_000
const RESET_SETTLE_MS = 1_000
const UNSET = 0xffff_ffff
const directions = [0, 1, 2, 0] as const
const fields = {
  current_place: 'position',
  idl_adc: 'baselineAdc',
  full_adc: 'loadedAdc',
} as const

function responseLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim().replace(/^\/\/\s*/, ''))
}

function uint32(text: string): number | undefined {
  if (!/^\d{1,10}$/.test(text)) return
  const value = Number(text)
  if (value <= UNSET) return value
}

function usable(record: BeltModuleReadback) {
  return record.position !== UNSET
    && record.baselineAdc !== UNSET && record.baselineAdc !== 0
    && record.loadedAdc !== UNSET && record.loadedAdc !== 0
    && record.baselineAdc !== record.loadedAdc
}

function sameFields(a: BeltModuleReadback, b: BeltModuleReadback) {
  return a.module === b.module && a.position === b.position
    && a.baselineAdc === b.baselineAdc && a.loadedAdc === b.loadedAdc
}

function firmwareError(line: string) {
  return /^(!!|Error:|Unknown command|reset:|(?:write_flash|get_flash|adc)[_ ]error)/i.test(line)
    || /"code"\s*:\s*"key7\d{2}"/.test(line)
}

function parser(module: BeltModule, writeDirection?: BeltCalibrationDirection) {
  let ack = false
  let writeAck = false
  let sawFlashData = false
  let sample: number | undefined
  const values: Partial<Omit<BeltModuleReadback, 'module'>> = {}

  return (line: string): { record: BeltModuleReadback; sample?: number } | undefined => {
    if (line === 'ACK_mdl_info') {
      if (ack || (writeDirection !== undefined && !writeAck)) {
        throw new Error('Unexpected belt module reply. A fresh, ordered readback is required.')
      }
      ack = true
      return
    }

    const name = /^MDL_NAME:\s*(\S+)$/.exec(line)
    if (name && (ack || writeDirection !== undefined)) {
      if (name[1] !== module) throw new Error('The printer replied for the wrong belt module.')
      if (!ack) {
        if (writeAck || !sawFlashData || (writeDirection !== 0 && sample === undefined)) {
          throw new Error('The calibration write was not confirmed by the expected telemetry.')
        }
        writeAck = true
        return
      }
      const { position, baselineAdc, loadedAdc } = values
      if (position === undefined || baselineAdc === undefined || loadedAdc === undefined) {
        throw new Error('The belt module returned an incomplete readback.')
      }
      const record = { module, position, baselineAdc, loadedAdc }
      if (!usable(record)) throw new Error('The belt module did not return a usable calibration record.')
      return { record, sample }
    }

    if (!ack && writeDirection !== undefined && !writeAck) {
      const capture = /^adc_num:\s*(.*)$/.exec(line)
      if (capture) {
        const value = uint32(capture[1]!)
        if (writeDirection === 0 || sawFlashData || sample !== undefined || value === undefined
          || value === 0 || value === UNSET) {
          throw new Error('The calibration write returned an invalid or out-of-order ADC sample.')
        }
        sample = value
      } else if (line.startsWith('flash_data:')) {
        if (sawFlashData || /^flash_data:\s*(?:0|None|\[\]|)\s*$/.test(line)) {
          throw new Error('The belt module flash response was invalid.')
        }
        sawFlashData = true
      }
      return
    }

    if (!ack) return
    const datum = /^(current_place|idl_adc|full_adc):\s*(.*)$/.exec(line)
    if (datum) {
      const key = fields[datum[1] as keyof typeof fields]
      const value = uint32(datum[2]!)
      if (value === undefined || values[key] !== undefined) {
        throw new Error('The belt module returned invalid or duplicate readback data.')
      }
      values[key] = value
    }
  }
}

/** One session, using only fixed Creality commands. The caller owns all physical gates. */
export function createBeltCalibrationTransport(options: BeltCalibrationTransportOptions) {
  const snapshots: Partial<Record<BeltModule, BeltModuleReadback>> = {}
  const phase: Record<BeltModule, number> = { mdlx: 0, mdly: 0 }
  const baselineNotBefore: Record<BeltModule, number> = { mdlx: 0, mdly: 0 }
  let busy = false
  let invalidated = false

  function assertReady() {
    if (invalidated || options.signal?.aborted || !options.canSend()) {
      throw new Error('Calibration session is not safe to continue. Restart with a fresh preflight.')
    }
  }

  function waitForReset(module: BeltModule) {
    const remaining = Math.ceil(baselineNotBefore[module] - globalThis.performance.now())
    if (remaining <= 0) return
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        options.signal?.removeEventListener('abort', abort)
        resolve()
      }, remaining)
      function abort() {
        clearTimeout(timer)
        reject(new Error('Calibration session interrupted.'))
      }
      options.signal?.addEventListener('abort', abort, { once: true })
    })
  }

  function exchange(module: BeltModule, script: string, direction?: BeltCalibrationDirection) {
    assertReady()
    return new Promise<{ record: BeltModuleReadback; sample?: number }>((resolve, reject) => {
      const parse = parser(module, direction)
      let unsubscribe: (() => void) | undefined
      let settled = false
      let started = false
      const timer = setTimeout(() => finish(new Error('Timed out waiting for a complete belt module reply.')), options.timeoutMs ?? WAIT_MS)
      function abort() { finish(new Error('Calibration session interrupted.')) }
      function finish(error?: unknown, result?: { record: BeltModuleReadback; sample?: number }) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
        unsubscribe?.()
        if (error) reject(error)
        else resolve(result!)
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      try {
        unsubscribe = options.subscribe((text) => {
          // Reject subscription replay as evidence for this exchange.
          if (!started) return
          try {
            assertReady()
            const lines = responseLines(text)
            // Klipper can send each field as a separate notification. The
            // evaluated firmware emits MDL_NAME only after its module routine
            // returns. Check every line in a batched response before accepting it.
            if (lines.some(firmwareError)) {
              throw new Error('The printer reported a belt module or G-code error.')
            }
            for (const line of lines) {
              const result = parse(line)
              if (result) {
                finish(undefined, result)
                break
              }
            }
          } catch (error) {
            finish(error)
          }
        })
        assertReady()
        started = true
        void options.send(script).catch((error) => finish(error))
      } catch (error) {
        finish(error)
      }
    })
  }

  async function perform<T>(op: () => Promise<T>) {
    if (busy) throw new Error('A belt module operation is already in progress.')
    assertReady()
    busy = true
    try {
      return await op()
    } catch (error) {
      invalidated = true
      throw error
    } finally {
      busy = false
    }
  }

  function validateModule(module: BeltModule) {
    if (module !== 'mdlx' && module !== 'mdly') throw new Error('Unsupported belt module.')
  }

  async function read(module: BeltModule) {
    validateModule(module)
    return perform(async () => {
      const { record } = await exchange(module, `BELT_MDL_INFO MDL_NAME=${module}`)
      const previous = snapshots[module]
      if (previous && !sameFields(previous, record)) {
        throw new Error('Belt module values changed outside this session. Do not continue.')
      }
      snapshots[module] = { ...record }
      return record
    })
  }

  async function writeAndRead(module: BeltModule, direction: BeltCalibrationDirection) {
    validateModule(module)
    return perform(async () => {
      const previous = snapshots[module]
      if (!previous || !snapshots.mdlx || !snapshots.mdly
        || directions[phase[module]] !== direction
        || (module === 'mdly' && phase.mdlx !== directions.length)) {
        throw new Error('Both belt modules require successful preflight and each stage must be run in order.')
      }
      if (direction === 1) {
        const settling = waitForReset(module)
        if (settling) await settling
      }
      const { record: before } = await exchange(module, `BELT_MDL_INFO MDL_NAME=${module}`)
      if (!sameFields(previous, before)) throw new Error('The belt module changed since its last readback.')
      const capture = direction === 1 ? ' TEN=140' : direction === 2 ? ' TEN=160' : ''
      assertReady()
      let result
      try {
        result = await exchange(module, [
          ...(direction === 0 ? ['M84'] : []),
          `BELT_MDL_CALI MDL_NAME=${module} DIR=${direction}${capture}`,
          'M400',
          `BELT_MDL_INFO MDL_NAME=${module}`,
        ].join('\n'), direction)
        assertReady()
        const { record, sample } = result
        const expected = {
          module,
          position: direction === 0 ? 0 : before.position,
          baselineAdc: direction === 1 ? sample! : before.baselineAdc,
          loadedAdc: direction === 2 ? sample! : before.loadedAdc,
        }
        if (!sameFields(record, expected)) throw new Error('The saved values did not match the captured stage.')
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Calibration write outcome is uncertain. Stop; do not retry or move with the jig installed. ${detail}`, { cause: error })
      }
      snapshots[module] = { ...result.record }
      // Start the dwell only once the initial reset has been verified. The
      // final reset doesn't lead to another baseline on this module.
      if (phase[module] === 0) {
        baselineNotBefore[module] = globalThis.performance.now() + RESET_SETTLE_MS
      }
      phase[module]++
      return result.record
    })
  }

  return { read, writeAndRead }
}
