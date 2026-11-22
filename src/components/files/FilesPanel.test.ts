// @vitest-environment happy-dom
import { createApp, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteFile, getFileList, renameFile } from '@/api/moonraker'
import { resolveConfirmation, resolveTextInput } from '@/composables/useConfirmDialog'
import { usePrinterWs } from '@/composables/usePrinterWs'
import { usePrinterStore } from '@/stores/printer'
import FilesPanel from './FilesPanel.vue'

vi.mock('@/api/moonraker', () => ({
  getBeltSafetyStatus: vi.fn(),
  deleteFile: vi.fn(),
  getFileList: vi.fn(),
  renameFile: vi.fn(),
}))

let app: App
let container: HTMLDivElement
let printer: ReturnType<typeof usePrinterStore>

function button(label: string) {
  const result = [...container.querySelectorAll('button')]
    .find((node) => node.textContent?.trim() === label)
  expect(result, `button ${label}`).toBeDefined()
  return result!
}

beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(getFileList).mockResolvedValue([
    { path: 'test.gcode', modified: 0, permissions: 'rw', size: 42 },
  ])
  const pinia = createPinia()
  printer = usePrinterStore(pinia)
  printer.$patch({ state: 'idle', connected: true })
  usePrinterWs().printStarting.value = false
  container = document.createElement('div')
  document.body.append(container)
  app = createApp(FilesPanel)
  app.use(pinia).mount(container)
  await Promise.resolve()
  await nextTick()
})

afterEach(() => {
  resolveConfirmation(false)
  app.unmount()
  container.remove()
})

describe('G-code mutation lock', () => {
  it('locks all disruptive file actions while Start is awaiting printer status', async () => {
    expect(button('Delete').disabled).toBe(false)
    usePrinterWs().printStarting.value = true
    await nextTick()
    for (const action of ['Print', 'Rename', 'Delete']) expect(button(action).disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true)
    expect(printer.state).toBe('idle')
  })

  it('rechecks the lock after a delete confirmation', async () => {
    button('Delete').click()
    usePrinterWs().printStarting.value = true
    resolveConfirmation(true)
    await nextTick()
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('rechecks the lock after the rename prompt returns', async () => {
    button('Rename').click()
    printer.state = 'paused'
    resolveTextInput('new.gcode')
    await nextTick()
    expect(renameFile).not.toHaveBeenCalled()
  })
})
