// @vitest-environment happy-dom
import { createApp, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfigFile, getConfigFiles, saveConfigFile } from '@/api/moonraker'
import { usePrinterStore } from '@/stores/printer'
import ConfigModal from './ConfigModal.vue'

const { created, destroyed } = vi.hoisted(() => ({ created: vi.fn(), destroyed: vi.fn() }))
vi.mock('@/api/moonraker', () => ({
  getBeltSafetyStatus: vi.fn(),
  getConfigFile: vi.fn(),
  getConfigFiles: vi.fn(),
  saveConfigFile: vi.fn(),
}))
vi.mock('codemirror', () => ({
  basicSetup: [],
  EditorView: class {
    static updateListener = { of: () => [] }
    static theme = () => []
    constructor({ state }: { state: { doc: { toString(): string } } }) {
      created(state.doc.toString())
    }
    destroy() { destroyed() }
  },
}))

let app: App

async function settle() {
  await Promise.resolve()
  await nextTick()
  await nextTick()
}

async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.getAttribute('aria-label') === label || node.textContent?.trim().startsWith(label),
  )
  expect(button, `button ${label}`).toBeDefined()
  button!.click()
  await settle()
}

async function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await settle()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getConfigFiles).mockResolvedValue([
    { path: 'printer.cfg', modified: 0, size: 20, permissions: 'rw' },
    { path: 'macros.cfg', modified: 0, size: 20, permissions: 'rw' },
  ])
  const container = document.createElement('div')
  document.body.append(container)
  const pinia = createPinia()
  usePrinterStore(pinia).$patch({ state: 'idle', connected: true })
  app = createApp(ConfigModal)
  app.use(pinia).mount(container)
})

afterEach(() => {
  app.unmount()
  document.body.replaceChildren()
})

describe('config editor lifecycle', () => {
  it('destroys the editor on Escape and creates a fresh one on reopen', async () => {
    vi.mocked(getConfigFile).mockResolvedValueOnce('# first edit').mockResolvedValueOnce('# next edit')
    await click('Config')
    await click('printer.cfg')
    expect(created.mock.calls).toEqual([['# first edit']])

    await escape()
    expect(destroyed).toHaveBeenCalledTimes(1)
    await click('Config')
    await click('printer.cfg')
    expect(created.mock.calls).toEqual([['# first edit'], ['# next edit']])
    expect(saveConfigFile).not.toHaveBeenCalled()
  })

  it('cannot mount the old file if its read finishes after opening a different file', async () => {
    let finishOld!: (text: string) => void
    vi.mocked(getConfigFile)
      .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce('# current')
    await click('Config')
    await click('printer.cfg')
    expect(document.body.textContent).toContain('Loading config')
    await escape()
    await click('Config')
    await click('macros.cfg')
    finishOld('# stale')
    await settle()
    expect(getConfigFile).toHaveBeenNthCalledWith(1, 'printer.cfg')
    expect(getConfigFile).toHaveBeenNthCalledWith(2, 'macros.cfg')
    expect(created.mock.calls).toEqual([['# current']])
    expect(saveConfigFile).not.toHaveBeenCalled()
  })
})
