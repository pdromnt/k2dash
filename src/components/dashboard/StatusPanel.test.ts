import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { usePrinterStore } from '@/stores/printer'
import StatusPanel from './StatusPanel.vue'

describe('printer error banner', () => {
  it('renders normal quotes instead of literal HTML entities in CFS recovery instructions', async () => {
    const app = createSSRApp(StatusPanel)
    const pinia = createPinia()
    app.use(pinia)
    usePrinterStore(pinia).$patch({ connected: true, state: 'error', errorCode: 2849 })

    const html = await renderToString(app)
    expect(html).toContain('FR2849')
    expect(html).toContain('click the &quot;Retry&quot; button.')
    expect(html).not.toContain('&amp;quot;')
  })
})
