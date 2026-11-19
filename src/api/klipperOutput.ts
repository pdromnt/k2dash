import { getMoonrakerOutputUrl } from '@/utils/env'
import { isPreview } from '@/utils/preview'

/** Listen to Moonraker broadcasts. This connection never sends RPCs or G-code. */
export function listenForKlipperOutput(
  onResponse: (text: string) => void,
  onConnection: (connected: boolean) => void,
): () => void {
  if (isPreview) return () => {}
  let stopped = false
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 1_000
  let connected: boolean | undefined

  function announce(value: boolean) {
    if (connected === value) return
    connected = value
    onConnection(value)
  }

  function reconnect() {
    if (stopped) return
    announce(false)
    retry = setTimeout(connect, retryDelay)
    retryDelay = Math.min(2 * retryDelay, 15_000)
  }

  function connect() {
    if (stopped) return
    let current: WebSocket
    try {
      current = new WebSocket(getMoonrakerOutputUrl())
    } catch {
      reconnect()
      return
    }
    socket = current
    current.addEventListener('open', () => {
      if (socket !== current) return
      retryDelay = 1_000
      announce(true)
    })
    current.addEventListener('message', (event) => {
      if (socket !== current || typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data)
        if (message?.method === 'notify_gcode_response' && Array.isArray(message.params) &&
            typeof message.params[0] === 'string' && message.params[0].trim()) {
          onResponse(message.params[0])
        }
      } catch { /* Ignore malformed or unrelated notifications. */ }
    })
    current.addEventListener('close', () => {
      if (socket !== current) return
      socket = undefined
      reconnect()
    })
  }

  connect()
  return () => {
    stopped = true
    clearTimeout(retry)
    const current = socket
    socket = undefined
    current?.close()
  }
}
