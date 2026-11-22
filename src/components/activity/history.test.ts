import { describe, expect, it } from 'vitest'
import type { HistoryJob } from '@/api/moonraker'
import { findActiveHistoryJobId } from './history'

const job = (job_id: string, filename: string, start_time: number): HistoryJob => ({
  job_id, filename, start_time, status: 'in_progress',
  end_time: 0, total_duration: 0, print_duration: 0, filament_used: 0,
})

describe('active history reconciliation', () => {
  const jobs = [
    job('orphan', 'old.gcode', 200),
    job('current', 'folder/current.gcode', 100),
  ]

  it('matches the printer filename instead of the newest orphan', () => {
    expect(findActiveHistoryJobId(jobs, 'current.gcode', true)).toBe('current')
  })

  it('does not invent an active row when the matching job has not arrived', () => {
    expect(findActiveHistoryJobId(jobs, 'new.gcode', true)).toBeNull()
    expect(findActiveHistoryJobId(jobs, '', true)).toBeNull()
  })

  it('has no active row when the printer is idle', () => {
    expect(findActiveHistoryJobId(jobs, 'current.gcode', false)).toBeNull()
  })
})
