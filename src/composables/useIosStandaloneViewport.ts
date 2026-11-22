import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

export function useIosStandaloneViewport() {
  const bounds = shallowRef<{ height: number; top: number }>()
  let stop: (() => void) | undefined

  onMounted(() => {
    // Leave normal browser tabs and non-iOS installations on their CSS sizing.
    if ((window.navigator as Navigator & { standalone?: boolean }).standalone !== true) return

    const viewport = window.visualViewport
    function sync() {
      if (viewport && viewport.scale !== 1) return
      const height = viewport?.height ?? window.innerHeight
      const offset = viewport?.offsetTop ?? 0
      if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(offset)) return

      // Don't pull the header behind the status bar during rubber-band scrolling.
      const top = Math.max(0, offset)
      if (bounds.value?.height !== height || bounds.value.top !== top) bounds.value = { height, top }
    }

    sync()
    viewport?.addEventListener('resize', sync)
    viewport?.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('pageshow', sync)
    stop = () => {
      viewport?.removeEventListener('resize', sync)
      viewport?.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('pageshow', sync)
    }
  })

  onBeforeUnmount(() => stop?.())
  return bounds
}
