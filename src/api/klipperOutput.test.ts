import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listenForKlipperOutput } from './klipperOutput'

const settings = vi.hoisted(() => ({ preview: false }))
vi.mock('@/utils/env', () => ({ getMoonrakerOutputUrl: () => 'ws://printer.test:7125/websocket' }))
vi.mock('@/utils/preview', () => ({ get isPreview() { return settings.preview } }))

class SocketProbe {
  static sockets: SocketProbe[] = []
  listeners = new Map<string, (event: { data?: string }) => void>()
  close = vi.fn(() => this.fire('close'))
  send = vi.fn()

  readonly url: string

  constructor(url: string) {
    this.url = url
    SocketProbe.sockets.push(this)
  }
  addEventListener(type: string, fn: (event: { data?: string }) => void) { this.listeners.set(type, fn) }
  fire(type: string, data?: string) { this.listeners.get(type)?.({ data }) }
  message(payload: unknown) { this.fire('message', JSON.stringify(payload)) }
}

beforeEach(() => {
  SocketProbe.sockets = []
  settings.preview = false
  vi.stubGlobal('WebSocket', SocketProbe)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('read-only Klipper output', () => {
  it('displays only G-code response broadcasts and never sends anything', () => {
    const receive = vi.fn(), status = vi.fn()
    const stop = listenForKlipperOutput(receive, status)
    const s = SocketProbe.sockets[0]!
    expect(s.url).toBe('ws://printer.test:7125/websocket')
    s.fire('open')
    s.fire('message', 'invalid JSON')
    s.message({ method: 'notify_status_update', params: ['not console output'] })
    s.message({ method: 'notify_gcode_response', params: [{ bogus: true }] })
    s.message({ method: 'notify_gcode_response', params: ['\n  '] })
    s.message({ method: 'notify_gcode_response', params: ['// Klipper state: Ready'] })
    expect(status).toHaveBeenCalledExactlyOnceWith(true)
    expect(receive).toHaveBeenCalledExactlyOnceWith('// Klipper state: Ready')
    expect(s.send).not.toHaveBeenCalled()
    stop()
  })

  it('reconnects once, ignores stale output, and stops when the console leaves', () => {
    const receive = vi.fn(), status = vi.fn()
    const stop = listenForKlipperOutput(receive, status)
    const first = SocketProbe.sockets[0]!
    first.fire('open')
    first.fire('close')
    vi.advanceTimersByTime(999)
    expect(SocketProbe.sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    const second = SocketProbe.sockets[1]!
    second.fire('open')
    first.message({ method: 'notify_gcode_response', params: ['stale'] })
    second.message({ method: 'notify_gcode_response', params: ['live'] })
    expect(receive).toHaveBeenCalledExactlyOnceWith('live')
    expect(status.mock.calls).toEqual([[true], [false], [true]])
    stop()
    expect(second.close).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(120_000)
    expect(SocketProbe.sockets).toHaveLength(2)
  })

  it('does not open sockets in preview', () => {
    settings.preview = true
    listenForKlipperOutput(vi.fn(), vi.fn())()
    expect(SocketProbe.sockets).toEqual([])
  })
})
