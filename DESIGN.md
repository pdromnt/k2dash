---
name: K2Dash
description: Compact graphite printer workspace with Creality green actions.
colors:
  green: "#38d76d"
  accent: "#38d76d"
  accent-ink: "#082b13"
  amber: "#f0c36d"
  red: "#f3a39e"
  blue: "#9fc2ea"
  bg-page: "#121418"
  bg-card: "#1a1e23"
  bg-input: "#111419"
  bg-terminal: "#101318"
  border: "#323840"
  border-strong: "#48515c"
  text: "#edf0f2"
  text-dim: "#b5bdc7"
  text-mute: "#959faa"
typography:
  headline:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    letterSpacing: "-0.45px"
  job-title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 550
    lineHeight: 1.5
  title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "14px"
  button:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  label:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "11px"
  reading:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    letterSpacing: "-0.4px"
  mono:
    fontFamily: "ui-monospace, monospace"
    fontSize: "12px"
rounded:
  control: "6px"
  inset: "7px"
  panel: "12px"
spacing:
  compact: "8px"
  control: "12px"
  inset: "16px"
  section: "18px"
  workspace: "20px"
  dialog: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "#252b33"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  button-danger:
    backgroundColor: "#462b2c"
    textColor: "#ffd4ce"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  button-warning:
    backgroundColor: "#3b3222"
    textColor: "#f4d398"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.bg-input}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "38px"
  navigation-active:
    backgroundColor: "#273c2e"
    textColor: "#9cf2b7"
    rounded: "{rounded.control}"
    padding: "0 14px"
  card:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "22px"
  source-choice-selected:
    backgroundColor: "#203a2b"
    textColor: "{colors.text}"
    rounded: "{rounded.inset}"
    padding: "14px"
---

# Design System: K2Dash

## Overview

**Creative North Star: "The Graphite Printer Workspace"**

A compact operational interface: graphite chrome, near-white sans-serif labels, thin seams, and restrained Creality green. The workspace prioritizes trustworthy printer state and clearly bounded controls over decorative presentation.

Keep the dense desktop-tool character on phones through reflow, not by shrinking every control. Cream surfaces, serif display headlines, lifestyle copy, and decorative printer illustrations are outside this visual world.

**Key Characteristics:**

- Dense, visibly grouped work areas.
- Plain printer terminology and tabular readings.
- Green actions and selections; explicit warning and error states.

## Colors

### Primary

Creality green marks primary actions, connected/printing state, progress, focus, and selected material sources. Accent ink supplies the dark text on filled green buttons; `accent` and `green` intentionally share a value in the source.

### Neutral

Page graphite surrounds slightly lighter cards. Inputs and terminal areas are darker recesses. Default borders divide surfaces; stronger borders define actionable controls. Near-white text carries titles and values, dim text carries supporting content, and muted text carries units and metadata.

Amber identifies paused/heating/warning states; soft red identifies errors and destructive actions; pale blue identifies completed state. These are semantic feedback colors, not additional decorative accents.

**The State Before Decoration Rule.** Color communicates action, selection, progress, or printer state; pair status color with a readable label.

## Typography

Inter Variable, with system-ui and sans-serif fallbacks, serves the entire interface. Monospace is reserved for commands, filenames in confirmation subjects, and technical values where appropriate; there is no separate display face.

Page headings use the headline role; section headings use title. Job titles are intermediate in scale and wrap long filenames. Body is the global baseline, while most operational text uses compact button and label roles. Temperature readings use the reading role with tabular numerals; job metrics also use tabular numerals. At the mobile breakpoint, job titles reduce to (15px), page headings to (22px), and temperature readings increase to (22px).

**The Plain Label Rule.** Use short, literal operational labels rather than promotional language or invented section slogans.

## Layout

The shell fills the viewport and keeps its header and horizontal navigation above a scrolling content region. Desktop chrome uses a (64px) header and (49px) navigation. Content is centered with a maximum width of (1800px), with a broad work column and a (318px) inspector separated by a (20px) gap. Panels use deliberately varied density, not equal-height tiles.

