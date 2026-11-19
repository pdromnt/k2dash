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
  it('uses the native model ID and preserves it across partial status frames', async () => {
    const { usePrinterWs } = await import('./usePrinterWs')
    const { usePrinterStore } = await import('@/stores/printer')
    usePrinterWs().connect()
    const store = usePrinterStore()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    expect(store.modelName).toBe('Printer')
    socket.fire('message', { model: ' f008 ' })
    socket.fire('message', { nozzleTemp: 30 })
    socket.fire('message', { model: null })
    expect(store.modelName).toBe('K2 Plus')
    socket.fire('message', { model: 'F012' })
    expect(store.modelName).toBe('K2 Pro')
    socket.fire('message', { model: 'F021' })
    expect(store.modelName).toBe('K2')
    socket.fire('message', { model: 'F999' })
    expect(store.modelName).toBe('Printer')
    expect(fetch).not.toHaveBeenCalled()
  })

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
    model: 'F008',
    deviceState: 0,
    nozzleTemp: '24.5',
    bedTemp0: 26,
    boxTemp: 27,
    targetNozzleTemp: 0,
    targetBedTemp0: 0,
    targetBoxTemp: '0',
  }
  const safetyStatus = {
    webhooks: { state: 'ready' },
    print_stats: { state: 'standby' },
    virtual_sdcard: { is_active: false },
    extruder: { temperature: 25, target: 0 },
    heater_bed: { temperature: 26, target: 0 },
    'heater_generic chamber_heater': { temperature: 27, target: 0 },
  }

  function mockSafetyStatus(overrides = {}) {
    vi.mocked(fetch).mockImplementation(async () => Response.json({
      result: { status: { ...safetyStatus, ...overrides } },
    }))
  }

  async function open() {
    mockSafetyStatus()
    const { usePrinterWs } = await import('./usePrinterWs')
    const printer = usePrinterWs()
    printer.connect()
    const socket = FakeSocket.instance
    socket.readyState = 1
    socket.fire('open')
    const monitor = printer.monitorBeltCalibrationStatus()
    await vi.advanceTimersByTimeAsync(0)
    return { printer, socket, monitor }
  }

  it('allows heater shutdown while hot but sends home and park only when cold and idle', async () => {
    const { printer, socket, monitor } = await open()
    socket.fire('message', { ...idleCool, nozzleTemp: 70, targetNozzleTemp: 150 })
    mockSafetyStatus({ extruder: { temperature: 70, target: 150 } })
    await monitor.refresh()
    socket.sent = []
    expect(printer.canTurnOffBeltHeaters()).toBe(true)
    await expect(printer.prepareBeltCalibration('home-and-park')).rejects.toThrow('cool')
    expect(socket.sent).toEqual([])
    await printer.prepareBeltCalibration('heaters-off')
    socket.fire('message', idleCool)
    mockSafetyStatus()
    await monitor.refresh()
    await printer.prepareBeltCalibration('home-and-park')
    expect(socket.sent).toEqual([
      { method: 'set', params: { gcodeCmd: 'M104 S0\nM140 S0\nM141 S0' } },
      { method: 'set', params: { gcodeCmd: 'G28\nM400\nBOX_MOVE_TO_SAFE_POS\nM400' } },
    ])
    expect(vi.mocked(fetch).mock.calls.every(([url, options]) =>
      String(url).includes('/printer/objects/query?') && options?.method === undefined,
    )).toBe(true)
  })

  it('refuses preparation while printing, with stale telemetry, or during a live calibration', async () => {
    const { printer, socket, monitor } = await open()
    socket.fire('message', { ...idleCool, deviceState: 1 })
    socket.sent = []
    await expect(printer.prepareBeltCalibration('heaters-off')).rejects.toThrow('idle')
    socket.fire('message', idleCool)
    vi.setSystemTime(Date.now() + 10_001)
    await expect(printer.prepareBeltCalibration('home-and-park')).rejects.toThrow('idle')
    socket.fire('message', idleCool)
    await monitor.refresh()
    const lease = printer.acquireBeltCalibration()
    await expect(printer.prepareBeltCalibration('heaters-off')).rejects.toThrow('calibration')
    lease.release()
    expect(socket.sent).toEqual([])
  })

  it.each(['', 'F021', 'F012', 'F999'])('rejects belt calibration unless a K2 Plus is detected (%s)', async (model) => {
    const { printer, socket } = await open()
    socket.fire('message', { ...idleCool, model })
    expect(printer.canStartBeltCalibration()).toBe(false)
    expect(() => printer.acquireBeltCalibration()).toThrow('requires a detected K2 Plus')
  })

  it('invalidates a calibration lease if the printer reports a different model', async () => {
    const { printer, socket } = await open()
    socket.fire('message', idleCool)
    const lease = printer.acquireBeltCalibration()
    socket.fire('message', { model: 'F012' })
    expect(printer.beltCalibrationActive.value).toBe(false)
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).rejects.toThrow('stopped')
  })

  it('requires a complete, fresh safety snapshot and refuses stale, hot, or malformed measurements', async () => {
    const { printer, socket, monitor } = await open()
    expect(printer.canStartBeltCalibration()).toBe(false)
    socket.fire('message', { model: 'F008', deviceState: 0 })
    expect(printer.canStartBeltCalibration()).toBe(true)
    socket.fire('message', { targetBoxTemp: '0bad' })
    expect(printer.canStartBeltCalibration()).toBe(false)
    mockSafetyStatus({ 'heater_generic chamber_heater': undefined })
    await monitor.refresh()
    expect(printer.canStartBeltCalibration()).toBe(false)
    mockSafetyStatus()
    await monitor.refresh()
    expect(printer.canStartBeltCalibration()).toBe(true)
    socket.fire('message', { ...idleCool, nozzleTemp: 45 })
    expect(printer.canStartBeltCalibration()).toBe(false)
    await monitor.refresh()
    vi.setSystemTime(Date.now() + 5_001)
    expect(() => printer.acquireBeltCalibration()).toThrow('fresh idle')
  })

  it('stays available when Creality only sends temperature deltas for an unchanged idle printer', async () => {
    const { printer, socket, monitor } = await open()
    socket.fire('message', idleCool)
    await vi.advanceTimersByTimeAsync(12_000)
    socket.fire('message', { nozzleTemp: '25.2', bedTemp0: '26.4' })
    expect(printer.canTurnOffBeltHeaters()).toBe(true)
    expect(printer.canStartBeltCalibration()).toBe(true)
    const lease = printer.acquireBeltCalibration()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Disconnected'))
    await monitor.refresh()
    expect(printer.canTurnOffBeltHeaters()).toBe(false)
    expect(printer.beltCalibrationActive.value).toBe(false)
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).rejects.toThrow('stopped')
    monitor.stop()
    vi.mocked(fetch).mockClear()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses preparation if Moonraker reports an active job despite idle Creality status', async () => {
    const { printer, socket, monitor } = await open()
    socket.fire('message', idleCool)
    mockSafetyStatus({ virtual_sdcard: { is_active: true } })
    await monitor.refresh()
    expect(printer.canTurnOffBeltHeaters()).toBe(false)
    await expect(printer.prepareBeltCalibration('heaters-off')).rejects.toThrow('idle')
    expect(socket.sent.some((msg) => msg.method === 'set')).toBe(false)
  })

  it('does not restore a cool state from a snapshot requested before an unsafe native update', async () => {
    const { printer, socket, monitor } = await open()
    socket.fire('message', idleCool)
    let complete!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
    const refresh = monitor.refresh()
    socket.fire('message', { targetBedTemp0: 60 })
    complete(Response.json({ result: { status: safetyStatus } }))
    await refresh
    expect(printer.canTurnOffBeltHeaters()).toBe(true)
    expect(printer.canStartBeltCalibration()).toBe(false)
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
    const { printer, socket, monitor } = await open()
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
    const { model, ...statusOnly } = idleCool
    replacement.fire('message', statusOnly)
    expect(printer.canStartBeltCalibration()).toBe(false)
    replacement.fire('message', { model })
    expect(printer.canStartBeltCalibration()).toBe(false)
    await monitor.refresh()
    expect(printer.canStartBeltCalibration()).toBe(true)
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).rejects.toThrow('stopped')
  })

  it('keeps the command lock through a disconnect only between steps and requires fresh telemetry', async () => {
    const { printer, socket, monitor } = await open()
    socket.fire('message', idleCool)
    const lease = printer.acquireBeltCalibration()
    lease.waitForNextStep()
    socket.readyState = 3
    socket.fire('close')
    expect(printer.beltCalibrationActive.value).toBe(true)
    expect(lease.beginStep()).toBe(false)
    await expect(printer.sendGcodeCommand('G28')).rejects.toThrow('calibration')
    vi.advanceTimersByTime(2000)
    const replacement = FakeSocket.instance
    replacement.readyState = 1
    replacement.fire('open')
    replacement.fire('message', idleCool)
    expect(lease.beginStep()).toBe(false)
    await monitor.refresh(true)
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).rejects.toThrow('not safe')
    expect(lease.beginStep()).toBe(true)
    await expect(lease.send('BELT_MDL_INFO MDL_NAME=mdlx')).resolves.toBe('websocket')
  })

  it('invalidates a waiting session on an unsafe snapshot, not on a missing snapshot', async () => {
    const { printer, socket, monitor } = await open()
    socket.fire('message', idleCool)
    const lease = printer.acquireBeltCalibration()
    lease.waitForNextStep()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Throttled'))
    await monitor.refresh(true)
    expect(printer.beltCalibrationActive.value).toBe(true)
    expect(lease.beginStep()).toBe(false)
    mockSafetyStatus({ extruder: { temperature: 50, target: 0 } })
    await monitor.refresh()
    expect(printer.beltCalibrationActive.value).toBe(false)
    expect(lease.beginStep()).toBe(false)
  })
})
