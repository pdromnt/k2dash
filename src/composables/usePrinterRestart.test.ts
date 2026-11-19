import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { getKlipperState, restartKlipper } from '@/api/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { dismissRestartNotice, restartNotice, showXs3000AsRestart, usePrinterRestart } from './usePrinterRestart'

vi.mock('@/api/moonraker', () => ({ getKlipperState: vi.fn(), restartKlipper: vi.fn() }))
vi.mock('@/composables/usePrinterWs', () => ({
  usePrinterWs: () => ({ printStarting, beltCalibrationActive }),
}))
vi.mock('@/utils/preview', () => ({ isPreview: false }))
const printStarting = ref(false)
const beltCalibrationActive = ref(false)
const transport = vi.mocked(restartKlipper)
const state = vi.mocked(getKlipperState)

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  const printer = usePrinterStore()
  printer.connected = true
  printer.state = 'ready'
  printStarting.value = false
  beltCalibrationActive.value = false
  transport.mockReset().mockResolvedValue(undefined)
  state.mockReset().mockResolvedValue('ready')
})

afterEach(() => {
  dismissRestartNotice()
  vi.useRealTimers()
})

describe('printer restart', () => {
  it.each(['paused', 'printing', 'preparing', 'unknown'] as const)(
    'blocks a restart in state %s', async (state) => {
      usePrinterStore().state = state
      const { blocked, restart } = usePrinterRestart()
      expect(blocked.value).toBe(true)
      await restart('firmware')
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it('rechecks a print start or calibration before requesting a restart', async () => {
    const { restart } = usePrinterRestart()
    printStarting.value = true
    await restart('host')
    printStarting.value = false
    beltCalibrationActive.value = true
    await restart('firmware')
    expect(transport).not.toHaveBeenCalled()
  })

  it('allows firmware recovery after emergency stop and prevents duplicate sends during startup', async () => {
    const printer = usePrinterStore()
    printer.state = 'shutdown'
    state.mockResolvedValueOnce('startup')
    const first = usePrinterRestart().restart('firmware')
    expect(restartNotice.value?.state).toBe('restarting')
    await vi.advanceTimersByTimeAsync(1000)
    await usePrinterRestart().restart('host')
    expect(transport.mock.calls).toEqual([['firmware']])
    printer.state = 'idle'
    await vi.advanceTimersByTimeAsync(1000)
    await first
    expect(usePrinterRestart().pending.value).toBe(false)
    expect(restartNotice.value).toBeNull()
  })

  it('reports a lost response as unconfirmed after 30 seconds and never retries automatically', async () => {
    transport.mockRejectedValueOnce(new Error('Request timed out'))
    const result = usePrinterRestart().restart('host')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(restartNotice.value?.state).toBe('restarting')
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(transport).toHaveBeenCalledExactlyOnceWith('host')
    expect(restartNotice.value).toEqual({ state: 'unconfirmed', detail: 'Request timed out' })
  })

  it('does not confuse a POST acknowledgment or an already-ready status with recovery', async () => {
    const result = usePrinterRestart().restart('host')
    await vi.advanceTimersByTimeAsync(2500)
    expect(restartNotice.value?.state).toBe('restarting')
    await vi.advanceTimersByTimeAsync(27_500)
    await result
    expect(restartNotice.value?.state).toBe('unconfirmed')
  })

  it('keeps waiting through an outage and XS3000, then clears once both are gone', async () => {
    const printer = usePrinterStore()
    const result = usePrinterRestart().restart('host')
    state.mockRejectedValueOnce(new Error('HTTP 503'))
    printer.errorCode = 3000
    expect(showXs3000AsRestart.value).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(restartNotice.value?.state).toBe('restarting')
    printer.errorCode = 0
    await vi.advanceTimersByTimeAsync(1000)
    await result
    expect(restartNotice.value).toBeNull()
    expect(showXs3000AsRestart.value).toBe(false)
  })

  it('confirmably recovers even if the restart acknowledgment is lost', async () => {
    transport.mockRejectedValueOnce(new Error('Connection closed'))
    state.mockResolvedValueOnce('startup')
    const result = usePrinterRestart().restart('host')
    await vi.advanceTimersByTimeAsync(2000)
    await result
    expect(restartNotice.value).toBeNull()
    expect(transport).toHaveBeenCalledExactlyOnceWith('host')
  })

  it('does not hide pre-existing XS3000 and stops contextualizing new XS3000 when the window expires', async () => {
    const printer = usePrinterStore()
    printer.errorCode = 3000
    const result = usePrinterRestart().restart('host')
    expect(showXs3000AsRestart.value).toBe(false)
    printer.errorCode = 0
    printer.errorCode = 3000
    expect(showXs3000AsRestart.value).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(restartNotice.value?.state).toBe('unconfirmed')
    expect(showXs3000AsRestart.value).toBe(false)
  })

  it('holds the command lock while the original POST is unanswered, even after the notice times out', async () => {
    let acknowledge!: () => void
    transport.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve }))
    const result = usePrinterRestart().restart('host')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(restartNotice.value?.state).toBe('unconfirmed')
    await usePrinterRestart().restart('firmware')
    expect(transport.mock.calls).toEqual([['host']])
    acknowledge()
    await result
    expect(usePrinterRestart().pending.value).toBe(false)
  })
})
