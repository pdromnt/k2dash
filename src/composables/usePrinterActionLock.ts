import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterWs } from './usePrinterWs'

/** Shared lock for disruptive actions. Fans, lights, and emergency stop have their own rules. */
export function usePrinterActionLock() {
  const printer = usePrinterStore()
  const { printStarting, beltCalibrationActive } = usePrinterWs()

  return computed(() => {
    if (!printer.connected) return 'Printer disconnected'
    if (printer.restartPending) return 'Restart requested'
    if (beltCalibrationActive.value) return 'Belt calibration in progress'
    if (printStarting.value) return 'Print is starting'
    if (printer.jobActive) return 'Locked while printing'
    if (printer.state === 'unknown') return 'Waiting for printer status'
    return ''
  })
}
