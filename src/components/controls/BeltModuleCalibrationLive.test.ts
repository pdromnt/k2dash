// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type Ref } from 'vue'
import { createPinia } from 'pinia'
import { usePrinterStore } from '@/stores/printer'
import Wizard from './BeltModuleCalibrationLive.vue'
import {
  beltWriteSteps,
  type BeltModule,
  type BeltModuleReadback,
} from '@/printer/beltCalibrationWorkflow'

const state = vi.hoisted(() => ({
  safe: true,
  preview: false,
  active: undefined as Ref<boolean> | undefined,
  connected: undefined as Ref<boolean> | undefined,
  read: vi.fn(),
  write: vi.fn(),
  release: vi.fn(),
  monitor: vi.fn(),
  request: vi.fn(),
  stopMonitor: vi.fn(),
  prep: vi.fn(),
  help: vi.fn(),
  canTurnOff: true,
  outputInitiallyOnline: true,
  notifyOutputConnection: undefined as ((connected: boolean) => void) | undefined,
  stopOutput: vi.fn(),
  acquire: vi.fn(),
}))
vi.mock('@/utils/preview', () => ({
  get isPreview() {
    return state.preview
  },
}))
vi.mock('@/composables/usePrinterWs', async () => {
  const { ref } = await import('vue')
  state.active = ref(false)
  state.connected = ref(true)
  return {
    usePrinterWs: () => ({
      connected: state.connected,
      beltCalibrationActive: state.active,
      canStartBeltCalibration: () => state.safe && state.connected!.value,
      monitorBeltCalibrationStatus: state.monitor,
      canTurnOffBeltHeaters: () => state.canTurnOff && state.connected!.value,
      prepareBeltCalibration: state.prep,
      onMessage: () => () => {},
      acquireBeltCalibration: state.acquire,
    }),
  }
})
vi.mock('@/api/moonraker', () => ({ getGcodeHelp: state.help }))
vi.mock('@/api/klipperOutput', () => ({
  listenForKlipperOutput: (_reply: (text: string) => void, connection: (online: boolean) => void) => {
    state.notifyOutputConnection = connection
    connection(state.outputInitiallyOnline)
    return state.stopOutput
  },
}))
vi.mock('@/printer/beltCalibrationLive', () => ({
  createBeltCalibrationTransport: () => ({
    read: state.read,
    writeAndRead: state.write,
  }),
}))

