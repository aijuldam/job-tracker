import type { Job, JobStatus } from '../types'
import { StatusPill } from './StatusPill'

const COMPANY_COLORS = [
  'bg-indigo-500',
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-pink-500',
]

function getCompanyColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return COMPANY_COLORS[Math.abs(hash) % COMPANY_COLORS.length]
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

function MatchBadge({ score, reasoning }: { score: number; reasoning?: string }) {
  const color =
    score >= 90
      ? 'bg-green-100 text-green-700 ring-green-200'
      : score >= 80
        ? 'bg-amber-100 text-amber-700 ring-amber-200'
        : score >= 70
          ? 'bg-orange-100 text-orange-700 ring-orange-200'
          : 'bg-red-100 text-red-600 ring-red-200'
  return (
    // group/badge scopes hover to just this element; relative + z-10 lets the
    // tooltip escape the card without needing a portal
    <div className="relative group/badge flex-shrink-0">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ring-1 cursor-default select-none ${color}`}
      >
        {score}% match
      </span>
      {reasoning && (
        <div
          className="absolute right-0 bottom-full mb-2 z-50 w-56 rounded-lg bg-gray-900 p-2.5
            text-white text-xs leading-relaxed shadow-xl
            opacity-0 group-hover/badge:opacity-100 transition-opacity duration-150
            pointer-events-none"
        >
          {/* caret */}
          <span className="absolute right-3 top-full border-4 border-transparent border-t-gray-900" />
          {reasoning}
        </div>
      )}
    </div>
  )
}

const LOCATION_ICONS: Record<string, string> = {
  Amsterdam: '🏙️',
  Remote: '🌍',
  'Amsterdam / Remote': '🏙️ / 🌍',
}

const SIZE_LABELS: Record<string, string> = {
  startup: 'Startup',
  'scale-up': 'Scale-up',
  enterprise: 'Enterprise',
}

interface JobCardProps {
  job: Job
  status: JobStatus
  onCycleStatus: (e: React.MouseEvent) => void
  onClick: () => void
}

export function JobCard({ job, status, onCycleStatus, onClick }: JobCardProps) {
  const color = getCompanyColor(job.company)
  const initials = getInitials(job.company)
  const rejected = status === 'Rejected'

  const daysLabel =
    job.daysPosted === 0
      ? 'Today'
      : job.daysPosted === 1
        ? '1 day ago'
        : `${job.daysPosted}d ago`

  const daysColor =
    job.daysPosted < 7
      ? 'text-green-600 bg-green-50'
      : job.daysPosted < 14
        ? 'text-amber-600 bg-amber-50'
        : 'text-gray-500 bg-gray-50'

  // Salary: show "~" prefix + lighter colour when Claude-estimated
  const salaryDisplay = job.compensation
  const salaryEstimated = Boolean(job.salaryIsEstimated) && job.compensation !== 'Salary not listed'

  return (
    // relative + hover:z-10 ensures the reasoning tooltip floats above sibling cards
    <div
      onClick={onClick}
      className={`group relative z-0 hover:z-10 bg-white rounded-2xl shadow-sm border border-gray-100
        hover:shadow-lg hover:border-indigo-100 hover:-translate-y-0.5
        transition-all duration-200 cursor-pointer flex flex-col gap-0
        ${rejected ? 'opacity-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4 pb-3">
        <div
          className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 text-sm leading-tight group-hover:text-indigo-700 transition-colors">
            {job.title}
          </p>
          <p className="text-gray-500 text-sm mt-0.5">{job.company}</p>
        </div>
        <MatchBadge score={job.matchScore} reasoning={job.reasoning} />
      </div>

      {/* Tags */}
      <div className="px-4 flex flex-wrap gap-1.5 pb-3">
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
          {LOCATION_ICONS[job.location] ?? '📍'} {job.location}
        </span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${daysColor}`}>
          {daysLabel}
        </span>
        {job.daysPosted < 3 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-indigo-600 text-white">
            New
          </span>
        )}
      </div>

      {/* Footer — rounded-b-2xl clips the gray bg to the card corners (overflow-hidden removed) */}
      <div className="px-4 py-3 border-t border-gray-50 mt-auto flex items-center justify-between bg-gray-50/50 rounded-b-2xl">
        <span className={`text-sm font-medium ${salaryEstimated ? 'text-gray-400' : 'text-gray-700'}`}>
          {salaryEstimated ? `~${salaryDisplay}` : salaryDisplay}
        </span>
        <StatusPill status={status} onCycle={onCycleStatus} />
      </div>
    </div>
  )
}
