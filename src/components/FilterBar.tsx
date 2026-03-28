import type { Filters, Seniority, CompanySize } from '../types'

const SENIORITY_OPTIONS: Seniority[] = ['Director', 'VP', 'Head of', 'Senior Manager']
const SIZE_OPTIONS: CompanySize[] = ['startup', 'scale-up', 'enterprise']
const DAYS_OPTIONS = [
  { label: '< 7 days', value: '< 7' },
  { label: '7–14 days', value: '7-14' },
  { label: '14–30 days', value: '14-30' },
  { label: '30+ days', value: '30+' },
]
const SCORE_OPTIONS = [
  { label: 'Any match', value: 0 },
  { label: '70%+', value: 70 },
  { label: '80%+', value: 80 },
  { label: '90%+', value: 90 },
]

interface FilterBarProps {
  filters: Filters
  defaultFilters: Filters
  onChange: (f: Filters) => void
  totalCount: number
  filteredCount: number
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className={`chip ${active ? 'chip-active' : 'chip-inactive'}`}>
      {label}
    </button>
  )
}

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
}

export function FilterBar({ filters, defaultFilters, onChange, totalCount, filteredCount }: FilterBarProps) {
  const hasActiveFilters =
    filters.seniority.length > 0 ||
    filters.daysPosted !== null ||
    filters.companySize.length > 0 ||
    filters.hideApplied ||
    filters.minMatchScore > 0 ||
    filters.euHqOnly !== defaultFilters.euHqOnly

  const reset = () => onChange(defaultFilters)

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filters</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {filteredCount === totalCount ? (
              <>{totalCount} roles</>
            ) : (
              <>
                <span className="font-semibold text-indigo-600">{filteredCount}</span>
                <span className="text-gray-400"> / {totalCount} roles</span>
              </>
            )}
          </span>
          {hasActiveFilters && (
            <button
              onClick={reset}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Seniority */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 font-medium mr-1">Level</span>
          {SENIORITY_OPTIONS.map(s => (
            <Chip
              key={s}
              label={s}
              active={filters.seniority.includes(s)}
              onClick={() => onChange({ ...filters, seniority: toggle(filters.seniority, s) })}
            />
          ))}
        </div>

        <div className="w-px bg-gray-100 self-stretch hidden sm:block" />

        {/* Days posted */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 font-medium mr-1">Posted</span>
          {DAYS_OPTIONS.map(d => (
            <Chip
              key={d.value}
              label={d.label}
              active={filters.daysPosted === d.value}
              onClick={() =>
                onChange({ ...filters, daysPosted: filters.daysPosted === d.value ? null : d.value })
              }
            />
          ))}
        </div>

        <div className="w-px bg-gray-100 self-stretch hidden sm:block" />

        {/* Company size */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 font-medium mr-1">Size</span>
          {SIZE_OPTIONS.map(s => (
            <Chip
              key={s}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
              active={filters.companySize.includes(s)}
              onClick={() => onChange({ ...filters, companySize: toggle(filters.companySize, s) })}
            />
          ))}
        </div>

        <div className="w-px bg-gray-100 self-stretch hidden sm:block" />

        {/* Match score */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 font-medium mr-1">Match</span>
          {SCORE_OPTIONS.map(o => (
            <Chip
              key={o.value}
              label={o.label}
              active={filters.minMatchScore === o.value}
              onClick={() => onChange({ ...filters, minMatchScore: o.value })}
            />
          ))}
        </div>

        <div className="w-px bg-gray-100 self-stretch hidden sm:block" />

        {/* Hide applied */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 font-medium mr-1">Status</span>
          <Chip
            label="Hide applied"
            active={filters.hideApplied}
            onClick={() => onChange({ ...filters, hideApplied: !filters.hideApplied })}
          />
        </div>

        <div className="w-px bg-gray-100 self-stretch hidden sm:block" />

        {/* EU HQ only */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 font-medium mr-1">HQ</span>
          <Chip
            label="EU only"
            active={filters.euHqOnly}
            onClick={() => onChange({ ...filters, euHqOnly: !filters.euHqOnly })}
          />
        </div>
      </div>
    </div>
  )
}
