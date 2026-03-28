import { useState, useCallback } from 'react'
import type { JobStatus } from '../types'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const STORAGE_KEY = 'job-tracker-statuses'

const STATUS_CYCLE: JobStatus[] = [
  'Not applied',
  'Applied',
  'Interviewing',
  'Offer',
  'Rejected',
]

const DB_TO_STATUS: Record<string, JobStatus> = {
  not_applied: 'Not applied',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
}

const STATUS_TO_DB: Record<JobStatus, string> = {
  'Not applied': 'not_applied',
  Applied: 'applied',
  Interviewing: 'interviewing',
  Offer: 'offer',
  Rejected: 'rejected',
}

function loadStatuses(): Record<string, JobStatus> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStatuses(statuses: Record<string, JobStatus>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses))
}

function syncToSupabase(jobId: string, status: JobStatus) {
  if (!isSupabaseConfigured || !supabase) return
  supabase
    .from('jobs')
    .update({ status: STATUS_TO_DB[status] })
    .eq('id', jobId)
    .then(({ error }) => {
      if (error) console.error('Failed to sync status:', error.message)
    })
}

export function useJobStatus() {
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>(loadStatuses)

  const hydrateFromJobs = useCallback((dbJobs: Array<{ id: string; status: string }>) => {
    setStatuses(prev => {
      const next = { ...prev }
      for (const { id, status } of dbJobs) {
        const mapped = DB_TO_STATUS[status]
        if (mapped) next[id] = mapped
      }
      saveStatuses(next)
      return next
    })
  }, [])

  const getStatus = useCallback(
    (jobId: string): JobStatus => statuses[jobId] ?? 'Not applied',
    [statuses],
  )

  const cycleStatus = useCallback((jobId: string) => {
    setStatuses(prev => {
      const current: JobStatus = prev[jobId] ?? 'Not applied'
      const idx = STATUS_CYCLE.indexOf(current)
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
      const updated = { ...prev, [jobId]: next }
      saveStatuses(updated)
      syncToSupabase(jobId, next)
      return updated
    })
  }, [])

  // Direct-set variant used by the panel's status dropdown
  const setStatus = useCallback((jobId: string, status: JobStatus) => {
    setStatuses(prev => {
      if (prev[jobId] === status) return prev
      const updated = { ...prev, [jobId]: status }
      saveStatuses(updated)
      syncToSupabase(jobId, status)
      return updated
    })
  }, [])

  return { getStatus, cycleStatus, setStatus, hydrateFromJobs }
}
