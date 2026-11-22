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

[Quick start](#quick-start) · [Deploy to the printer](#deploy-to-the-printer) · [Using the dashboard](#using-the-dashboard) · [Belt tension calibration](#experimental-belt-tension-calibration) · [Development](#development)

> [!TIP]
> **Hardware-tested: K2 Plus belt tension calibration on stock firmware.**
>
> On a K2 Plus running **V1.1.8.0**, K2Dash calibrated both XY belt tension sensors with the printed jig and verified the saved readings. The printer passed the **belt step of its built-in self-test**. No service firmware or downgrade required.
>
> [Read the calibration guide](docs/maintenance.md#experimental-belt-tension-calibration)

K2Dash has been tested on the **K2, K2 Pro, and K2 Plus**. It is an unofficial community project based on CrealityPrint’s local protocol, not affiliated with Creality. See the [changelog](CHANGELOG.md) for release notes.

## Quick start

You’ll need Node.js 24+ (or 22.13+ on the 22.x line), npm, and a printer on the same LAN.

~~~bash
git clone https://github.com/pdromnt/k2dash.git
cd k2dash
npm install
cp .env.example .env
~~~

Set `VITE_PRINTER_HOST` in the project’s `.env` to your printer’s LAN IP or local hostname. Find the IP under **Settings → Network** on the printer. Use the bare address, without `http://` or a port:

~~~dotenv
VITE_PRINTER_HOST=192.168.1.50
~~~

Replace the example with your printer’s address. Run `npm run dev` and open [localhost:5173](http://localhost:5173). **No printer modifications are needed** to run the dashboard from your computer.

## Deploy to the printer

`npm run deploy` tests, checks, builds, and uploads K2Dash over root SSH. It reads **`VITE_PRINTER_HOST` from the project’s `.env`** to choose the printer. It does not discover printers automatically.

~~~bash
npm run deploy
~~~

- **First install?** Follow the [one-time nginx setup](docs/printer-setup.md#one-time-nginx-setup), then open `http://<printer-ip>:4408`.
- **Updating?** Just `git pull` and run the command again. It replaces only the dashboard files and does not edit nginx or reboot the printer.
- **Want to install it as an app?** See [PWA setup](docs/printer-setup.md#install-as-an-app). Chrome’s PWA install promotion doesn’t work on ordinary LAN HTTP.

## Using the dashboard

- **Overview** — monitor the job, camera, temperatures, fans, and CFS. When slicer metadata is available, the job shows estimated filament left in metres and grams. CFS slots show their separate spool estimates only when the printer reports them.
- **Files** — upload, browse, rename, delete, or start a print.
- **Controls** — move the printer, set heaters, operate fans and lights, and run maintenance. Disruptive controls lock while a print is preparing, running, or paused.
- **Activity** — browse print history and view, download, or delete timelapses.
- **Console** — send native Creality commands and see live Klipper replies via Moonraker. `HELP` reads the command list without executing G-code.

### Starting a print

Choose **Print** on a saved file, then map the file’s used filaments to compatible CFS slots. Choose **External spool** if you’re using the spool holder. Missing CFS requirements block the start; they don’t silently switch you to the external spool. Multi-CFS grouping is tested with fixtures, not a physical multi-CFS print.

### Maintenance

- [Clean up config backups](docs/maintenance.md#cleaning-up-config-backups) — keep the newest snapshot and protect backups referenced by includes.
- [Restart Klipper or the firmware](docs/maintenance.md#restarting-klipper) — choose the right restart and know which warnings to expect.

### Experimental belt tension calibration

On a **K2 Plus**, go to **Controls → Maintenance → [EXPERIMENTAL] Belt Tension Calibration**. This is the printed-jig sensor wizard, not the routine **Belt calibration** macro. K2 and K2 Pro get links to Creality’s manual procedure instead. [Read the preparation, safety, and recovery notes](docs/maintenance.md#experimental-belt-tension-calibration) before starting.

## Development

- **Try it without a printer:** open [the isolated preview](http://localhost:5173/?preview=idle) with the dev server running. [See available preview states](docs/printer-setup.md#safe-development-previews).
- **Check changes:** run `npm test`, `npm run build`, and `npx eslint src/`. Use `npm run preview` to serve a local production build.
- **Reference:** [connection settings and service ports](docs/printer-setup.md#connection-reference), [product constraints](PRODUCT.md), and [design system](DESIGN.md). Use previews for destructive workflows; a test or successful deployment isn’t proof of printer behavior.

---

<div align="center">
  Released into the public domain under <a href="UNLICENSE">The Unlicense</a>.
</div>
