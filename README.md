<img src="public/creality.png" width="128" height="128" alt="Creality's Logo" align="left"/>

<h3>K2Dash</h3>

A real-time dashboard for the **Creality K2 Plus** 3D printer.  
Connects directly over your local network.

<br clear="all"/>

## Features

- **Live status** — extruder/bed/chamber temperatures with targets, print progress with layers & ETA, part fan, filament usage
- **Print job** — filename, state badge, progress bar, elapsed/remaining time, filament used + estimated weight, sliced model thumbnail
- **CFS filament display** — all 4 CFS slots + spool holder with color swatches, material type, vendor, temperature range, humidity & temperature pills
- **Live webcam** — WebRTC stream from the printer's camera (Creality base64 JSON signaling, port 8000)
- **Controls** — jog pad with 10–50mm variable slider, temperature setpoints, 3-fan readouts (part/aux/chamber), LED toggle, emergency stop, quick G-code commands
- **File management** — upload (Creality endpoint), browse, rename, start print, delete G-code files
- **G-code console** — send commands over WebSocket with HTTP fallback, live responses, command history
- **Print history** — list and clean up past prints with duration, filament used, and formatted status
- **Timelapse** — list saved timelapses, download, delete via WebSocket
- **Auto-reconnect** — exponential backoff (1s → 30s max), offline screen after 15s, red reconnecting banner with live counter

## Quick start

```bash
npm install
cp .env.example .env       # set VITE_PRINTER_HOST to your printer's IP
npm run dev                # http://localhost:5173
```

## Deploy to the printer

The K2 Plus runs a Linux system with SSH access. Deploy the dashboard directly to the printer's filesystem:

```bash
npm run deploy
```

This type-checks, lints, builds, and uploads the production build to `/mnt/UDISK/k2dash` on the printer via SSH + tar pipe.

> All Creality K2 Plus printers use universal SSH credentials: `root` / `creality_2024`

### Point the printer's web server to the dashboard

After deploying, SSH into the printer and edit the nginx config:

```bash
ssh root@<printer-ip>
```

> Only `vim` is available on the stock firmware, `nano` and other editors are not installed.

```vim
vim /etc/nginx/nginx.conf
```

Find the line with the path for printer's Fluidd install and replace the `root` directive's path:

```nginx
# Before:
root /usr/share/fluidd;

# After:
root /mnt/UDISK/k2dash;
```

Save and exit (`:wq`), then restart nginx:

```bash
/etc/rc.d/S80nginx restart
```

Now open `http://<printer-ip>:4408` in your browser and you'll see K2 Dash instead of Fluidd.

### Redeploying after changes

```bash
npm run deploy         # builds + uploads, no SSH config needed again
```

The nginx config change is a one-time setup. Subsequent deploys just overwrite the files. The deploy script does NOT touch the nginx files!

## Configuration (required for Dev and the deploy script!)

All printer connection settings live in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_PRINTER_HOST` | *(empty)* | Printer IP address (e.g. `192.168.0.100`) |
| `VITE_API_PORT` | `7125` | Moonraker REST API (telemetry, G-code, files, history, delete) |
| `VITE_WEBCAM_PORT` | `8000` | WebRTC signaling for the live camera |
| `VITE_UPLOAD_PORT` | `80` | Creality file upload endpoint |

The Creality WebSocket on port 9999 is used for real-time printer state and CFS data. No configuration needed — it's auto-discovered from the printer IP.

### Dev vs Prod

- **Dev** (`npm run dev`) — Vite proxies `/api/*` to the printer, avoiding CORS issues.
- **Prod** — the dashboard connects directly to the printer on the LAN. When served from the printer itself (via the nginx setup above), there are no CORS concerns at all.

## PWA — Install as a native app

K2 Dash is a Progressive Web App. After deploying, open `http://<printer-ip>:4408` on your phone or tablet — your browser will offer to "Add to Home Screen" or "Install".

Once installed, the app opens like a native app with no browser chrome. It works offline too — after the first visit, all assets (including `index.html`) are cached by the service worker (cache-then-network, v3). If the printer goes down, the app shows a "Couldn't connect to printer" offline screen with auto-reconnect.

- **First launch offline** → after 15s, shows a fullscreen "Couldn't connect" message
- **Connection drops while open** → red banner "Connection lost — reconnecting" with live counter
- **Reconnected** → banner clears automatically, data resumes

## Tech stack

Vue 3 + Vite + TypeScript + Tailwind CSS 4 + Pinia + Vue Router.
