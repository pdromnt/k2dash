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
    socket.fire('message', {
      boxsInfo: {
        materialBoxs: [
          { id: 1, type: 0, materials: [{ id: 2, type: 'PETG' }] },
        ],
      },
    })
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
  it('replaces CFS topology, keeps partial updates, and clears sensors with removed units', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const { usePrinterStore } = await import('@/stores/printer')
    const client = usePrinterWs(),
      store = usePrinterStore()
    client.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    const first = {
      id: 1,
      type: 0,
      state: 0,
      humidity: 28,
      materials: [{ id: 0, type: 'PETG' }],
    }
    const second = {
      id: 3,
      type: 0,
      state: 0,
      temp: 31,
      materials: [{ id: 0, type: 'PLA' }],
    }
    socket.fire('message', {
      cfsConnect: 1,
      boxsInfo: { materialBoxs: [first, second] },
    })
    socket.fire('message', { nozzleTemp: 30, boxsInfo: { name: 'CFS' } })
    expect(store.cfsUnits.map((unit) => unit.id)).toEqual([1, 3])
    expect(
      store.cfsUnits.map((unit) => [unit.humidity, unit.temperature]),
    ).toEqual([
      [28, null],
      [null, 31],
    ])
    socket.fire('message', { boxsInfo: { materialBoxs: [second] } })
    expect(store.cfsSlots.map((slot) => slot.boxId)).toEqual([3])
    socket.fire('message', { boxsInfo: { materialBoxs: [] } })
    expect(store.cfsUnits).toEqual([])
    expect(store.cfsSlots).toEqual([])
  })
  it('drops disconnected units immediately and never resurrects their cached mapping on reconnect', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const { usePrinterStore } = await import('@/stores/printer')
    const client = usePrinterWs(),
      store = usePrinterStore()
    client.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    const boxes = [
      { id: 1, type: 0, materials: [{ id: 0, type: 'PETG' }] },
      { id: 0, type: 1, materials: [{ id: 0, type: 'PLA' }] },
    ]
    socket.fire('message', { cfsConnect: 1, boxsInfo: { materialBoxs: boxes } })
    socket.fire('message', { cfsConnect: 0 })
    expect(store.cfsUnits).toEqual([])
    expect(store.spoolSlots).toHaveLength(1)
    socket.fire('message', { boxsInfo: { materialBoxs: boxes } })
    expect(store.cfsUnits).toEqual([])
    socket.fire('message', { cfsConnect: 1 })
    expect(store.cfsUnits).toEqual([])
    socket.fire('message', { boxsInfo: { materialBoxs: boxes } })
    expect(store.cfsUnits).toHaveLength(1)
    socket.fire('close')
    expect(store.cfsSlots).toEqual([])
    expect(store.cfsUnits).toEqual([])
    expect(store.spoolSlots).toEqual([])
    socket.fire('message', { cfsConnect: 1, boxsInfo: { materialBoxs: boxes } })
    expect(store.cfsUnits).toEqual([])
  })
  it('does not start if a mapped unit disconnects after colorMatch was sent', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const client = usePrinterWs()
    client.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    socket.fire('message', {
      cfsConnect: 1,
      boxsInfo: {
        materialBoxs: [
          { id: 3, type: 0, materials: [{ id: 0, type: 'PETG' }] },
        ],
      },
    })
    socket.sent = []
    const original = socket.send.bind(socket)
    vi.spyOn(socket, 'send').mockImplementation((data) => {
      original(data)
      if (JSON.parse(data).params.colorMatch)
        socket.fire('message', { cfsConnect: 0 })
    })
    await expect(
      client.startPrint('widget.gcode', {
        source: 'cfs',
        mappings: [
          {
            id: 'T1A',
            type: 'PETG',
            color: '#ffffff',
            boxId: 3,
            materialId: 0,
          },
        ],
      }),
    ).rejects.toThrow('no longer available')
    expect(
      socket.sent.some(
        (message) =>
          (message.params as Record<string, unknown>).multiColorPrint,
      ),
    ).toBe(false)
  })
})

describe('belt calibration live interlock', () => {
  const idleCool = {
    deviceState: 0,
    nozzleTemp: '24.5',
    bedTemp0: 26,
    boxTemp: 27,
    targetNozzleTemp: 0,
    targetBedTemp0: 0,
    targetBoxTemp: '0',
  }

  async function open() {
    const { usePrinterWs } = await import('./usePrinterWs')
    const printer = usePrinterWs()
    printer.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    return { printer, socket }
  }

  it('requires complete, fresh real telemetry and refuses stale, hot, or malformed data', async () => {
    const { printer, socket } = await open()
    expect(printer.canStartBeltCalibration()).toBe(false)
    socket.fire('message', { deviceState: 0 })
    expect(printer.canStartBeltCalibration()).toBe(false)
    socket.fire('message', idleCool)
    expect(printer.canStartBeltCalibration()).toBe(true)
    socket.fire('message', { targetBoxTemp: '0bad' })
    expect(printer.canStartBeltCalibration()).toBe(false)
    socket.fire('message', { ...idleCool, nozzleTemp: 45 })
    expect(printer.canStartBeltCalibration()).toBe(false)
    socket.fire('message', idleCool)
    vi.advanceTimersByTime(10_001)
    expect(() => printer.acquireBeltCalibration()).toThrow('fresh idle')
  })

  it('owns same-tab writes, invalidates on active jobs, and never resurrects an old lease', async () => {
    const { printer, socket } = await open()
    socket.fire('message', idleCool)
    const lease = printer.acquireBeltCalibration()
    expect(printer.beltCalibrationActive.value).toBe(true)
    await expect(printer.sendGcodeCommand('G28')).rejects.toThrow('calibration')
    await expect(printer.startPrint('part.gcode', { source: 'spool' })).rejects.toThrow('calibration')
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).resolves.toBe('websocket')
    socket.fire('message', { deviceState: 1 })
    expect(printer.beltCalibrationActive.value).toBe(false)
    socket.fire('message', idleCool)
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).rejects.toThrow('stopped')
    const second = printer.acquireBeltCalibration()
    lease.release()
    expect(printer.beltCalibrationActive.value).toBe(true)
    await printer.emergencyStop()
    expect(socket.sent.at(-1)).toEqual({ method: 'set', params: { gcodeCmd: 'M112' } })
    await expect(second.send('BELT_MDL_INFO MDL_NAME=mdlx')).rejects.toThrow('stopped')
  })

  it('requires new status after reconnect and invalidates the prior connection owner', async () => {
    const { printer, socket } = await open()
    socket.fire('message', idleCool)
    const lease = printer.acquireBeltCalibration()
    socket.readyState = 3
    socket.fire('close')
    vi.advanceTimersByTime(2000)
    const replacement = FakeSocket.instance
    expect(replacement).not.toBe(socket)
    replacement.readyState = 1
    replacement.fire('open')
    expect(printer.canStartBeltCalibration()).toBe(false)
    replacement.fire('message', idleCool)
    expect(printer.canStartBeltCalibration()).toBe(true)
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).rejects.toThrow('stopped')
  })
})
