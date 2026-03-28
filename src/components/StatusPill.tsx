import type { JobStatus } from '../types'

const STATUS_STYLES: Record<JobStatus, string> = {
  'Not applied': 'bg-gray-100 text-gray-600 hover:bg-gray-200',
  Applied: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
  Interviewing: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
  Offer: 'bg-green-100 text-green-700 hover:bg-green-200',
  Rejected: 'bg-red-100 text-red-600 hover:bg-red-200',
}

interface StatusPillProps {
  status: JobStatus
  onCycle: (e: React.MouseEvent) => void
}

export function StatusPill({ status, onCycle }: StatusPillProps) {
  return (
    <button
      onClick={onCycle}
      title="Click to change status"
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer select-none ${STATUS_STYLES[status]}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </button>
  )
}
