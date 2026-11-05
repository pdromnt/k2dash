import { watch } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { HOST } from '@/utils/env'
import { isPreview } from '@/utils/preview'

// Native telemetry owns all status. This composable only manages the current
// print image; keeping it at app scope makes navigation independent of telemetry.
export function usePrinter() {
  const store = usePrinterStore()
  watch(
    () => [store.state, store.printFilename],
    () => {
      if (isPreview) return
      store.thumbnailUrl =
        store.isPrinting || store.isPaused
          ? `http://${HOST}:80/downloads/original/current_print_image.png?cb=${encodeURIComponent(store.printFilename || store.state)}`
          : ''
    },
    { immediate: true },
  )
}
