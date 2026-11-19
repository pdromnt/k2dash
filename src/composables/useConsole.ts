import { ref, onUnmounted, watch } from 'vue'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { errMsg } from '@/utils/format'
import { getGcodeHelp } from '@/api/moonraker'
import { listenForKlipperOutput } from '@/api/klipperOutput'

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
  let stopOutput: (() => void) | null = null
  let receivingKlipperOutput = false
  let readingHelp = false

  function addMessage(type: ConsoleMessage['type'], text: string) {
    messages.value.push({ id: msgId++, type, text, timestamp: Date.now() })
    if (messages.value.length > MAX_MESSAGES) {
      messages.value = messages.value.slice(-TRIM_TO)
    }
  }

  function connect() {
    if (unsubscribe) return // already connected

    // Some Creality firmwares also echo replies. Use those only until the
    // Moonraker feed is connected, so mirrored replies don't print twice.
    unsubscribe = printerWs.onMessage((msg) => {
      if (receivingKlipperOutput) return
      const reply = msg.gcodeRes ?? msg.gcode_response
      if (typeof reply === 'string' && reply.trim()) addMessage('recv', reply)
      else if (Array.isArray(reply)) {
        const text = reply.filter((line): line is string => typeof line === 'string').join('\n')
        if (text.trim()) addMessage('recv', text)
      }
    })
    stopOutput = listenForKlipperOutput(
      (text) => addMessage('recv', text),
      (online) => {
        receivingKlipperOutput = online
        addMessage('system', online
          ? 'Listening for live Klipper output.'
          : 'Live Klipper output unavailable. Reconnecting; commands still use Creality’s connection.')
      },
    )
  }

  function disconnect() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
    stopOutput?.()
    stopOutput = null
    receivingKlipperOutput = false
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

    // Creality can run HELP without forwarding Klipper's output. Read the
    // documented command list instead; no G-code is executed for this lookup.
    if (command.toUpperCase() === 'HELP') {
      if (readingHelp) return
      readingHelp = true
      addMessage('system', 'Reading Klipper command list…')
      try {
        const help = await getGcodeHelp()
        const lines = Object.entries(help).sort(([a], [b]) => a.localeCompare(b))
          .map(([name, description]) => `  ${name}: ${description}`)
        addMessage('recv', ['Available extended commands:', ...lines].join('\n'))
      } catch (error) {
        const detail = errMsg(error)
        addMessage('system', `Could not read the Klipper command list. Check Moonraker and try HELP again.${detail ? ` (${detail})` : ''}`)
      } finally {
        readingHelp = false
      }
      return
    }

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
