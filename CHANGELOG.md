# Changelog

## Unreleased

- Give Config, camera actions, Console Clear, and Emergency stop visible button styles on desktop and mobile.

- Keep belt calibration on the current step with controls locked while reconnecting between operations, recheck before continuing, and remove the checkbox flash when advancing.
- Read belt module replies from Klipper’s live output and stop if that connection drops.
- Keep the belt wizard’s idle/temperature checks current when Creality only sends changed values.
- Restore live Console output by listening to Klipper’s Moonraker broadcasts while keeping command sends on the native Creality connection.
- Prepare the printer without leaving the belt wizard: check Klipper commands, turn heaters off, and explicitly home and park. Console `HELP` uses the same read-only command list because native firmware can omit its reply.
- Reject belt-module replies with trailing firmware errors, enforce the initial reset pause on each side, and clarify verified parking before calibration.
- Show detected K2-series model names in the header and offer the experimental belt tension wizard only on a detected K2 Plus. K2 and K2 Pro get their manual belt-tensioning guide.
- Show a temporary Klipper restart banner that explains transient XS3000 warnings and reports unconfirmed recovery after 30 seconds.
- Add a K2Dash nozzle mark for the navbar, favicon, and correctly sized PWA icons. Document secure install and same-origin proxy options.
- Give config restarts more time to acknowledge and distinguish unconfirmed restarts from failed saves. Add a confirmed Firmware restart action in Maintenance.
- Group homing with its jog axis and align live heater readings beside Set.
- Replace the belt-calibration rehearsal and inline live panel with one floating **[EXPERIMENTAL] Belt Tension Calibration** wizard, retaining per-write confirmations and adding Creality’s preparation, jig, and recovery guidance.
- Group connected CFS units by hardware ID with independent readings; show the external spool separately and clear removed/disconnected units.
- Group print-setup slots by CFS and revalidate connected destinations before each native start step.
- Add multi-CFS, spool-only, and empty-CFS previews and regression coverage.
- Fix empty-file upload-link contrast, make Open camera a bordered icon button, and keep the footer at the page bottom without covering long content.

## 2.0.0 — 2026-11-04

### Workspace

- Rebuilt the dashboard around graphite surfaces and Creality green, with distinct idle and printing layouts.
- Added Overview, Files, Controls, Activity, and Console navigation, a desktop inspector, and job-first mobile reflow.
- Unified light/fan controls and print actions; replaced the emergency-stop square with a circle-slash SVG icon.
- Hardened reusable confirmations with native modal focus behavior, safe cancellation, and scrollable file lists.

### Native printing

- Added explicit CFS or external-spool setup instead of always starting through the spool-holder command.
- Read native file requirements, omit explicitly unused filaments without renumbering logical IDs, and map them to compatible physical CFS slots.
- Send `colorMatch` before `multiColorPrint`; block missing metadata, duplicate starts, and disconnected commands.
- Removed automatic Moonraker telemetry and command fallbacks. Files, configuration, and history remain explicit Moonraker features.
- Preserve partial native status frames and keep chamber-light state driven by printer telemetry.

### Configuration and safety

- Group timestamped printer-config backups separately from working config files.
- Added confirmed bulk cleanup that keeps the latest snapshot and protects referenced backups; revalidate targets and stop safely on busy/offline state or deletion failure.
- Keep movement, heaters, maintenance, and disruptive file/config operations guarded during active jobs.
- Added isolated development previews and expanded the automated suite to 29 tests.

### Validation

Desktop/mobile previews, native metadata and slot selection, build, lint, and dashboard deployment were checked. No cleanup was executed against real printer config files during development. Actual CFS print execution remains a supervised hardware-test requirement.
