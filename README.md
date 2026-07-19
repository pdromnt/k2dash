<div align="center">
  <img src="public/creality.png" width="112" height="112" alt="K2Dash logo" />
  <h1>K2Dash</h1>
  <p><strong>A local-first web dashboard for the Creality K2 Plus.</strong></p>
  <p>A cleaner alternative to the embedded dashboard—no cloud account or desktop app required.</p>

  <p>
    <img alt="Vue.js" src="https://img.shields.io/badge/Vue.js-35495E?style=for-the-badge&logo=vuedotjs&logoColor=4FC08D" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-1f2937?style=for-the-badge&logo=typescript&logoColor=3178C6" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-1f2937?style=for-the-badge&logo=vite&logoColor=646CFF" />
    <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind_CSS_4-1f2937?style=for-the-badge&logo=tailwindcss&logoColor=06B6D4" />
    <img alt="Pinia" src="https://img.shields.io/badge/Pinia-FFD859?style=for-the-badge&logo=pinia&logoColor=111827" />
  </p>
</div>

> [!IMPORTANT]
> K2Dash is an unofficial community project built by reverse engineering CrealityPrint's local printer protocol. It is not affiliated with or supported by Creality.

## What it does

- **Live print status** — progress, layers, ETA, elapsed time, temperatures, fans, filament use, filename, and thumbnail.
- **CFS overview** — slots, spool holder, colors, materials, vendors, temperature ranges, humidity, and temperature.
- **Live camera** — WebRTC stream using the printer's native signaling service.
- **Printer controls** — pause, resume, cancel, emergency stop, jog, homing, heaters, fans, and chamber light.
- **Safe utilities** — filament load/unload, leveling, input shaping, belt and Z calibration, plus guarded PID calibration.
- **File management** — upload, browse, rename, print, and delete G-code files.
- **Configuration editor** — browse and edit printer config files with active-print safety locks.
- **G-code console** — live responses, history, and WebSocket transport with Moonraker fallback.
- **History and timelapses** — inspect and clean print history; list, download, and delete timelapse videos.
- **Resilient connection** — automatic WebSocket reconnection and clear offline/reconnecting states.

Potentially disruptive controls are disabled while a print is preparing, running, or paused. Maintenance operations also require confirmation where appropriate.

## Quick start

Requirements: a recent Node.js release, npm, and a K2 Plus reachable on the same LAN.

```bash
git clone https://github.com/pdromnt/k2dash.git
cd k2dash
npm install
cp .env.example .env
```

Set `VITE_PRINTER_HOST` in `.env`, then start the development server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Configuration

All connection settings live in `.env`. Only the printer host is normally required; the stock service ports are already supplied.

| Variable | Default | Purpose |
|---|---:|---|
| `VITE_PRINTER_HOST` | *(required)* | Printer IP address or mDNS hostname |
| `VITE_API_PORT` | `7125` | Moonraker REST API |
| `VITE_WEBCAM_PORT` | `8000` | Creality WebRTC signaling |
| `VITE_UPLOAD_PORT` | `80` | Creality file-upload endpoint |

The native Creality WebSocket uses port `9999` and is derived automatically from `VITE_PRINTER_HOST`.

During development, Vite proxies printer traffic to avoid browser CORS restrictions. Production builds connect directly to the configured LAN services.

## Deploy to the printer

> [!WARNING]
> Deployment uses root SSH access and modifies files under `/mnt/UDISK`. Read the script and understand the nginx change before proceeding. Firmware updates may restore Creality's original configuration.

The deploy command runs tests, type-checking, lint, and a production build before uploading:

```bash
npm run deploy
```

The deployer compensates for the K2's limited SSH server by using separate upload and activation sessions. It uploads to a temporary archive, extracts into a staging directory, verifies the build, and only then swaps it into `/mnt/UDISK/k2dash`. A failed upload or verification leaves the existing dashboard untouched.

The current script uses the stock K2 Plus SSH credentials:

```text
user: root
password: creality_2024
```

### Point nginx at K2Dash

This is a one-time setup. SSH into the printer:

```bash
ssh root@<printer-ip>
```

Back up and edit the nginx configuration:

```bash
cp /etc/nginx/nginx.conf /mnt/UDISK/nginx.conf.k2dash-backup
vim /etc/nginx/nginx.conf
```

Find the Fluidd `root` directive and change it:

```nginx
# Before
root /usr/share/fluidd;

# After
root /mnt/UDISK/k2dash;
```

Save with `:wq`, then restart nginx:

```bash
/etc/rc.d/S80nginx restart
```

Open `http://<printer-ip>:4408`. Future `npm run deploy` runs replace only the K2Dash files; the deployer does not modify nginx.

## PWA behavior

K2Dash can be installed from a compatible browser using **Add to Home Screen** or **Install**. The service worker uses network-first navigation and cache-first content-hashed assets (`k2dash-v4`), so new deployments appear on reload while the application shell remains available during temporary network loss.

Printer data and controls still require the printer to be reachable on the LAN; printer traffic is deliberately never cached.

## Development commands

| Command | Action |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm test` | Run the Vitest suite |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |
| `npm run deploy` | Test, validate, build, and atomically deploy to the printer |

## How it connects

K2Dash prefers the same native services used by CrealityPrint:

- Creality WebSocket (`9999`) for real-time state and printer commands.
- Creality WebRTC signaling (`8000`) for the camera.
- Creality HTTP upload service (`80`) for G-code uploads.
- Moonraker (`7125`) for files, history, configuration, and fallback operations.

Everything stays between your browser and printer on the local network.

---

<div align="center">
  Released into the public domain under <a href="UNLICENSE">The Unlicense</a>.
</div>
