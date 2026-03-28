import type { Job, JobStatus } from '../types'

interface StatsBarProps {
  jobs: Job[]
  getStatus: (id: string) => JobStatus
}

export function StatsBar({ jobs, getStatus }: StatsBarProps) {
  if (jobs.length === 0) return null

  const applied = jobs.filter(j => {
    const s = getStatus(j.id)
    return s === 'Applied' || s === 'Interviewing' || s === 'Offer'
  }).length

  const avgMatch = Math.round(jobs.reduce((acc, j) => acc + j.matchScore, 0) / jobs.length)
  const topMatch = Math.max(...jobs.map(j => j.matchScore))

  const stats = [
    { label: 'Total roles', value: jobs.length },
    { label: 'Applied', value: applied },
    { label: 'Avg match', value: `${avgMatch}%` },
    { label: 'Top match', value: `${topMatch}%` },
  ]

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm px-5 py-3.5">
      <div className="flex items-center divide-x divide-gray-100">
        {stats.map(({ label, value }) => (
          <div key={label} className="flex-1 flex flex-col items-center px-2 first:pl-0 last:pr-0">
            <span className="text-xl font-bold text-gray-900 tabular-nums">{value}</span>
            <span className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
