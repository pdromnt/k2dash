// Development-only fixtures. Every network entry point checks this flag before
// opening a connection; preview controls cannot operate a real printer.
export const previewState =
  import.meta.env.DEV && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('preview') || ''
    : ''
export const isPreview = [
  'idle',
  'printing',
  'paused',
  'offline',
  'empty',
].includes(previewState)

export function previewResponse(path: string): unknown {
  if (path.includes('root=config'))
    return {
      result:
        previewState === 'empty'
          ? []
          : [
              {
                path: 'printer.cfg',
                size: 10240,
                modified: 1793491200,
                permissions: 'rw',
              },
              {
                path: 'gcode_macro.cfg',
                size: 64512,
                modified: 1793491200,
                permissions: 'rw',
              },
              ...Array.from({ length: 8 }, (_, i) => ({
                path: `printer-202610${String(i + 1).padStart(2, '0')}_194632.cfg`,
                size: 10240,
                modified: 1790900000 + i * 86400,
                permissions: 'rw',
              })),
            ],
    }
  if (path.startsWith('/server/files/config/'))
    return decodeURIComponent(path).endsWith('/printer.cfg')
      ? '[include gcode_macro.cfg]\n[include printer-20261002_194632.cfg]\n'
      : '# Preview configuration\n'
  if (path.includes('/files/list'))
    return {
      result:
        previewState === 'empty'
          ? []
          : [
              {
                path: 'Workshop organizer.gcode',
                size: 18204512,
                modified: 1793721600,
                permissions: 'rw',
              },
              {
                path: 'Cable guide — PETG.gcode',
                size: 4038000,
                modified: 1793635200,
                permissions: 'rw',
              },
              {
                path: 'Desk planter.gcode',
                size: 9068000,
                modified: 1793548800,
                permissions: 'rw',
              },
            ],
    }
  if (path.includes('/history/list'))
    return {
      result: {
        jobs:
          previewState === 'empty'
            ? []
            : [
                {
                  job_id: 'preview-1',
                  filename: 'Cable guide — PETG.gcode',
                  status: 'completed',
                  start_time: 1793635200,
                  print_duration: 6720,
                  filament_used: 12400,
                },
                {
                  job_id: 'preview-2',
                  filename: 'Desk planter.gcode',
                  status: 'completed',
                  start_time: 1793548800,
                  print_duration: 19440,
                  filament_used: 46800,
                },
              ],
      },
    }
  throw new Error('This capability is unavailable in preview mode')
}
