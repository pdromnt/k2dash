---
version: 1
slug: "src-views-dashboardview-vue"
primary_target: "src/views/DashboardView.vue"
related_targets: ["src/components/layout/AppLayout.vue","src/style.css"]
---

# Dashboard

Mode: Operate. Scope: application shell, overview, file preparation, controls, activity, and console. The user-provided dark workspace reference pins the visual direction; preserve standard web navigation and printer terminology.

## Direction contract

THESIS: A printer workspace with the density and hierarchy of the user's reference. Its layout follows actual print operation rather than a welcome hero or a grid of equal cards.

OWN-WORLD: Graphite application chrome, darker content, near-white sans labels, restrained Creality green for actions and active selection. One compact UI family with tabular measurements. Thin seams separate major work areas; controls use consistent, visible boundaries.

STORY: Identify the printer and connection, inspect the current job or choose a file when idle, check temperatures/material sources, and operate explicit controls. Never imply that an idle printer's bed is physically clear.

FIRST VIEWPORT: Compact top identity bar and horizontal navigation. Overview divides into a broad job/camera column and a narrower inspector containing temperatures, physical CFS slots, light, and fans. Idle replaces job metrics with a compact ready panel and selectable recent files; mobile puts job and temperatures before optional camera and materials.

FORM: User-pinned dark desktop workspace. Earlier concept seed reference: seed:db53701da7495589, superseded by the user's supplied image. Signature interaction: the file-to-CFS mapping keeps the same physical slot labels and colour swatches from overview through print setup.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Validation status

The replacement workspace received a finish review; all four listed corrections were scored resolved. Desktop and mobile previews, confirmation keyboard behavior, and busy/offline locks were checked. DESIGN.md and its sidecar document the built system. No generated raster assets ship with the app.

Native metadata and physical slot selection were verified read-only; actual CFS print execution remains untested. Config-backup cleanup was tested with fixtures and mocked file operations, not real deletions.
