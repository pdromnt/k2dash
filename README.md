<div align="center">
  <img src="public/creality.png" width="112" height="112" alt="K2Dash logo" />
  <h1>K2Dash</h1>
  <p><strong>A local-first web dashboard for the Creality K2 Plus.</strong></p>
  <p>A cleaner alternative to the embedded dashboard—no cloud account or desktop app required.</p>

  <p>
    <img alt="Version 2.0.0" src="https://img.shields.io/badge/Version-2.0.0-38d76d?style=for-the-badge" />
    <img alt="Vue.js" src="https://img.shields.io/badge/Vue.js-35495E?style=for-the-badge&logo=vuedotjs&logoColor=4FC08D" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-1f2937?style=for-the-badge&logo=typescript&logoColor=3178C6" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-1f2937?style=for-the-badge&logo=vite&logoColor=646CFF" />
    <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind_CSS_4-1f2937?style=for-the-badge&logo=tailwindcss&logoColor=06B6D4" />
    <img alt="Pinia" src="https://img.shields.io/badge/Pinia-FFD859?style=for-the-badge&logo=pinia&logoColor=111827" />
  </p>
</div>

> [!IMPORTANT]
> K2Dash is an unofficial community project built by reverse engineering CrealityPrint's local printer protocol. It is not affiliated with or supported by Creality.

Version 2.0 introduces a redesigned desktop and mobile workspace, explicit CFS print setup, and safe config-backup cleanup. See the [changelog](CHANGELOG.md) for the release notes.

## What it does

- **Live print status** — progress, layers, ETA, elapsed time, temperatures, fans, filament use, filename, and thumbnail.
- **CFS materials** — physical slots and colors, material names, humidity, temperature, and explicit filament mapping before printing.
- **Live camera** — WebRTC stream using the printer's native signaling service.
- **Printer controls** — pause, resume, cancel, emergency stop, jog, homing, heaters, fans, and chamber light.
- **Safe utilities** — filament load/unload, leveling, input shaping, belt and Z calibration, plus guarded PID calibration.
- **File management** — upload, browse, rename, print, and delete G-code files.
- **Configuration editor** — browse and edit printer configs; group timestamped backups separately and clean up older snapshots while keeping the latest.
- **G-code console** — live responses, history, and the native Creality WebSocket transport.
- **History and timelapses** — inspect and clean print history; view recordings in a modal, download, or delete timelapse videos.
- **Resilient connection** — automatic WebSocket reconnection and clear offline/reconnecting states.

Potentially disruptive controls are disabled while a print is preparing, running, or paused. Maintenance operations also require confirmation where appropriate.

## Workspace

Overview prioritizes the current job and camera while printing, and recent files while idle. Temperatures, materials, lights, and fans remain easy to reach. The other tabs are Files, Controls, Activity, and Console; mobile reflows the same information instead of squeezing the desktop columns.

### Starting a print

Choose **Print** on a saved file to open setup. CFS is the safe default: review the file's used filaments and choose compatible physical slots. Unused slicer filaments are omitted when the printer explicitly reports zero usage. Missing requirements block CFS printing; they never silently select the external spool.

Choose **External spool** deliberately when using the spool holder. Starting another job is blocked while a print is active or a start request is pending.

CFS units are grouped by their reported hardware IDs, with independent temperature and humidity readings. Only units in the current native box list are shown; a connected unit with empty slots still appears. A global CFS disconnect clears the unit panels, and the external spool is shown separately. Print setup groups available slots by CFS and rejects mappings to removed units. Multi-unit behavior has fixture/test coverage, not a physical multi-CFS print validation.

### Cleaning up config backups

Open **Config → Clean up old backups**. Timestamped `printer-YYYYMMDD_HHMMSS.cfg` snapshots are grouped in their own collapsible section.

Cleanup keeps the newest snapshot and protects backups referenced by config includes. It shows the exact deletion list and requires typing `DELETE BACKUPS`. Before deleting, it refreshes the list, rechecks references, and skips changed or protected files. It stops if the printer disconnects, a job starts, or a deletion fails; partial results are reported.

Cleanup is manual, never automatic after printing. It does not edit `printer.cfg`, run G-code, or restart the printer. Deleted backups cannot be restored through K2Dash.

## Quick start

