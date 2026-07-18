import { ref, onUnmounted, shallowRef } from 'vue'
import { getWebcamBaseUrl } from '@/utils/env'

const ICE_GATHER_TIMEOUT_MS = 10000
const SIGNALING_TIMEOUT_MS = 15000

function encodeOffer(sdp: string): string {
  const json = JSON.stringify({ type: 'offer', sdp })
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function decodeAnswer(b64: string): string {
  const decoded = atob(b64.trim())
  try {
    const parsed = JSON.parse(decoded)
    return parsed.sdp || decoded
  } catch {
    return decoded
  }
}

function waitForIceGathering(connection: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (connection.iceGatheringState === 'complete') { resolve(); return }

    const finish = () => {
      clearTimeout(timer)
      connection.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => {
      if (connection.iceGatheringState === 'complete') finish()
    }

    const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS)
    connection.addEventListener('icegatheringstatechange', check)
  })
}

export function useWebcam() {
  const videoRef = shallowRef<HTMLVideoElement | null>(null)
  const connected = ref(false)
  const connecting = ref(false)
  const error = ref<string | null>(null)

  const log = (m: string, ...a: unknown[]) => { if (import.meta.env.DEV) console.log('[Webcam] ' + m, ...a) }
  const logErr = (m: string, ...a: unknown[]) => { if (import.meta.env.DEV) console.error('[Webcam] ' + m, ...a) }

  let pc: RTCPeerConnection | null = null
  let stream: MediaStream | null = null
  let signalingUrl = ''
  let signalingAbort: AbortController | null = null
  let activeAttempt = 0

  function getSignalingUrl(): string {
    return `${getWebcamBaseUrl()}/call/webrtc_local`
  }

  async function connect() {
    if (connecting.value || connected.value) return
    cleanupConnection()
    const attempt = ++activeAttempt
    connecting.value = true
    error.value = null

    signalingUrl = getSignalingUrl()

    try {
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pc = connection
      connection.addTransceiver('video', { direction: 'recvonly' })

      // Log all WebRTC events
      connection.addEventListener('track', (event) => {
        if (attempt !== activeAttempt || pc !== connection) return
        log('Track received:', event.track.kind)
        if (event.track.kind === 'video' && videoRef.value) {
          stream = event.streams[0]
          videoRef.value.srcObject = stream
          connected.value = true
          connecting.value = false
        }
      })

      connection.addEventListener('iceconnectionstatechange', () => {
        if (attempt !== activeAttempt || pc !== connection) return
        const state = connection.iceConnectionState
        log('ICE state:', state)
        if (state === 'connected') {
          connected.value = true
          error.value = null
        } else if (state === 'disconnected') {
          connected.value = false
          error.value = 'Connection lost'
        } else if (state === 'failed') {
          error.value = 'Connection lost'
          cleanupConnection()
        }
      })

      const offer = await connection.createOffer({ offerToReceiveVideo: true })
      await connection.setLocalDescription(offer)
      log('Offer created')

      // Some browsers/printer combinations never emit the final gathering
      // event. Continue with the candidates collected so far after a limit.
      await waitForIceGathering(connection)
      if (attempt !== activeAttempt || pc !== connection) return

      log('Gathering complete, sending offer')
      await sendOffer(connection)

    } catch (e) {
      if (attempt !== activeAttempt) return
      connecting.value = false
      error.value = e instanceof Error ? e.message : 'Failed'
      logErr('Error:', e)
      cleanupConnection()
    }
  }

  async function sendOffer(connection: RTCPeerConnection) {
    if (!connection.localDescription) throw new Error('Webcam offer was not created')
    const body = encodeOffer(connection.localDescription.sdp)
    log('Sending offer,', body.length, 'bytes base64')

    signalingAbort = new AbortController()
    const timeout = setTimeout(() => signalingAbort?.abort(), SIGNALING_TIMEOUT_MS)
    try {
      const resp = await fetch(signalingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        signal: signalingAbort.signal,
      })

      const answerText = await resp.text()
      log('Got answer,', answerText.length, 'bytes, HTTP', resp.status)

      if (!resp.ok || !answerText || answerText === '{}') {
        throw new Error(`Signaling failed (HTTP ${resp.status})`)
      }

      const answerSdp = decodeAnswer(answerText)
      log('Answer SDP:', answerSdp.substring(0, 100) + '...')

      await connection.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: answerSdp })
      )
      log('Remote description set')
    } finally {
      clearTimeout(timeout)
      signalingAbort = null
    }
  }

  function cleanupConnection() {
    signalingAbort?.abort()
    signalingAbort = null
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
    if (pc) { pc.close(); pc = null }
    if (videoRef.value) videoRef.value.srcObject = null
    connected.value = false
    connecting.value = false
  }

  function disconnect() {
    activeAttempt++
    error.value = null
    cleanupConnection()
  }

  onUnmounted(() => disconnect())

  return { videoRef, connected, connecting, error, connect, disconnect }
}
