import { useState, useCallback, useEffect, useRef } from 'react'
import type { Job, JobStatus } from '../types'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const COMPANY_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
  'bg-rose-500', 'bg-amber-500', 'bg-teal-500', 'bg-pink-500',
]
function getCompanyColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return COMPANY_COLORS[Math.abs(hash) % COMPANY_COLORS.length]
}
function getInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

const ALL_STATUSES: JobStatus[] = ['Not applied', 'Applied', 'Interviewing', 'Offer', 'Rejected']

const STATUS_SELECT_STYLES: Record<JobStatus, string> = {
  'Not applied': 'text-gray-600',
  Applied: 'text-blue-600',
  Interviewing: 'text-amber-600',
  Offer: 'text-green-600',
  Rejected: 'text-red-600',
}

const MATCH_COLOR = (s: number) =>
  s >= 90 ? 'bg-green-100 text-green-700 ring-green-200'
  : s >= 80 ? 'bg-amber-100 text-amber-700 ring-amber-200'
  : s >= 70 ? 'bg-orange-100 text-orange-700 ring-orange-200'
  : 'bg-red-100 text-red-600 ring-red-200'

const SIZE_LABELS: Record<string, string> = {
  startup: 'Startup', 'scale-up': 'Scale-up', enterprise: 'Enterprise',
}

interface JobPanelProps {
  job: Job
  status: JobStatus
  onSetStatus: (status: JobStatus) => void
  onJobUpdate: (id: string, patch: Partial<Job>) => void
  onClose: () => void
}

type PanelView = 'details' | 'iframe'

export function JobPanel({ job, status, onSetStatus, onJobUpdate, onClose }: JobPanelProps) {
  const [view, setView] = useState<PanelView>('details')
  const [iframeBlocked, setIframeBlocked] = useState(false)
  const [notes, setNotes] = useState(job.notes ?? '')
  const [dateApplied, setDateApplied] = useState(job.dateApplied ?? '')
  const [noteSaved, setNoteSaved] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Reset local state whenever a different job is opened
  useEffect(() => {
    setView('details')
    setNotes(job.notes ?? '')
    setDateApplied(job.dateApplied ?? '')
    setNoteSaved(false)
    setIframeBlocked(false)
  }, [job.id, job.notes, job.dateApplied])

  // Escape: close iframe view first, then panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (view === 'iframe') setView('details')
      else onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view, onClose])

  // Detect iframe block (4 s timeout)
  useEffect(() => {
    if (view !== 'iframe') return
    const t = setTimeout(() => {
      try {
        const doc = iframeRef.current?.contentDocument
        if (!doc || doc.location.href === 'about:blank') setIframeBlocked(true)
      } catch {
        // cross-origin = loaded OK
      }
    }, 4000)
    return () => clearTimeout(t)
  }, [view])

  const saveNotes = useCallback(
    async (value: string) => {
      onJobUpdate(job.id, { notes: value })
      if (!isSupabaseConfigured || !supabase) return
      const { error } = await supabase.from('jobs').update({ notes: value }).eq('id', job.id)
      if (!error) {
        setNoteSaved(true)
        setTimeout(() => setNoteSaved(false), 2000)
      }
    },
    [job.id, onJobUpdate],
  )

  const saveDateApplied = useCallback(
    async (value: string) => {
      setDateApplied(value)
      onJobUpdate(job.id, { dateApplied: value || undefined })
      if (!isSupabaseConfigured || !supabase) return
      await supabase
        .from('jobs')
        .update({ date_applied: value || null })
        .eq('id', job.id)
    },
    [job.id, onJobUpdate],
  )

  const handleStatusChange = useCallback(
    (newStatus: JobStatus) => {
      onSetStatus(newStatus)
      // Auto-fill today's date when first marking as Applied
      if (newStatus === 'Applied' && !dateApplied) {
        const today = new Date().toISOString().split('T')[0]
        saveDateApplied(today)
      }
    },
    [onSetStatus, dateApplied, saveDateApplied],
  )

  const daysLabel =
    job.daysPosted === 0 ? 'Today'
    : job.daysPosted === 1 ? '1 day ago'
    : `${job.daysPosted}d ago`

  const salaryDisplay =
    job.compensation !== 'Salary not listed'
      ? job.salaryIsEstimated ? `~${job.compensation} (est.)` : job.compensation
      : null

  const color = getCompanyColor(job.company)
  const initials = getInitials(job.company)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[480px] z-50 bg-white shadow-2xl flex flex-col">

        {/* ── DETAILS VIEW ─────────────────────────────────────────────── */}
        {view === 'details' && (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 leading-tight">{job.title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{job.company}</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
              >
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">
              {/* Metadata */}
              <div className="px-5 pt-4 pb-4">
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700">
                    {job.seniority}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700">
                    {job.industry}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-orange-50 text-orange-700">
                    {SIZE_LABELS[job.companySize] ?? job.companySize}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-sky-50 text-sky-700">
                    {job.location}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-50 text-gray-500">
                    {daysLabel}
                  </span>
                </div>

                {salaryDisplay && (
                  <p className={`text-sm font-semibold mb-3 ${job.salaryIsEstimated ? 'text-gray-400' : 'text-gray-800'}`}>
                    {salaryDisplay}
                  </p>
                )}

                {/* Match score + reasoning */}
                <div className="flex items-start gap-2.5">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ring-1 flex-shrink-0 ${MATCH_COLOR(job.matchScore)}`}>
                    {job.matchScore}% match
                  </span>
                  {job.reasoning && (
                    <p className="text-xs text-gray-500 leading-relaxed pt-0.5">{job.reasoning}</p>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 mx-5" />

              {/* CRM */}
              <div className="px-5 pt-4 pb-6 flex flex-col gap-5">
                {/* Status */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Application status
                  </label>
                  <select
                    value={status}
                    onChange={e => handleStatusChange(e.target.value as JobStatus)}
                    className={`w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold
                      focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer
                      ${STATUS_SELECT_STYLES[status]}`}
                  >
                    {ALL_STATUSES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Date applied (only when status = Applied) */}
                {status === 'Applied' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Date applied
                    </label>
                    <input
                      type="date"
                      value={dateApplied}
                      onChange={e => saveDateApplied(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700
                        focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                )}

                {/* Notes */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Notes
                    </label>
                    {noteSaved && (
                      <span className="text-xs text-green-500 font-medium">Saved ✓</span>
                    )}
                  </div>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    onBlur={e => saveNotes(e.target.value)}
                    placeholder="Recruiter name, next steps, salary details, follow-up date…"
                    rows={5}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700
                      placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300
                      resize-none leading-relaxed"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0 bg-white">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl
                  bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open job posting
              </a>
              <button
                onClick={() => { setView('iframe'); setIframeBlocked(false) }}
                className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Preview site
              </button>
            </div>
          </>
        )}

        {/* ── IFRAME VIEW ──────────────────────────────────────────────── */}
        {view === 'iframe' && (
          <>
            {/* Iframe header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0 bg-white">
              <button
                onClick={() => setView('details')}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <span className="flex-1 text-sm font-medium text-gray-700 truncate">{job.company}</span>
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                Open in tab
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>

            {/* Iframe body */}
            <div className="flex-1 relative bg-gray-50">
              {iframeBlocked ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
                    <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">This site blocks embedding</p>
                    <p className="text-gray-500 text-sm mt-1">Open the posting directly in a new tab.</p>
                  </div>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    Open {job.company} careers →
                  </a>
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  src={job.url}
                  title={`${job.title} at ${job.company}`}
                  className="w-full h-full border-0"
                  onError={() => setIframeBlocked(true)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
