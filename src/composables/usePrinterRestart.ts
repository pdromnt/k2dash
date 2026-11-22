import { computed, readonly, ref, toRef, watch } from 'vue'
import { getKlipperState, restartKlipper } from '@/api/moonraker'
import { usePrinterActionLock } from './usePrinterActionLock'
import { usePrinterStore } from '@/stores/printer'
import { useBannerStore } from '@/stores/banner'
import { useToastStore } from '@/stores/toast'
import { isPreview } from '@/utils/preview'
import { errMsg } from '@/utils/format'

const notice = ref<{ state: 'restarting' | 'unconfirmed'; detail?: string } | null>(null)
const restartErrorSeen = ref(false)
const RESTART_WINDOW_MS = 30_000
const XS3000 = 3000

export const restartNotice = readonly(notice)
export const isRestarting = computed(() => notice.value?.state === 'restarting')
export const showXs3000AsRestart = computed(() => isRestarting.value && restartErrorSeen.value)

export function dismissRestartNotice() {
  if (notice.value?.state === 'unconfirmed') notice.value = null
}

export function usePrinterRestart() {
  const printer = usePrinterStore()
  const pending = toRef(printer, 'restartPending')
  const lock = usePrinterActionLock()
  const banner = useBannerStore()
  const toast = useToastStore()
  const blocked = computed(() => isPreview || Boolean(lock.value))

  async function restart(kind: 'host' | 'firmware') {
    const prefix = kind === 'host' ? 'Config saved, but restart' : 'Firmware restart'
    if (blocked.value) {
      banner.show(`${prefix} skipped`, 'Check that the printer is connected, no job is running or starting, and calibration is closed.')
      return
    }
    pending.value = true
    notice.value = { state: 'restarting' }
    restartErrorSeen.value = false
    const deadline = Date.now() + RESTART_WINDOW_MS
    let underway = false
    let requestError: string | undefined
    const stopWatching = watch(() => printer.errorCode, (code) => {
      if (code === XS3000) {
        restartErrorSeen.value = true
        underway = true
      }
    }, { flush: 'sync' })
    const request = restartKlipper(kind).catch((error: unknown) => {
      requestError = errMsg(error)
    })
    try {
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1_000, deadline - Date.now())))
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        // An unreachable endpoint alone doesn't prove a restart. Require either
        // Klipper startup or a new XS3000, followed by a fresh Ready response.
        const state = await getKlipperState(Math.min(2_000, remaining)).catch(() => undefined)
        if (state === 'startup') underway = true
        if (Date.now() < deadline && underway && state === 'ready' &&
            printer.connected && !printer.isError && printer.errorCode !== XS3000) {
          notice.value = null
          toast.show('Klipper is ready.')
          return
        }
      }
      notice.value = { state: 'unconfirmed', detail: requestError }
    } finally {
      stopWatching()
      restartErrorSeen.value = false
      // Keep duplicate requests blocked even if the status window ends while
      // Moonraker is still answering the original POST.
      await request
      pending.value = false
    }
  }

  return { blocked, pending, restart }
}
