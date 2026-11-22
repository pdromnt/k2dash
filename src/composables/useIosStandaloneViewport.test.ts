// @vitest-environment happy-dom
import { createApp } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIosStandaloneViewport } from './useIosStandaloneViewport'

function mockViewport(height: number) {
  return Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 })
}

let unmount: (() => void) | undefined

function mountViewport(standalone: boolean | undefined, viewport: ReturnType<typeof mockViewport> | null) {
  vi.stubGlobal('navigator', { standalone })
  vi.stubGlobal('visualViewport', viewport)
  let bounds!: ReturnType<typeof useIosStandaloneViewport>
  const app = createApp({
    setup() {
      bounds = useIosStandaloneViewport()
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  unmount = () => app.unmount()
  return bounds
}

afterEach(() => {
  unmount?.()
  unmount = undefined
  vi.unstubAllGlobals()
})

describe('installed iOS viewport bounds', () => {
  it.each([false, undefined])('leaves browser sizing alone when standalone is %s', (standalone) => {
    const viewport = mockViewport(744)
    const bounds = mountViewport(standalone, viewport)
    viewport.dispatchEvent(new Event('resize'))
    expect(bounds.value).toBeUndefined()
  })

  it('tracks the visible viewport and ignores pinch zoom and invalid sizes', () => {
    const viewport = mockViewport(744)
    const bounds = mountViewport(true, viewport)
    expect(bounds.value).toEqual({ height: 744, top: 0 })

    viewport.height = 540
    viewport.dispatchEvent(new Event('resize'))
    expect(bounds.value?.height).toBe(540)

    viewport.height = 270
    viewport.scale = 2
    viewport.dispatchEvent(new Event('resize'))
    expect(bounds.value?.height).toBe(540)

    viewport.height = 0
    viewport.scale = 1
    viewport.dispatchEvent(new Event('resize'))
    expect(bounds.value?.height).toBe(540)

    viewport.height = 744
    window.dispatchEvent(new Event('pageshow'))
    expect(bounds.value?.height).toBe(744)
  })

  it('updates the top edge on viewport scroll without lifting it above the page', () => {
    const viewport = mockViewport(744)
    const bounds = mountViewport(true, viewport)

    viewport.offsetTop = 29
    viewport.dispatchEvent(new Event('scroll'))
    expect(bounds.value).toEqual({ height: 744, top: 29 })

    viewport.offsetTop = -12
    viewport.dispatchEvent(new Event('scroll'))
    expect(bounds.value).toEqual({ height: 744, top: 0 })
  })

  it('falls back to the window height without VisualViewport', () => {
    const bounds = mountViewport(true, null)
    expect(bounds.value).toEqual({ height: window.innerHeight, top: 0 })
  })

  it('removes viewport listeners when the shell unmounts', () => {
    const viewport = mockViewport(744)
    const bounds = mountViewport(true, viewport)
    unmount?.()
    unmount = undefined
    viewport.height = 520
    viewport.offsetTop = 27
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('pageshow'))
    expect(bounds.value).toEqual({ height: 744, top: 0 })
  })
})
