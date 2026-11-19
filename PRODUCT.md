# K2Dash

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Owners monitoring and operating Creality K2-series printers from a desktop browser or phone on the local network. Long-running jobs make accurate state and reliable controls important.

## Product Purpose

Provide a capable local alternative to the printer's embedded dashboard and CrealityPrint's desktop interface. Monitor a print, inspect the camera and CFS, prepare jobs, and maintain printer files.

## Operating Context

Desktop and mobile use. The same interface must work while idle, preparing, printing, paused, disconnected, and reporting an error. Idle screens prioritize choosing a file rather than displaying empty job metrics.

## Capabilities and Constraints

- Vue 3, TypeScript, Pinia, Vite, Tailwind CSS; an existing application rather than a new product.
- Native Creality telemetry and controls, CFS mapping, WebRTC camera, file upload, files, console, maintenance, history, timelapses, and configuration editing.
- Never abbreviate CrealityPrint.
- Do not silently switch native printer commands or telemetry to Moonraker. Existing Moonraker file/history/configuration features remain explicit dependencies while native equivalents are investigated.
- CFS requires an explicit filament mapping. Missing metadata must not be guessed or silently changed to external spool printing.
- CFS visibility follows the current native unit list and global connection state, not filament occupancy. Preserve hardware IDs, independent sensor readings, and a separate external-spool presentation. Removed units must not remain available as print destinations.
- Jogging, heater changes, maintenance, and disruptive file/configuration operations stay locked during active jobs.
- Config-backup cleanup is explicit and confirmed. Keep only the newest timestamped root printer backup, protect referenced configs, and stop on busy/offline state or deletion errors. Never clean up automatically after a print.
- Preview data must be visibly identified and isolated from printer traffic.
- Deployment replaces dashboard files and does not reboot the printer. Deployment, Git publication, and actual printer operations are separate actions requiring appropriate authorization.

## Brand Commitments

The name is K2Dash. Its visual identity is a dense, dark operational workspace: compact toolbar, substantial central work area, and a distinct inspector rail, using Creality green and graphite. Plain printer terminology and purposeful hierarchy take priority over decorative themes, lifestyle copy, or illustrations. See DESIGN.md for the implemented tokens and component rules.

## Product Principles

- One trustworthy source of printer state.
- Show the information needed for the current job and make the next action obvious when idle.
- Keep frequently used controls reachable on phones without compressing labels or readings.
- Keep dangerous actions deliberate and disconnected states honest.
