<div align="center">
  <img src="public/k2dash.svg" width="112" height="112" alt="K2Dash logo" />
  <h1>K2Dash</h1>
  <p><strong>A local-first web dashboard for the Creality K2 series.</strong></p>
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

> [!TIP]
> **Hardware-tested: K2 Plus belt tension calibration on stock firmware.**
>
> On a real K2 Plus running **V1.1.8.0**, K2Dash calibrated both XY belt tension sensors with the printed jig, verified the saved readings, and the printer passed the **belt step of its built-in self-test**. No service firmware or downgrade required.
>
> [Open the calibration guide ↓](#experimental-belt-tension-calibration)

## What it does

- **Live print status** — progress, layers, ETA, elapsed time, temperatures, fans, filament use, filename, and thumbnail.
- **CFS materials** — physical slots and colors, material names, remaining filament estimates when reported, humidity, temperature, and explicit filament mapping before printing.
- **Live camera** — WebRTC stream using the printer's native signaling service.
- **Printer controls** — pause, resume, cancel, emergency stop, jog, homing, heaters, fans, and chamber light.
- **Safe utilities** — filament load/unload, leveling, input shaping, belt and Z calibration, plus guarded PID calibration.
- **Belt tension sensor calibration** — a separate, [hardware-tested wizard](#experimental-belt-tension-calibration) for the K2 Plus on stock firmware.
- **File management** — upload, browse, rename, print, and delete G-code files.
- **Configuration editor** — browse and edit printer configs; group timestamped backups separately and clean up older snapshots while keeping the latest.
- **G-code console** — native Creality WebSocket commands, command history, and live Klipper output via Moonraker. `HELP` reads Klipper’s documented command list without executing G-code.
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

Requirements: Node.js 24+ (or 22.13+ on the 22.x line), npm, and a Creality K2-series printer reachable on the same LAN.

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

**Set the deploy target first.** If you don't already have a `.env` file in the project root, copy `.env.example` to `.env`. Set `VITE_PRINTER_HOST` to your printer's LAN IP address or local hostname, without a URL scheme or port:

```dotenv
VITE_PRINTER_HOST=192.168.1.50
```

Replace the example IP with your printer's address. This is the same setting used by the dashboard. The deploy script reads it directly from `.env` to choose the SSH destination; it does not discover printers automatically. If the IP changes, update `.env` before deploying again.

From the project root, run the deploy command. It runs tests, type-checking, lint, and a production build before uploading to that host:

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

Chrome’s address-bar **Install** promotion requires a secure origin. `http://<printer-ip>:4408` is ordinary LAN HTTP, so Chrome won’t promote it as a PWA there. Use a trusted HTTPS address or `http://localhost` on the computer running the dashboard. A browser menu shortcut, where available, does not enable the service worker on LAN HTTP.

For a local install, set `VITE_PRINTER_PROXY=true` for a local build (`npm run build`), then run `npm run preview -- --host localhost` and open `http://localhost:4173`. Keep the local server running when using the installed app. Don’t deploy this proxy-enabled build to the printer’s existing HTTP server unless that server also provides the proxy routes.

For a shared HTTPS install, serve the proxy-enabled `dist/` on a trusted HTTPS reverse proxy on your LAN. Forward these prefixes to the printer, stripping each prefix and preserving the remainder and query string:

| Prefix | Printer service |
| --- | --- |
| `/api/moonraker` | HTTP port `7125` (also forward WebSocket upgrades for live Console output) |
| `/api/printer-upload` | HTTP port `80` (uploads, thumbnails, and downloads) |
| `/api/printer-camera` | HTTP port `8000` |
| `/api/printer-ws` | WebSocket port `9999` (forward the WebSocket upgrade) |

Use a certificate trusted by your devices and keep the service private. The dashboard has no login; don’t expose the proxy or printer to the public internet.

The service worker keeps the previously loaded app shell available during a temporary outage. Printer data and controls still require a connection; printer traffic is never cached.

## Safe development previews

With the dev server running, open `http://localhost:5173/?preview=idle`. Other isolated fixtures are `printing`, `paused`, `offline`, `empty`, `multi-cfs`, `spool-only`, and `empty-cfs`. Preview mode blocks native commands, HTTP mutations, webcam signaling, and printer data requests. It is unavailable in production builds.

Preview config files include timestamped backups and a protected include so cleanup discovery and confirmation can be inspected without touching printer storage. Deletion remains blocked in preview; automated tests cover successful cleanup, failures, and interrupted operations.

### Validation limits

The dashboard has been tested on the K2, K2 Pro, and K2 Plus. Model-specific maintenance features have their own validation limits; see the notes below.

CFS starts send native `colorMatch` followed by `multiColorPrint`, following CrealityPrint's protocol. Real native file metadata retrieval and compatible slot selection have been checked read-only on a K2 Plus.

Moonraker is an explicit dependency for file management, configuration, history, Klipper restarts, and read-only Console output and command help. There is no Moonraker fallback for telemetry, print lifecycle, G-code execution, lights, or emergency stop.

**Save + Restart** saves the config and requests a Klipper host restart to reload it. **Controls → Maintenance → Firmware restart** also resets the controller boards, for example when recovering after an emergency stop. Neither action power-cycles the entire machine. If a reply is lost during restart, check the printer before retrying; it may already be restarting.

After either dashboard action, a banner explains that Creality may briefly report XS3000 while Klipper is offline. The banner clears when the dashboard confirms recovery, or asks you to check the printer if it cannot confirm recovery within 30 seconds. Errors outside that restart window are shown normally.


### Experimental belt tension calibration

**K2 Plus only.** The dashboard uses the printer’s reported model, not its configured name. For a detected K2 or K2 Pro, Maintenance shows the appropriate Creality wiki guide for manual belt tensioning instead of the experimental wizard.

In **Printer controls → Maintenance → [EXPERIMENTAL] Belt Tension Calibration**, choose **Open wizard**. This floating dialog guides the separate, jig-based sensor procedure, not the existing one-button **Belt calibration** macro: preparation → right belt → left belt → final module verification → manual self-test.

The wizard links to Creality’s guide, jig model, and video. It includes the optional normal-tension check (7.5 N ± 0.5 N), middle-of-belt placement, and warning against pulling forcefully while fitting the jig. The guide’s special firmware and hidden touchscreen menu describe Creality’s original service route, not prerequisites for K2Dash’s stock-firmware path. For a dashboard session with no printer traffic at all, inspect preparation at `http://localhost:5173/?preview=idle#/printer`; module operations stay disabled in preview.

**Hardware-tested on stock V1.1.8.0** (the V1.1.8.01 download reports V1.1.8.0 on the printer). Both sensors were calibrated, both saved readings were verified, and the printer passed the belt step of its manual self-test. The wizard remains experimental: older and newer firmware versions may work, but aren't confirmed. The procedure writes to the belt modules’ persistent memory. Stop on any discrepancy; you are responsible for proceeding and for any resulting issues.

Follow [Creality's procedure and jig guide](https://wiki.creality.com/en/k2-flagship-series/k2-plus/belt-auto-tension-calibration) for physical setup; the wizard uses firmware commands in place of the service-firmware UI. Use **Check commands** to verify Klipper lists `BELT_MDL_INFO` and `BELT_MDL_CALI`. If needed, use **Turn heaters off** and wait for the temperature and target readings to confirm it’s safe to continue. With both belts bare and the printer clear, confirm the work area and choose **Home & park printer**. This sends homing and `BOX_MOVE_TO_SAFE_POS` with `M400` motion waits; a send is not proof of completion. Wait until the printer is completely still and personally confirm the service position before reading either module. Stop on an error or if parking is unconfirmed; don’t substitute guessed coordinates. The final self-test remains manual.

The workflow requires fresh idle and cool/heaters-off status, explicit operator checks, and complete readbacks from both modules before it allows a write. While the wizard is open, it reads full safety snapshots and listens to live Klipper replies through Moonraker. Unchanged values and command replies may be absent from Creality’s updates. Commands still use Creality’s connection. The unloaded read starts at least one second after each side’s verified initial reset. Don't home, jog, or run auto-tension with a jig installed. The wizard blocks competing commands from the same dashboard session until you finish or stop; emergency stop remains available. Keep other clients and the printer touchscreen from starting jobs or moving the printer. Every stage needs an explicit physical confirmation.

If that firmware does not expose usable belt replies to K2Dash, or a module has blank or invalid calibration values, the wizard stops rather than guessing. A local send acknowledgment is not a completed write. Between steps, switching tabs or losing the connection pauses the wizard on the current step and locks its calibration controls while reconnecting. It checks fresh printer status and waits for you to review the physical setup and confirm the current step again. On that confirmation, it checks both saved module readings before allowing another write. Nothing is sent automatically. A timeout or disconnect during an operation, a cancellation, a conflicting response, or a wrong readback stops the session without retries. Escape or closing during an active session stops future commands and leaves recovery instructions visible; an already-sent command cannot be recalled. The dialog's Emergency Stop can send only while connected; if disconnected, use the printer's own stop control. Once a write was attempted, presume the module could be partially calibrated: wait for the printer to stop before removing any jig, inspect/recover with the service procedure, and do not print until the printer has been checked. After a successful run, perform the printer self-test manually with both jigs removed. No printer configuration save is needed.

## Development commands

| Command | Action |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm test` | Run the Vitest suite |
| `npm run build` | Type-check and build for production |
| `npx eslint src/` | Lint application code |
| `npm run preview` | Preview the production build locally |
| `npm run deploy` | Test, validate, build, and [deploy to the printer set in `.env`](#deploy-to-the-printer) |

## How it connects

K2Dash uses native Creality services for telemetry and controls, following CrealityPrint’s connection model:

- Creality WebSocket (`9999`) for real-time state and printer commands.
- Creality WebRTC signaling (`8000`) for the camera.
- Creality HTTP upload service (`80`) for G-code uploads.
- Moonraker (`7125`) for files, history, configuration, Klipper restarts, and read-only Console output (explicit features, not a command fallback).

Everything stays between your browser and printer on the local network.

## Contributing

Run tests, build, and lint before submitting changes. Use isolated previews for destructive flows; do not treat a passed unit test or a successful deployment as proof of printer behavior. [PRODUCT.md](PRODUCT.md) records product constraints and [DESIGN.md](DESIGN.md) records the visual system.

---

<div align="center">
  Released into the public domain under <a href="UNLICENSE">The Unlicense</a>.
</div>
