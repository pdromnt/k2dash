import { ref, onUnmounted, watch } from 'vue'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { errMsg } from '@/utils/format'

interface ConsoleMessage {
  id: number
  type: 'send' | 'recv' | 'system'
  text: string
  timestamp: number
}

const MAX_MESSAGES = 500
const TRIM_TO = 300
const READY_TEXT = 'Console Status: Ready.'

export function useConsole() {
  const banner = useBannerStore()
  const toast = useToastStore()
  const printerWs = usePrinterWs()
  const messages = ref<ConsoleMessage[]>([])
  const connected = ref(false)
  let msgId = 0
  let unsubscribe: (() => void) | null = null

  function addMessage(type: ConsoleMessage['type'], text: string) {
    messages.value.push({ id: msgId++, type, text, timestamp: Date.now() })
    if (messages.value.length > MAX_MESSAGES) {
      messages.value = messages.value.slice(-TRIM_TO)
    }
  }

  function connect() {
    if (unsubscribe) return // already connected

    // Subscribe through the WS composable's pub/sub so we don't open a
    // second message listener on the same socket.
    unsubscribe = printerWs.onMessage((msg) => {
      if (msg.gcodeRes) {
        addMessage('recv', typeof msg.gcodeRes === 'string' ? msg.gcodeRes : JSON.stringify(msg.gcodeRes))
      }
      if (msg.gcode_response) {
        addMessage('recv', msg.gcode_response as string)
      }
    })
  }

  function disconnect() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
    connected.value = false
  }

  // Mirror the WS connection state. The socket is opened by usePrinterWs in
  // AppLayout's onMounted, so by the time the console mounts it may not yet
  // be OPEN — we can't just snapshot readyState once. Watch and react.
  watch(printerWs.connected, (isConnected, wasConnected) => {
    connected.value = isConnected
    if (isConnected && !wasConnected) {
      // Only announce on the rising edge, and only once per connection.
      if (!messages.value.some((m) => m.text === READY_TEXT)) {
        addMessage('system', READY_TEXT)
      }
    }
  }, { immediate: true })

  async function sendCommand(cmd: string) {
    const command = cmd.trim()
    if (!command) return
    addMessage('send', command)

    try {
      await printerWs.sendGcodeCommand(command + '\n')
      toast.show(`Sent \u00b7 ${command}`)
    } catch (e) {
      banner.show('Failed to send G-code', errMsg(e))
      addMessage('system', `Error: ${e instanceof Error ? e.message : 'Failed'}`)
    }
  }

  function clear() {
    messages.value = []
  }

  onUnmounted(() => disconnect())

  return { messages, connected, connect, sendCommand, clear }
}