let app: App
let samples: Record<BeltModule, BeltModuleReadback>
const flush = async () => {
  for (let i = 0; i < 8; i++) await nextTick()
}
const button = (name: string) => {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((element) => element.textContent?.trim() === name)
  if (!found) throw new Error(`Missing button: ${name}`)
  return found
}
async function click(name: string) {
  button(name).click()
  await flush()
}
async function confirmChecks() {
  for (const input of document.querySelectorAll<HTMLInputElement>(
    'dialog input[type=checkbox]',
  )) {
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await flush()
}
async function prepare() {
  await click('Open wizard')
  await confirmChecks()
  await click('Continue to preparation')
  await click('Check commands')
  await confirmChecks()
}
async function start() {
  await prepare()
  await click('Read both modules')
}

beforeEach(() => {
  vi.clearAllMocks()
  state.safe = true
  state.canTurnOff = true
  state.preview = false
  state.outputInitiallyOnline = true
  state.notifyOutputConnection = undefined
  state.active!.value = false
  state.connected!.value = true
  state.monitor.mockReturnValue({ refresh: state.request, stop: state.stopMonitor })
  state.request.mockReset().mockResolvedValue(undefined)
  state.prep.mockReset().mockResolvedValue('websocket')
  state.help.mockReset().mockResolvedValue({ BELT_MDL_INFO: 'read', BELT_MDL_CALI: 'calibrate' })
  samples = {
    mdlx: { module: 'mdlx', position: 9, baselineAdc: 100, loadedAdc: 200 },
    mdly: { module: 'mdly', position: 9, baselineAdc: 300, loadedAdc: 400 },
  }
  state.read.mockImplementation(async (module: BeltModule) => ({
    ...samples[module],
  }))
  state.write.mockImplementation(
    async (module: BeltModule, direction: number) => {
      const sample = samples[module]
      sample.position = 0
      if (direction === 1) sample.baselineAdc += 10
      if (direction === 2) sample.loadedAdc += 10
      return { ...sample }
    },
  )
  state.release.mockImplementation(() => {
    state.active!.value = false
  })
  state.acquire.mockImplementation(() => {
    state.active!.value = true
    return { send: vi.fn(), release: state.release, waitForNextStep: vi.fn(), beginStep: () => state.safe }
  })
  // Native modal rendering/focus is checked in Chromium; this suite exercises its lifecycle.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  const host = document.createElement('div')
  document.body.append(host)
  // Match ControlsPanel: its lock prop becomes true during our own lease.
  app = createApp({
    render: () => h(Wizard, { disabled: state.active!.value }),
  })
  const pinia = createPinia()
  app.use(pinia)
  usePrinterStore(pinia).modelId = 'F008'
  app.mount(host)
})
afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('belt tension calibration dialog', () => {
  it('does not send even a module read before Klipper output is connected', async () => {
    state.outputInitiallyOnline = false
    await prepare()
    expect(button('Read both modules').disabled).toBe(true)
    expect(document.body.textContent).toContain('Waiting for live Klipper output')
    expect(state.acquire).not.toHaveBeenCalled()
    state.notifyOutputConnection!(true)
    await flush()
    expect(button('Read both modules').disabled).toBe(false)
    await click('Read both modules')
    expect(state.read).toHaveBeenCalledTimes(2)
    expect(state.write).not.toHaveBeenCalled()
  })

  it('ends the session if the output stream drops during a write', async () => {
    await start()
    state.write.mockImplementationOnce(() => new Promise(() => {}))
    await confirmChecks()
    await click(beltWriteSteps[0]!.action)
    expect(state.connected!.value).toBe(true)
    state.notifyOutputConnection!(false)
    await flush()
    expect(document.body.textContent).toContain('Live Klipper output disconnected')
    expect(state.stopOutput).toHaveBeenCalledOnce()
    expect(state.release).toHaveBeenCalledOnce()
    expect(state.write).toHaveBeenCalledOnce()
  })

  it('keeps the current checkbox checked until a new step replaces it', async () => {
    await start()
    let finish!: (sample: BeltModuleReadback) => void
    state.write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const previous = document.querySelector<HTMLInputElement>('dialog .hold-check input')!
    await confirmChecks()
    await click(beltWriteSteps[0]!.action)
    expect(previous.checked).toBe(true)
    expect(previous.disabled).toBe(true)
    finish({ ...samples.mdlx, position: 0 })
    await flush()
    const next = document.querySelector<HTMLInputElement>('dialog .hold-check input')!
    expect(previous.isConnected).toBe(false)
    expect(next.checked).toBe(false)
    expect(button(beltWriteSteps[1]!.action).disabled).toBe(true)
    expect(document.activeElement?.tagName).toBe('H3')
  })

  it('refreshes status on return from a hidden tab and asks for a new confirmation', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.useFakeTimers()
    await start()
    await confirmChecks()
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    state.safe = false
    await vi.advanceTimersByTimeAsync(20_000)
    expect(state.request).not.toHaveBeenCalled()
    expect(state.release).not.toHaveBeenCalled()
    expect(button(beltWriteSteps[0]!.action).disabled).toBe(true)
    hidden.mockReturnValue(false)
    state.request.mockImplementationOnce(async () => { state.safe = true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(state.request).toHaveBeenCalledExactlyOnceWith(true)
    expect(document.body.textContent).toContain('Printer status verified')
    expect(button(beltWriteSteps[0]!.action).disabled).toBe(true)
    expect(state.read).toHaveBeenCalledTimes(2)
    expect(state.write).not.toHaveBeenCalled()
    await confirmChecks()
    await click(beltWriteSteps[0]!.action)
    expect(state.read).toHaveBeenLastCalledWith('mdly')
    expect(state.write).toHaveBeenCalledOnce()
  })

  it('checks the other module after reconnecting before any write and stops on a mismatch', async () => {
    await start()
    state.notifyOutputConnection!(false)
    state.notifyOutputConnection!(true)
    await flush()
    expect(document.body.textContent).toContain('Printer status verified')
    state.read.mockResolvedValueOnce({ ...samples.mdly, baselineAdc: 301 })
    await confirmChecks()
    await click(beltWriteSteps[0]!.action)
    expect(state.write).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('other belt module changed')
    expect(document.body.textContent).toContain('No calibration write was attempted')
  })

  it('does not resume or retry if the tab is hidden during an operation', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    await start()
    state.write.mockImplementationOnce(() => new Promise(() => {}))
    await confirmChecks()
    await click(beltWriteSteps[0]!.action)
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(document.body.textContent).toContain('tab was hidden while a printer operation was in progress')
    expect(state.release).toHaveBeenCalledOnce()
    expect(state.write).toHaveBeenCalledOnce()
  })

  it('checks the command list without sending G-code and requires parking confirmation before reading', async () => {
    await click('Open wizard')
    await confirmChecks()
    await click('Continue to preparation')
    const body = document.querySelector('.wizard-body')!
    expect(button('Home & park printer').disabled).toBe(true)
    expect(button('Read both modules').disabled).toBe(true)
    await click('Check commands')
    expect(body.textContent).toContain('Both belt module commands are listed')
    expect(button('Read both modules').disabled).toBe(true)
    expect(state.prep).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
    expect(state.write).not.toHaveBeenCalled()
  })

  it('keeps heater shutdown and parking in the dialog without treating a queued move as verified', async () => {
    await prepare()
    await click('Turn heaters off')
    expect(state.prep.mock.calls).toEqual([['heaters-off']])
    expect(button('Read both modules').disabled).toBe(true)
    await confirmChecks()
    await click('Home & park printer')
    expect(state.prep.mock.calls).toEqual([['heaters-off'], ['home-and-park']])
    expect(document.body.textContent).toContain('requested, not yet verified')
    expect(button('Read both modules').disabled).toBe(true)
    expect(button('Home & park printer').disabled).toBe(true)
    expect(document.querySelector('dialog')?.open).toBe(true)
    expect(state.acquire).not.toHaveBeenCalled()
    await confirmChecks()
    await click('Read both modules')
    expect(state.read).toHaveBeenCalledTimes(2)
  })

  it('blocks parking and calibration when Klipper does not list a required command', async () => {
    state.help.mockResolvedValue({ BELT_MDL_INFO: 'read' })
    await prepare()
    expect(document.body.textContent).toContain('Klipper does not list BELT_MDL_CALI')
    expect(button('Home & park printer').disabled).toBe(true)
    expect(button('Read both modules').disabled).toBe(true)
    expect(state.prep).not.toHaveBeenCalled()
  })

  it('stops after losing the printer connection during parking', async () => {
    await prepare()
    await click('Home & park printer')
    state.connected!.value = false
    await flush()
    expect(document.body.textContent).toContain('disconnected after the park request')
    expect(document.querySelector('dialog')?.open).toBe(true)
    expect(state.acquire).not.toHaveBeenCalled()
    expect(state.write).not.toHaveBeenCalled()
  })

  it.each([
    ['F021', 'K2', 'k2'],
    ['F012', 'K2 Pro', 'k2-pro'],
  ])('replaces the wizard with the manual belt guide on %s', async (model, label, slug) => {
    usePrinterStore().modelId = model
    await flush()
    expect(document.body.textContent).toContain(`Belt tensioning on the ${label} is done manually.`)
    expect(document.body.textContent).not.toContain('Open wizard')
    expect(document.querySelector('.live-intro a')?.getAttribute('href')).toBe(
      `https://wiki.creality.com/en/k2-flagship-series/${slug}/xy-belt-tensioning`,
    )
    expect(state.acquire).not.toHaveBeenCalled()
  })

  it('does not offer the wizard until a supported model is detected', async () => {
    usePrinterStore().modelId = ''
    await flush()
    expect(document.body.textContent).not.toContain('Open wizard')
    expect(document.querySelector('.live-intro strong')?.textContent).toContain('K2 Plus only')
  })

  it('wraps keyboard focus inside the dialog in both directions', async () => {
    usePrinterStore().connected = true
    await click('Open wizard')
    const dialog = document.querySelector('dialog')!
    const first = dialog.querySelector<HTMLButtonElement>('button')!
    const last = dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Emergency stop"]',
    )!
    last.focus()
    last.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(document.activeElement).toBe(first)
    first.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(document.activeElement).toBe(last)
  })

  it('opens without writes, shows a single firmware reference, and gates preparation on acknowledgments', async () => {
    await click('Open wizard')
    expect(document.querySelector('dialog')?.open).toBe(true)
    expect(document.activeElement?.textContent).toBe('Before you begin')
    expect(document.querySelector('dialog select')).toBeNull()
    expect(document.querySelector('.wizard-body strong')?.textContent).toBe('K2 Plus only.')
    expect(document.body.textContent).toContain('Firmware reference: 1.1.8.0')
    expect(button('Continue to preparation').disabled).toBe(true)
    expect(state.monitor).toHaveBeenCalledOnce()
    expect(state.read).not.toHaveBeenCalled()
    expect(state.write).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('7.5 N ± 0.5 N')
    expect(document.querySelector('a[href*="model-detail"]')).not.toBeNull()
    expect(
      document.querySelector('[aria-label="Emergency stop"]'),
    ).not.toBeNull()
    await click('Close')
    expect(document.querySelector('dialog')?.open).toBe(false)
    expect(document.activeElement).toBe(button('Open wizard'))
  })

  it('reads both modules first, then requires a new confirmation for every ordered write', async () => {
    await start()
    expect(state.read.mock.calls.map(([module]) => module)).toEqual([
      'mdlx',
      'mdly',
    ])
    expect(state.write).not.toHaveBeenCalled()
    for (const step of beltWriteSteps) {
      expect(button(step.action).disabled).toBe(true)
      if (step.phase === 'loaded') {
        expect(document.body.textContent).toContain(
          'Do not pull the belt forcefully',
        )
        expect(document.body.textContent).toContain(
          `middle of the ${step.side.toLowerCase()} belt`,
        )
      }
      await confirmChecks()
      expect(button(step.action).disabled).toBe(false)
      await click(step.action)
    }
    expect(state.write.mock.calls).toEqual(
      beltWriteSteps.map((step) => [step.module, step.direction]),
    )
    expect(button('Verify saved values').disabled).toBe(true)
    await confirmChecks()
    await click('Verify saved values')
    expect(state.read).toHaveBeenCalledTimes(4)
    expect(state.release).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain(
      'run the printer’s self-test manually before printing',
    )
    expect(document.body.textContent).toContain(
      'no printer configuration save is needed',
    )
  })

  it('stops on Escape during a write and keeps recovery guidance visible', async () => {
    await start()
    let finish!: (value: BeltModuleReadback) => void
    state.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await confirmChecks()
    await click(beltWriteSteps[0]!.action)
    const dialog = document.querySelector('dialog')!
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    await flush()
    expect(dialog.open).toBe(true)
    expect(state.release).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('may be partially calibrated')
    finish(samples.mdlx)
    await flush()
    expect(document.body.textContent).toContain('Calibration stopped')
    expect(state.write).toHaveBeenCalledOnce()
    await click('Close wizard')
    expect(dialog.open).toBe(false)
  })

  it('fails closed on invalid preflight without any write', async () => {
    state.read.mockResolvedValueOnce({ ...samples.mdlx, baselineAdc: 0 })
    await start()
    expect(document.body.textContent).toContain('blank or invalid module')
    expect(document.body.textContent).toContain(
      'No calibration write was attempted',
    )
    expect(state.write).not.toHaveBeenCalled()
    expect(state.release).toHaveBeenCalledOnce()
  })

  it('preserves the step and sends nothing while reconnecting between operations', async () => {
    await start()
    await confirmChecks()
    state.connected!.value = false
    state.notifyOutputConnection!(false)
    await flush()
    expect(document.body.textContent).toContain('Rechecking the printer connection')
    state.connected!.value = true
    await flush()
    expect(button(beltWriteSteps[0]!.action).disabled).toBe(true)
    state.notifyOutputConnection!(true)
    await flush()
    expect(document.body.textContent).toContain('Printer status verified')
    expect(button(beltWriteSteps[0]!.action).disabled).toBe(true)
    expect(state.write).not.toHaveBeenCalled()
    expect(state.read).toHaveBeenCalledTimes(2)
    expect(state.release).not.toHaveBeenCalled()
  })

  it('keeps the same step and controls locked through a prolonged reconnect', async () => {
    vi.useFakeTimers()
    await start()
    await confirmChecks()
    const heading = document.querySelector('dialog h3')
    const checkbox = document.querySelector<HTMLInputElement>('dialog .hold-check input')!
    const advance = button(beltWriteSteps[0]!.action)
    state.connected!.value = false
    await vi.advanceTimersByTimeAsync(60_000)
    expect(document.body.textContent).toContain('Still reconnecting')
    expect(document.querySelector('dialog h3')).toBe(heading)
    expect(checkbox.disabled).toBe(true)
    expect(advance.disabled).toBe(true)
    expect(button('Stop wizard').disabled).toBe(false)
    expect(button('Stop wizard').classList.contains('btn-warn')).toBe(true)
    expect(state.active!.value).toBe(true)
    advance.dispatchEvent(new Event('click', { bubbles: true }))
    expect(state.release).not.toHaveBeenCalled()
    expect(state.write).not.toHaveBeenCalled()
    state.connected!.value = true
    await flush()
    expect(document.body.textContent).toContain('Printer status verified')
    expect(checkbox.disabled).toBe(false)
    expect(advance.disabled).toBe(true)
    expect(state.write).not.toHaveBeenCalled()
  })

  it('does not report success if the final module values changed', async () => {
    await start()
    for (const step of beltWriteSteps) {
      await confirmChecks()
      await click(step.action)
    }
    state.read.mockResolvedValueOnce({ ...samples.mdlx, loadedAdc: 999 })
    await confirmChecks()
    await click('Verify saved values')
    expect(document.body.textContent).toContain('final reading does not match')
    expect(document.body.textContent).toContain('may be partially calibrated')
    expect(document.body.textContent).not.toContain(
      'Module values verified — self-test next',
    )
    expect(state.release).toHaveBeenCalledOnce()
  })

  it('preserves the stopped screen when the command lease is lost', async () => {
    await start()
    state.active!.value = false
    await flush()
    expect(document.body.textContent).toContain('printer command lock ended')
    expect(state.write).not.toHaveBeenCalled()
    expect(document.querySelector('dialog')?.open).toBe(true)
  })

  it('rejects an unexpected saved transition and does not advance', async () => {
    await start()
    state.write.mockResolvedValueOnce({
      ...samples.mdlx,
      position: 0,
      loadedAdc: 999,
    })
    await confirmChecks()
    await click(beltWriteSteps[0]!.action)
    expect(document.body.textContent).toContain('saved reading did not match')
    expect(state.write).toHaveBeenCalledOnce()
    expect(state.release).toHaveBeenCalledOnce()
  })

  it('does not acquire a session when safety becomes stale', async () => {
    await prepare()
    state.safe = false
    await click('Read both modules')
    expect(state.acquire).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
  })

  it('allows inspecting preparation in isolated preview but blocks module operations', async () => {
    state.preview = true
    await prepare()
    expect(document.body.textContent).toContain('printer commands are disabled')
    expect(button('Read both modules').disabled).toBe(true)
    button('Read both modules').dispatchEvent(
      new Event('click', { bubbles: true }),
    )
    await flush()
    expect(state.request).not.toHaveBeenCalled()
    expect(state.acquire).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
  })
})
