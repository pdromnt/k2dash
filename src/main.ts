import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Register service worker for PWA installability
if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('Service worker registration failed:', err)
  })
}

if (import.meta.env.DEV) {
  console.log(
    '%c K2 Dash %c Dev Mode ',
    'background:#8baf34;color:#fff;padding:4px 8px;border-radius:4px 0 0 4px',
    'background:#1e293b;color:#fff;padding:4px 8px;border-radius:0 4px 4px 0',
  )
}
