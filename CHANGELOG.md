# Changelog

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
