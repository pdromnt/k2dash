import type { CrealityMessage } from './crealityProtocol'

type Incoming = Record<string, unknown>
type MessagePredicate = (message: Incoming) => boolean
type Subscriber = (message: Incoming) => void

interface PendingResponse {
  predicate: MessagePredicate
  resolve: (message: Incoming) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface SocketOptions {
  url: () => string
  onOpen: () => void
  onLost: () => void
  receive: Subscriber
}

/** Owns the connection, pending replies and reconnect timer, without printer state. */
export function createCrealitySocket({ url, onOpen, onLost, receive }: SocketOptions) {
  let current: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let failedAttempts = 0
  const pending = new Set<PendingResponse>()
  const subscribers = new Set<Subscriber>()

  const ready = () => current?.readyState === WebSocket.OPEN

  function send(message: CrealityMessage): boolean {
    if (!current || !ready()) return false
    try {
      current.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  function request(message: CrealityMessage, predicate: MessagePredicate, timeoutMs = 5000) {
    return new Promise<Incoming>((resolve, reject) => {
      const response: PendingResponse = {
        predicate, resolve, reject,
        timer: setTimeout(() => {
          pending.delete(response)
          reject(new Error('Printer response timed out'))
        }, timeoutMs),
      }
      pending.add(response)
      if (!send(message)) {
        clearTimeout(response.timer)
        pending.delete(response)
        reject(new Error('Printer WebSocket not connected'))
      }
    })
  }

  function disconnect() {
    current = null
    for (const response of pending) {
      clearTimeout(response.timer)
      response.reject(new Error('Printer WebSocket disconnected'))
    }
    pending.clear()
    onLost()
    if (retry) return
    const delay = Math.min(1_000 * 2 ** ++failedAttempts, 30_000)
    retry = setTimeout(() => {
      retry = undefined
      connect()
    }, delay)
  }

  function connect() {
    if (current) return
    clearTimeout(retry)
    retry = undefined
    let socket: WebSocket
    try {
      socket = new WebSocket(url())
    } catch {
      disconnect()
      return
    }
    current = socket

    socket.addEventListener('open', () => {
      if (current !== socket) return
      failedAttempts = 0
      onOpen()
    })
    socket.addEventListener('message', (event) => {
      if (current !== socket) return
      try {
        const message: unknown = JSON.parse(event.data)
        if (!message || typeof message !== 'object' || Array.isArray(message)) return
        const frame = message as Incoming
        receive(frame)
        for (const response of [...pending]) {
          if (!response.predicate(frame)) continue
          clearTimeout(response.timer)
          pending.delete(response)
          response.resolve(frame)
        }
        for (const subscriber of subscribers) subscriber(frame)
      } catch {
        // Malformed frames must not break the socket or its polling.
      }
    })
    socket.addEventListener('close', () => {
      if (current === socket) disconnect()
    })
    socket.addEventListener('error', () => {
      if (current !== socket) return
      disconnect()
      socket.close()
    })
  }

  function onMessage(subscriber: Subscriber): () => void {
    subscribers.add(subscriber)
    return () => subscribers.delete(subscriber)
  }

  return { connect, ready, send, request, onMessage, get current() { return current } }
}