Above (1700px), the inspector grows to (350px). At or below (1100px), it becomes (290px), while the controls view becomes two columns. At or below (780px), the overview becomes one column: job, temperatures, files when idle, camera, materials, quick controls, then position. Page padding becomes (14px 12px) plus the bottom safe area. File tools wrap; mapping selects get their own row. At or below (370px), navigation icons stack above labels. Confirmation actions stack below Tailwind's default small breakpoint (40rem).

Use the extracted spacing steps for recurring groups; local (7px), (10px), (14px), (17px), and (22px) adjustments also exist. Most buttons have a minimum height of (36px); compact variants use (31px). Jog controls are (44px) high. Avoid treating density as permission to collapse labels or touch controls.

## Elevation & Depth

Depth comes primarily from tonal layering and one-pixel seams. Cards do not float on ambient shadows. Active navigation uses an inset outline; print setup alone adds a diffuse modal shadow (`0 20px 80px #0008`) over the dark backdrop (`#06090dc9`). Native dialogs retain bounded height and internal scrolling.

## Shapes

Small rounded controls and navigation share the control radius; recessed previews and choices use the inset radius; major panels and print setup use the panel radius. Confirmation retains Tailwind's rounded-xl utility (0.75rem). Circles identify status dots and filament swatches, while the light switch uses a pill silhouette. Fine borders stay visible against graphite rather than relying on shadows to suggest clickability.

## Components

- **Buttons:** Filled green primary, graphite secondary, transparent ghost, red-tinted danger, and amber-tinted warning. Shared compact geometry and (150ms) background/border transitions. Disabled buttons reduce opacity to (0.43). The global focus indicator is a green (2px) outline offset by (3px).
- **Fields:** Dark recess, strong border, inherited sans-serif text, muted placeholder. Focus turns the border green; disabled fields use opacity (0.45). Search fields include an inline SVG icon and a focus-within border.
- **Navigation:** Icon-and-label links within horizontal chrome. Active state combines a green-tinted fill, pale green text, and inset stroke. Mobile retains all five destinations.
- **Panels and lists:** Border-separated surfaces with section headings and row seams. Generic padded panels use (22px); inspector sections use (18px). Rows reveal actions without converting the whole row into an ambiguous button.
- **Material sources:** Physical slot labels accompany actual color swatches. Empty slots have dashed swatches. Print setup uses native radios and explicit per-filament selects; selection combines a green stroke and dark green fill.
- **Dialogs:** Print setup and confirmation use native modal dialogs. Filenames wrap. Confirmation focuses a safe cancel action or required input, traps focus, and supports cancellation; destructive actions use their semantic tone.
- **Config backups:** Keep snapshots in a collapsed group separate from working files. Show count and storage size, stack actions on narrow screens, and expose active-job locks in text. Destructive confirmations show a bounded, scrollable filename list and require explicit approval.
- **Icons:** Inline SVG paths with rounded caps/joins and stroke width (1.6), normally (20px), resized for context. Do not substitute text glyphs for controls.
- **Motion:** Short state transitions, not decorative movement. Loading uses a (700ms) linear spinner; reduced-motion preferences collapse animation and transition duration.

## Do's and Don'ts

### Do:

- Do keep plain labels, visible boundaries, and tabular printer readings.
- Do use green for actionable or meaningful state, with text that explains it.
- Do preserve physical filament-slot labels and swatches across overview and print setup.
- Do reflow controls and allow long filenames to wrap on phones.

### Don't:

- Don't reintroduce cream-and-serif styling, decorative printer art, or lifestyle copy.
- Don't communicate warning, error, or connection state through color alone.
- Don't hide active-job locks or replace missing telemetry with reassuring invented readings.
- Don't use a modal shadow as the default treatment for ordinary panels.
