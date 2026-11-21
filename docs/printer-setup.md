# Printer setup

[Back to README](../README.md) · [Deploy](#deploy) · [Install as an app](#install-as-an-app) · [Connection reference](#connection-reference) · [Safe previews](#safe-development-previews)

## Deploy

> [!WARNING]
> Deployment uses root SSH access and changes dashboard files under `/mnt/UDISK`. The first install also requires a manual nginx change. Firmware updates may restore Creality’s original nginx configuration.

1. Follow the [quick start](../README.md#quick-start) to install dependencies and set `VITE_PRINTER_HOST` in the project-root `.env`. The script reads that file directly; if the IP changes, update it before deploying again.
2. Run `npm run deploy` from the project root. It runs tests, type-checking, lint, and a production build before connecting to the printer.
3. On the first install, do the [one-time nginx setup](#one-time-nginx-setup). Then open `http://<printer-ip>:4408`.

The deployer uses separate SSH sessions to upload a temporary archive and activate it. It checks the staged build before swapping it into `/mnt/UDISK/k2dash`. A failed upload or staging check leaves the existing dashboard untouched. The deploy command does not edit nginx or reboot the printer.

The script uses the stock K2 Plus SSH username `root` and password `creality_2024`.

## One-time nginx setup

After the first deploy, SSH into the printer. Replace `<printer-ip>` with the address from `.env`:

~~~bash
ssh root@<printer-ip>
~~~

Back up and edit the nginx configuration:

~~~bash
cp /etc/nginx/nginx.conf /mnt/UDISK/nginx.conf.k2dash-backup
vim /etc/nginx/nginx.conf
~~~

Find the Fluidd `root` directive and change it:

~~~nginx
# Before
root /usr/share/fluidd;

# After
root /mnt/UDISK/k2dash;
~~~

Save with `:wq`, then restart nginx:

~~~bash
/etc/rc.d/S80nginx restart
~~~

Open `http://<printer-ip>:4408`. Repeat the nginx setup only if it gets reset.

## Install as an app

Chrome’s address-bar **Install** promotion requires a secure origin. Use trusted HTTPS or `http://localhost`. A browser shortcut on ordinary printer LAN HTTP is not the same as a PWA and won’t enable the service worker.

**On one computer:** Set `VITE_PRINTER_PROXY=true` in `.env`, run `npm run build`, then `npm run preview -- --host localhost` and open [localhost:4173](http://localhost:4173). Keep the server running when using the installed app.

**For other devices on the LAN:** Serve the proxy-enabled `dist/` build through a trusted HTTPS reverse proxy. Strip each prefix when forwarding requests and preserve the remaining path and query string:

| Prefix | Printer service |
| --- | --- |
| `/api/moonraker` | HTTP `7125`; also forward WebSocket upgrades for Console output |
| `/api/printer-upload` | HTTP `80` for uploads, thumbnails, and downloads |
| `/api/printer-camera` | HTTP `8000` |
| `/api/printer-ws` | WebSocket `9999`; forward the upgrade |

> [!IMPORTANT]
> Don’t deploy a proxy-enabled build to an HTTP server without these routes. Keep the dashboard and printer private: K2Dash has no login.

The service worker can keep the previously loaded dashboard shell available during an outage. It does not cache printer traffic; live data and controls still need a connection.

## Connection reference

Only `VITE_PRINTER_HOST` is normally required. Vite proxies printer traffic in development; production builds connect directly unless proxy mode is enabled.

| Setting in `.env` | Default | Used for |
| --- | --- | --- |
| `VITE_PRINTER_HOST` | Required | LAN IP or mDNS hostname; also the SSH deploy destination |
| `VITE_API_PORT` | `7125` | Moonraker files, history, configuration, Klipper restarts, Console output and command help |
| `VITE_WEBCAM_PORT` | `8000` | Native Creality WebRTC signaling |
| `VITE_UPLOAD_PORT` | `80` | Native Creality G-code uploads |

The native Creality WebSocket uses `9999` for telemetry, print lifecycle, G-code, lights, and emergency stop. Moonraker provides the features listed above, not a fallback for those native commands.

## Safe development previews

With the dev server running, open [the idle preview](http://localhost:5173/?preview=idle). Other `preview` values: `printing`, `paused`, `offline`, `empty`, `multi-cfs`, `spool-only`, and `empty-cfs`.

Previews are development-only. They send no printer traffic. Config fixtures include timestamped backups and a protected include so you can inspect the cleanup flow without deleting anything.

Native file metadata and compatible slot selection have been checked read-only on a K2 Plus. CFS starts follow CrealityPrint: `colorMatch`, then `multiColorPrint`. A fixture, a successful build, and a successful deploy do not independently confirm printer behavior.
