// K2 Dash — offline-capable service worker.
// Caches all static assets so the PWA loads when the printer is offline.
// Navigations are network-first so a deploy is visible on the next reload.
// Hashed static assets are cache-first. Printer traffic is never cached.

const CACHE = 'k2dash-v4'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/creality.png',
        '/manifest.json',
      ])
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Purge old cache versions
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    })
  )
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // Never cache printer traffic. In production Moonraker, webcam and
  // Creality downloads use different ports, so the origin check covers
  // those URLs as well as the Vite proxy paths used in development.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!response.ok) return response
          const copy = response.clone()
          return caches.open(CACHE)
            .then((cache) => cache.put('/index.html', copy))
            .then(() => response)
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Cache-first is safe for Vite's content-hashed JS/CSS/font assets.
  event.respondWith(
    caches.open(CACHE).then((cache) => {
      return cache.match(event.request).then((cached) => cached ||
        fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone())
          return response
        })
      )
    })
  )
})
