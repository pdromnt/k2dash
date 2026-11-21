# Maintenance

[Back to README](../README.md) · [Config backups](#cleaning-up-config-backups) · [Restarts](#restarting-klipper) · [Belt tension calibration](#experimental-belt-tension-calibration)

## Cleaning up config backups

Open **Config → Clean up old backups**. The dashboard groups timestamped `printer-YYYYMMDD_HHMMSS.cfg` snapshots separately from working files.

- Cleanup keeps the newest snapshot and protects backups referenced by config includes.
- It shows the exact list and requires typing `DELETE BACKUPS`. Before deleting, it refreshes the list, rechecks references, and skips changed or protected files.
- It stops on disconnect, a new print job, or a deletion error and reports any partial results.

Cleanup is manual. It does not edit `printer.cfg`, send G-code, or restart anything. Deleted backups cannot be restored through K2Dash.

## Restarting Klipper

- **Save + Restart** saves the config and reloads the Klipper host.
- **Controls → Maintenance → Firmware restart** also resets the controller boards. This can help recover after an emergency stop.

Neither option power-cycles the printer. Creality can briefly report **XS3000** while Klipper is offline. The dashboard clears its restart banner when recovery is confirmed; after 30 seconds without confirmation, it asks you to check the printer. A lost reply doesn’t mean the restart failed—check before retrying.

## Experimental belt tension calibration

> [!IMPORTANT]
> **K2 Plus only.** Both XY belt sensors were calibrated and their saved readings verified on stock **V1.1.8.0** (also reported by the V1.1.8.01 download). The printer passed the belt step of its built-in self-test. Other firmware versions are unconfirmed, and the wizard is still experimental.

The dashboard uses the printer’s reported model. K2 and K2 Pro show a link to Creality’s manual procedure instead.

### Before you start

- Open **Controls → Maintenance → [EXPERIMENTAL] Belt Tension Calibration → Open wizard**. This is the printed-jig sensor procedure, not the routine **Belt calibration** macro.
- Use [Creality’s guide, jig model, and video](https://wiki.creality.com/en/k2-flagship-series/k2-plus/belt-auto-tension-calibration) for the physical setup. The wizard links to all three. Creality’s special firmware and touchscreen menu are part of its original service route; K2Dash uses stock firmware.
- The optional normal-tension check is **7.5 N ± 0.5 N**. Fit the jig at the middle of the belt as instructed. Don’t pull forcefully when fitting it.
- The procedure writes to persistent belt-module memory. Stop on any discrepancy; you are responsible for proceeding and for any resulting issues.

### Run the wizard

1. **Prepare.** Run **Check commands** for `BELT_MDL_INFO` and `BELT_MDL_CALI`. Turn the heaters off if needed. Start only when the idle printer is cool and its heater targets are off.
2. **Park.** With both belts bare and the work area clear, use **Home & park printer**. It sends homing and `BOX_MOVE_TO_SAFE_POS` with `M400` motion waits. A send is not proof of completion. Confirm at the printer that it is still and parked in the correct position. Don’t guess coordinates or continue if parking is unconfirmed.
3. **Read and calibrate.** The wizard requires complete readbacks from both modules before allowing a write. Follow the prompts for the right belt, then the left. Each unloaded reading waits at least a second after the verified reset, and each physical step requires your confirmation. **Don’t home, jog, or run auto-tension with a jig installed.**
4. **Verify and self-test.** Remove both jigs before running **Verify saved values**. Once the wizard confirms both readbacks, run the printer’s built-in self-test manually before printing. There is no printer config save step.

The wizard reads safety status and Klipper replies through Moonraker; commands still go over Creality’s connection. It blocks competing commands in the same dashboard session. Keep anyone at the touchscreen or on another client from starting a job or moving the printer.

### If it pauses or stops

- **Between steps:** a tab switch or a dropped connection leaves you on the current step with controls locked. The wizard checks fresh status and asks you to confirm the physical setup again. Both module readings are checked before the next write. No calibration commands are sent automatically.
- **During an operation:** a timeout, disconnect, conflicting reply, wrong readback, or cancellation stops the session without retrying. Missing or invalid module data does not count as a successful read. Closing the wizard or pressing Escape stops future commands but can’t recall a command already sent.
- **After a write attempt:** the module may be partially calibrated. Wait for the printer to stop, remove any jig safely, and follow Creality’s service procedure before printing. Don’t restart the wizard blindly. If the connection is down, use the printer’s own stop control instead of the dashboard’s Emergency stop.

To inspect the preparation screens without printer traffic, open the [Controls preview](http://localhost:5173/?preview=idle#/printer) with the dev server running. Module commands are disabled there.