Requirements: Node.js 24+ (or 22.13+ on the 22.x line), npm, and a K2 Plus reachable on the same LAN.

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

## Safe development previews

With the dev server running, open `http://localhost:5173/?preview=idle`. Other isolated fixtures are `printing`, `paused`, `offline`, `empty`, `multi-cfs`, `spool-only`, and `empty-cfs`. Preview mode blocks native commands, HTTP mutations, webcam signaling, and printer data requests. It is unavailable in production builds.

Preview config files include timestamped backups and a protected include so cleanup discovery and confirmation can be inspected without touching printer storage. Deletion remains blocked in preview; automated tests cover successful cleanup, failures, and interrupted operations.

### Validation limits

CFS starts send native `colorMatch` followed by `multiColorPrint`, following CrealityPrint's protocol. Real native file metadata retrieval and compatible slot selection have been checked read-only on a K2 Plus.

Moonraker remains an explicit dependency for the existing file management, configuration editor, and history extension. There is no Moonraker fallback for telemetry, print lifecycle, G-code, lights, or emergency stop.


### Belt module calibration wizard

In **Printer controls → Maintenance → Belt module strain-gauge calibration**, open the wizard preview. It rehearses the separate, jig-based service procedure, not the existing one-button **Belt calibration** operation. Every step is simulated; the wizard does not use any printer transport, read live results, issue motion commands, write module flash, or ask the operator to fit a real jig. For a dashboard session with no printer traffic at all, use `http://localhost:5173/?preview=idle#/printer` on the dev server.

The command excerpts omit positioning and synchronization details. They are not a script to run.

**Experimental live calibration** is a separate, explicit opt-in for a stock K2 Plus on V1.1.4.11 or V1.1.8.0. The V1.1.8.01 download identifies itself internally as V1.1.8.0. The two stock versions and the V1.1.3.14.2 service image share the calibration driver and belt-module firmware. The driver writes persistent module flash. K2Dash's transport and operator flow have been tested with fixtures only, not on a real printer.

With both belts bare and the printer clear, use **Home all axes** in Printer controls, then enter `BOX_MOVE_TO_SAFE_POS` in Console and wait until the printer is fully parked and stationary. If parking fails or is unconfirmed, do not continue. Open [Creality's procedure and jig guide](https://wiki.creality.com/en/k2-flagship-series/k2-plus/belt-auto-tension-calibration) for physical setup; K2Dash does not home, park, or run the final self-test. The workflow requires fresh idle and cool/heaters-off status, explicit operator checks, and complete readbacks from both modules before it allows a write. It blocks competing commands from the same dashboard session until you finish or stop; emergency stop remains available. Keep other clients and the printer touchscreen from starting jobs or moving the printer. Every stage needs an explicit physical confirmation.

If that firmware does not expose usable belt replies to K2Dash, or a module has blank or invalid calibration values, the wizard stops rather than guessing. A local send acknowledgment is not a completed write. A timeout, cancellation, disconnect, conflicting response, or wrong readback stops the session without retries. Once a write was attempted, presume the module could be partially calibrated: wait for the printer to stop before removing any jig, inspect/recover with the service procedure, and do not print until the printer has been checked. After a successful run, perform the printer self-test manually with both jigs removed.

## Development commands

| Command | Action |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm test` | Run the Vitest suite |
| `npm run build` | Type-check and build for production |
| `npx eslint src/` | Lint application code |
| `npm run preview` | Preview the production build locally |
| `npm run deploy` | Test, validate, build, and atomically deploy to the printer |

## How it connects

K2Dash uses native Creality services for telemetry and controls, following CrealityPrint’s connection model:

- Creality WebSocket (`9999`) for real-time state and printer commands.
- Creality WebRTC signaling (`8000`) for the camera.
- Creality HTTP upload service (`80`) for G-code uploads.
- Moonraker (`7125`) for files, history, configuration (explicit extension features, never a fallback for controls).

Everything stays between your browser and printer on the local network.

## Contributing

Run tests, build, and lint before submitting changes. Use isolated previews for destructive flows; do not treat a passed unit test or a successful deployment as proof of printer behavior. [PRODUCT.md](PRODUCT.md) records product constraints and [DESIGN.md](DESIGN.md) records the visual system.

---

<div align="center">
  Released into the public domain under <a href="UNLICENSE">The Unlicense</a>.
</div>
