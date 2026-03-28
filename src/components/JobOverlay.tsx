import { useEffect, useRef, useState } from 'react'
import type { Job, JobStatus } from '../types'
import { StatusPill } from './StatusPill'

interface JobOverlayProps {
  job: Job
  status: JobStatus
  onCycleStatus: (e: React.MouseEvent) => void
  onClose: () => void
}

export function JobOverlay({ job, status, onCycleStatus, onClose }: JobOverlayProps) {
  const [iframeBlocked, setIframeBlocked] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Detect if iframe fails to load (e.g. X-Frame-Options)
  // We use a timer: if the iframe doesn't report a load within 5s, show fallback
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        // If contentDocument is null or about:blank, it was blocked
        const doc = iframeRef.current?.contentDocument
        if (!doc || doc.location.href === 'about:blank') {
          setIframeBlocked(true)
        }
      } catch {
        // Cross-origin access denied = site loaded but blocked embedding
        // That's fine — it means the iframe DID load, just cross-origin
      }
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 flex flex-col h-full max-w-6xl w-full mx-auto my-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 bg-white flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{job.title}</p>
            <p className="text-sm text-gray-500">{job.company}</p>
          </div>
          <StatusPill status={status} onCycle={onCycleStatus} />
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open in tab
          </a>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 relative bg-gray-50">
          {iframeBlocked ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-lg">This site blocks embedding</p>
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
      </div>
    </div>
  )
}
