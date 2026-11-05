import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/utils/preview', () => ({ isPreview: false, previewState: '' }))

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instance: FakeSocket
  readyState = 0
  sent: Array<Record<string, unknown>> = []
  handlers = new Map<string, Array<(event: { data: string }) => void>>()
  constructor() {
    FakeSocket.instance = this
  }
  addEventListener(name: string, handler: (event: { data: string }) => void) {
    this.handlers.set(name, [...(this.handlers.get(name) || []), handler])
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
  fire(name: string, message: Record<string, unknown> = {}) {
    for (const fn of this.handlers.get(name) || [])
      fn({ data: JSON.stringify(message) })
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('VITE_PRINTER_HOST', '192.0.2.1')
  vi.stubGlobal('window', { location: { host: 'localhost:5173' } })
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected HTTP fallback')
    }),
  )
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('native printer transport', () => {
  it('requests native file metadata and preserves the used logical filament index', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const client = usePrinterWs()
    client.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    socket.sent = []
    const pending = client.getPrintFilaments('widget.gcode')
    expect(socket.sent).toEqual([
      { method: 'get', params: { reqGcodeFile: 1, reqGcodeList: 1 } },
    ])
    socket.fire('message', {
      retGcodeFileInfo2: [
        {
          path: '/mnt/UDISK/printer_data/gcodes/widget.gcode',
          material: 'PLA;PETG',
          materialColors: '#ffffff;#000000',
          filamentWeight: '0,26.16',
        },
      ],
    })
    await expect(pending).resolves.toEqual([
      { id: 'T1B', type: 'PETG', color: '#000000' },
    ])
  })
  it('sends CFS mapping before starting and blocks repeated starts before status arrives', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const ws = usePrinterWs()
    ws.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    socket.sent = []
    await ws.startPrint('widget.gcode', {
      source: 'cfs',
      mappings: [
        { id: 'T1A', type: 'PETG', color: '#ffffff', boxId: 1, materialId: 2 },
      ],
    })
    expect(socket.sent.map((m) => Object.keys(m.params as object)[0])).toEqual([
      'colorMatch',
      'multiColorPrint',
    ])
    await expect(
      ws.startPrint('widget.gcode', { source: 'spool' }),
    ).rejects.toThrow('already active or starting')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects disconnected commands without HTTP and without inventing light state', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const { usePrinterStore } = await import('@/stores/printer')
    const ws = usePrinterWs(),
      store = usePrinterStore()
    await expect(ws.setLight(true)).rejects.toThrow('disconnected')
    await expect(
      ws.startPrint('widget.gcode', { source: 'spool' }),
    ).rejects.toThrow('disconnected')
    expect(store.ledState).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('retains independently delivered filename and layer frames', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const { usePrinterStore } = await import('@/stores/printer')
    const ws = usePrinterWs()
    ws.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    socket.fire('message', { deviceState: 1 })
    socket.fire('message', {
      printFileName: '/mnt/UDISK/printer_data/gcodes/widget.gcode',
    })
    socket.fire('message', { layer: 2, TotalLayer: 100, printProgress: 1 })
    const store = usePrinterStore()
    expect(store.printFilename).toBe('widget.gcode')
    expect(store.currentLayer).toBe(2)
    expect(store.printProgress).toBe(1)
  })
})
