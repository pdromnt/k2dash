/** Shared route, navigation and page-heading metadata. */
interface WorkspacePage {
  id: string
  path: string
  label: string
  icon: string
  heading?: string
  description?: string
}

export const workspacePages: readonly WorkspacePage[] = [
  { id: 'overview', path: '/', label: 'Overview', icon: 'overview' },
  { id: 'files', path: '/files', label: 'Files', icon: 'files',
    heading: 'Files', description: 'G-code files stored on your printer.' },
  { id: 'controls', path: '/printer', label: 'Controls', icon: 'printer',
    heading: 'Printer controls', description: 'Movement, heaters, and maintenance.' },
  { id: 'activity', path: '/activity', label: 'Activity', icon: 'activity',
    heading: 'Activity', description: 'Print history and timelapse recordings.' },
  { id: 'console', path: '/console', label: 'Console', icon: 'console',
    heading: 'Console', description: 'Commands run on the printer immediately.' },
]
