import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { usePrinterStore } from '@/stores/printer'
import StatusPanel from './StatusPanel.vue'

async function renderStatus(state: Partial<ReturnType<typeof usePrinterStore>['$state']>) {
  const app = createSSRApp(StatusPanel)
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/files', component: { render: () => null } }],
  })
  app.use(pinia).use(router)
  usePrinterStore(pinia).$patch({ connected: true, ...state })
  return renderToString(app)
}

describe('printer error banner', () => {
  it('renders normal quotes instead of literal HTML entities in CFS recovery instructions', async () => {
    const html = await renderStatus({ state: 'error', errorCode: 2849 })
    expect(html).toContain('FR2849')
    expect(html).toContain('click the &quot;Retry&quot; button.')
    expect(html).not.toContain('&amp;quot;')
  })
})

describe('active print filament readout', () => {
  const job = { state: 'printing', filamentUsed: 28400, filamentEstimated: 42900 } as const

  it('shows measured usage and clearly marks both weight estimates', async () => {
    const html = await renderStatus({ ...job, filamentEstimatedWeight: 129 })
    const text = html.replace(/<[^>]*>/g, '')
    expect(text).toMatch(/28\.4m\s*\/\s*~85\s+g/)
    expect(text).toMatch(/~14\.5m\s*\/\s*~44\s+g\s+left/)
  })

  it('shows only the available usage and warns when a known estimate was exceeded', async () => {
    const missing = await renderStatus({ ...job, filamentEstimated: 0 })
    expect(missing).toContain('28.4m')
    expect(missing).not.toContain('job-filament-detail')
    const exceeded = await renderStatus({ ...job, filamentUsed: 45000, filamentEstimatedWeight: 129 })
    expect(exceeded).toContain('Over estimate')
    expect(exceeded).not.toContain('~0.0m')
  })
})
