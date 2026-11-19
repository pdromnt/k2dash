// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref, type App } from 'vue'
import { createPinia } from 'pinia'
import { getGcodeHelp } from '@/api/moonraker'
import { listenForKlipperOutput } from '@/api/klipperOutput'
import { useConsole } from './useConsole'

vi.mock('@/api/moonraker', () => ({ getGcodeHelp: vi.fn() }))
vi.mock('@/api/klipperOutput', () => ({ listenForKlipperOutput: vi.fn() }))
vi.mock('@/composables/usePrinterWs', () => ({
  usePrinterWs: () => ({ connected: ref(true), sendGcodeCommand: sendNative, onMessage: onNativeMessage }),
}))

const sendNative = vi.fn()
const onNativeMessage = vi.fn<(fn: (message: Record<string, unknown>) => void) => () => void>()
let app: App
let panel: ReturnType<typeof useConsole>

beforeEach(() => {
  vi.resetAllMocks()
  onNativeMessage.mockReturnValue(() => {})
  const host = document.createElement('div')
  app = createApp({ setup() { panel = useConsole(); return () => null } })
  app.use(createPinia())
  app.mount(host)
})

afterEach(() => app.unmount())

describe('console command help', () => {
  it('shows documented commands for HELP without executing G-code', async () => {
    vi.mocked(getGcodeHelp).mockResolvedValue({ BELT_MDL_INFO: 'Read a module', FIRMWARE_RESTART: 'Restart' })
    await panel.sendCommand(' help ')
    expect(getGcodeHelp).toHaveBeenCalledOnce()
    expect(sendNative).not.toHaveBeenCalled()
    expect(panel.messages.value.at(-1)?.text).toContain('BELT_MDL_INFO: Read a module')
  })

  it('reports why the list could not be loaded rather than showing a blank reply', async () => {
    vi.mocked(getGcodeHelp).mockRejectedValue(new Error('HTTP 503'))
    await panel.sendCommand('HELP')
    expect(panel.messages.value.at(-1)?.text).toContain('Could not read the Klipper command list')
    expect(sendNative).not.toHaveBeenCalled()
  })

  it('keeps other commands on Creality’s native connection', async () => {
    await panel.sendCommand('STATUS')
    expect(sendNative).toHaveBeenCalledExactlyOnceWith('STATUS\n')
    expect(getGcodeHelp).not.toHaveBeenCalled()
  })
})

describe('console output sources', () => {
  it('shows native echoes only when the live Klipper stream is unavailable', () => {
    const closeOutput = vi.fn()
    vi.mocked(listenForKlipperOutput).mockReturnValue(closeOutput)
    panel.connect()
    const [receive, online] = vi.mocked(listenForKlipperOutput).mock.calls[0]!
    const [native] = onNativeMessage.mock.calls[0]!
    native({ gcodeRes: ['native', 'response'] })
    online(true)
    receive('Klipper output')
    native({ gcodeRes: 'Klipper output' })
    online(false)
    native({ gcode_response: 'native again' })
    expect(panel.messages.value.filter((msg) => msg.type === 'recv').map((msg) => msg.text))
      .toEqual(['native\nresponse', 'Klipper output', 'native again'])
    panel.connect()
    expect(listenForKlipperOutput).toHaveBeenCalledOnce()
  })
})
