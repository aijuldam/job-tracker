import { useState, useMemo, useEffect, useCallback } from 'react'
import type { Tab, Job, Filters, JobStatus, Seniority, CompanySize } from './types'
import { productMarketingJobs, financeJobs } from './data/jobs'
import { useJobStatus } from './hooks/useJobStatus'
import { JobCard } from './components/JobCard'
import { JobPanel } from './components/JobPanel'
import { FilterBar } from './components/FilterBar'
import { StatsBar } from './components/StatsBar'
import { supabase, isSupabaseConfigured } from './lib/supabase'

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'product-marketing', label: 'Product Marketing', emoji: '📣' },
  { id: 'finance', label: 'Finance', emoji: '📊' },
]

const TAB_TO_DB: Record<Tab, string> = { 'product-marketing': 'pmm', finance: 'finance' }
const MOCK_JOBS: Record<Tab, Job[]> = { 'product-marketing': productMarketingJobs, finance: financeJobs }

// ── Default filters (tab-specific) ───────────────────────────────────────────

const BASE_FILTERS = { seniority: [] as Seniority[], daysPosted: null, companySize: [] as CompanySize[], hideApplied: false, minMatchScore: 0 }
const TAB_DEFAULTS: Record<Tab, Filters> = {
  'product-marketing': { ...BASE_FILTERS, euHqOnly: true },
  finance: { ...BASE_FILTERS, euHqOnly: false },
}

// ── EU HQ filter ──────────────────────────────────────────────────────────────
// Word-based matching: splits company name into words and checks against known US-HQ companies.
// Tuned for Amsterdam job market — adjust freely.

const US_HQ_WORDS = new Set([
  'google', 'alphabet', 'meta', 'facebook', 'instagram', 'amazon', 'aws',
  'microsoft', 'apple', 'salesforce', 'twitter', 'netflix', 'uber', 'airbnb',
  'hubspot', 'workday', 'servicenow', 'adobe', 'oracle', 'ibm', 'twilio',
  'zendesk', 'zoom', 'docusign', 'okta', 'datadog', 'snowflake', 'stripe',
  'dropbox', 'palantir', 'elastic', 'mongodb', 'atlassian', 'shopify',
  'gitlab', 'github', 'figma', 'notion', 'airtable', 'intercom', 'mixpanel',
  'amplitude', 'braze', 'klaviyo', 'marketo', 'vmware', 'cisco', 'qualcomm',
  'intel', 'nvidia', 'lyft', 'doordash', 'cloudflare', 'splunk', 'pagerduty',
])

function isUSHQ(company: string): boolean {
  const words = company.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  return words.some(w => US_HQ_WORDS.has(w))
}

// ── Hard filters (deterministic scan-ingest rules) ───────────────────────────

type FilterCode =
  | 'EXPIRED_7D' | 'SALARY_OVER_CAP' | 'PMM_NOT_LEADERSHIP'
  | 'FINANCE_FPANDA' | 'FINANCE_NOT_ACCOUNTING_CTRL' | 'OUTSIDE_GEO'

const SALARY_CAP: Record<Tab, number> = { 'product-marketing': 120_000, finance: 95_000 }

const PMM_LEADERSHIP_KW = ['head of', 'director', 'vp ', 'vice president', 'cmo', 'chief marketing', 'principal', 'staff product marketing', 'product marketing lead']
const PMM_EXCEPTION_COS = new Set(['booking.com', 'uber'])

function passesPmmSeniority(job: Job): boolean {
  const t = job.title.toLowerCase()
  if (PMM_LEADERSHIP_KW.some(kw => t.includes(kw))) return true
  if (PMM_EXCEPTION_COS.has(job.company.toLowerCase()) && t.includes('senior')) return true
  return false
}

const FINANCE_OK_KW = ['controller', 'controlling', 'accounting', 'accountant', 'finance manager', 'accounting manager']
const FINANCE_EXCL_KW = ["fp&a", 'financial planning', 'strategic finance', 'financial planning and analysis']

function passesFinanceScope(job: Job): boolean {
  const haystack = (job.title + ' ' + (job.reasoning ?? '')).toLowerCase()
  if (FINANCE_EXCL_KW.some(kw => haystack.includes(kw))) return false   // FINANCE_FPANDA
  return FINANCE_OK_KW.some(kw => job.title.toLowerCase().includes(kw))  // FINANCE_NOT_ACCOUNTING_CTRL
}

function hardFilterCode(job: Job, tab: Tab): FilterCode | null {
  if (job.daysPosted > 7) return 'EXPIRED_7D'
  const cap = SALARY_CAP[tab]
  if (job.salaryMax && !job.salaryIsEstimated && job.salaryMax > cap) return 'SALARY_OVER_CAP'
  if (tab === 'product-marketing' && !passesPmmSeniority(job)) return 'PMM_NOT_LEADERSHIP'
  if (tab === 'finance' && !passesFinanceScope(job)) return 'FINANCE_FPANDA'
  return null
}

function applyHardFilters(jobs: Job[], tab: Tab): Job[] {
  return jobs.filter(job => hardFilterCode(job, tab) === null)
}

// ── DB row → Job ──────────────────────────────────────────────────────────────

const SENIORITY_MAP: Record<string, Seniority> = {
  Director: 'Director', VP: 'VP', 'Head of': 'Head of', 'Senior Manager': 'Senior Manager',
}
function normalizeSeniority(s: string | null): Seniority {
  return (s && SENIORITY_MAP[s]) ? SENIORITY_MAP[s] : 'Senior Manager'
}
function normalizeCompanySize(s: string | null): CompanySize {
  if (s === 'startup' || s === 'scale-up' || s === 'enterprise') return s
  return 'scale-up'
}
function computeDaysPosted(postedDate: string | null): number {
  if (!postedDate) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(postedDate).getTime()) / 86_400_000))
}
function buildCompensation(min: number | null, max: number | null): string {
  if (min && max) return `€${Math.round(min / 1000)}k – €${Math.round(max / 1000)}k`
  if (min) return `€${Math.round(min / 1000)}k+`
  return 'Salary not listed'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDbRow(row: Record<string, any>): Job {
  return {
    id: row.id as string,
    title: row.title as string,
    company: row.company as string,
    url: row.url as string,
    location: (row.location as string) ?? 'Amsterdam',
    seniority: normalizeSeniority(row.seniority_level as string | null),
    industry: (row.industry as string) ?? 'Technology',
    companySize: normalizeCompanySize(row.company_size as string | null),
    daysPosted: computeDaysPosted(row.posted_date as string | null),
    compensation: buildCompensation(row.salary_min as number | null, row.salary_max as number | null),
    matchScore: (row.match_score as number) ?? 50,
    salaryMin: (row.salary_min as number) ?? undefined,
    salaryMax: (row.salary_max as number) ?? undefined,
    salaryIsEstimated: Boolean(row.salary_is_estimated),
    source: row.source as Job['source'],
    notes: (row.notes as string) ?? undefined,
    reasoning: (row.reasoning as string) ?? undefined,
    dateApplied: (row.date_applied as string) ?? undefined,
  }
}

// ── Filter + sort ─────────────────────────────────────────────────────────────

function filterJobs(jobs: Job[], filters: Filters, getStatus: (id: string) => JobStatus): Job[] {
  return jobs.filter(job => {
    if (filters.seniority.length > 0 && !filters.seniority.includes(job.seniority)) return false

    if (filters.daysPosted) {
      const d = job.daysPosted
      if (filters.daysPosted === '< 7' && d >= 7) return false
      if (filters.daysPosted === '7-14' && (d < 7 || d > 14)) return false
      if (filters.daysPosted === '14-30' && (d < 14 || d > 30)) return false
      if (filters.daysPosted === '30+' && d <= 30) return false
    }

    if (filters.companySize.length > 0 && !filters.companySize.includes(job.companySize)) return false
    if (filters.hideApplied && getStatus(job.id) === 'Applied') return false
    if (job.matchScore < filters.minMatchScore) return false
    if (filters.euHqOnly && isUSHQ(job.company)) return false

    return true
  })
}

// Sort: Rejected cards go to the bottom
function sortJobs(jobs: Job[], getStatus: (id: string) => JobStatus): Job[] {
  return [...jobs].sort((a, b) => {
    const aR = getStatus(a.id) === 'Rejected' ? 1 : 0
    const bR = getStatus(b.id) === 'Rejected' ? 1 : 0
    return aR - bR
  })
}

function formatLastUpdated(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('product-marketing')
  const [filters, setFilters] = useState<Filters>(TAB_DEFAULTS['product-marketing'])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [jobs, setJobs] = useState<Job[]>(MOCK_JOBS['product-marketing'])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const { getStatus, cycleStatus, setStatus, hydrateFromJobs } = useJobStatus()

  const fetchJobs = useCallback(
    async (tab: Tab) => {
      if (!isSupabaseConfigured || !supabase) {
        setJobs(MOCK_JOBS[tab])
        return
      }
      setLoading(true)
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('tab', TAB_TO_DB[tab])
        .order('match_score', { ascending: false })

      if (error) {
        console.error('Supabase fetch error:', error.message)
        setJobs(MOCK_JOBS[tab])
      } else if (data && data.length > 0) {
        setJobs(data.map(mapDbRow))
        hydrateFromJobs(data.map(r => ({ id: r.id as string, status: r.status as string })))
        setLastUpdated(new Date())
      } else {
        // Supabase is configured but no jobs yet — show empty state, not fake data
        setJobs([])
      }
      setLoading(false)
    },
    [hydrateFromJobs],
  )

  useEffect(() => { fetchJobs(activeTab) }, [activeTab, fetchJobs])

  // Allow JobPanel to patch a job in both the list and the selected state
  const handleJobUpdate = useCallback((id: string, patch: Partial<Job>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j))
    setSelectedJob(prev => prev?.id === id ? { ...prev, ...patch } : prev)
  }, [])

  const filteredJobs = useMemo(
    () => filterJobs(applyHardFilters(jobs, activeTab), filters, getStatus),
    [jobs, filters, getStatus, activeTab],
  )

  const displayJobs = useMemo(
    () => sortJobs(filteredJobs, getStatus),
    [filteredJobs, getStatus],
  )

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    setFilters(TAB_DEFAULTS[tab])
    setSelectedJob(null)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-6 h-14">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <span className="font-bold text-gray-900 text-sm tracking-tight">Job Tracker</span>
            </div>

            <nav className="flex gap-1">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <span>{tab.emoji}</span>
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
              {!loading && lastUpdated && (
                <span className="text-xs text-gray-400">Updated {formatLastUpdated(lastUpdated)}</span>
              )}
              {!loading && !lastUpdated && !isSupabaseConfigured && (
                <span className="text-xs text-amber-500">Demo data</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        <StatsBar jobs={jobs} getStatus={getStatus} />

        <FilterBar
          filters={filters}
          defaultFilters={TAB_DEFAULTS[activeTab]}
          onChange={setFilters}
          totalCount={jobs.length}
          filteredCount={filteredJobs.length}
        />

        {displayJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            {/* Empty-state illustration */}
            <svg
              viewBox="0 0 160 130"
              className="w-36 h-28 mb-6"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Document */}
              <rect x="30" y="18" width="100" height="90" rx="8" fill="#F1F5F9" stroke="#E2E8F0" strokeWidth="1.5" />
              {/* Clip top */}
              <rect x="55" y="12" width="50" height="14" rx="5" fill="#E2E8F0" />
              {/* Lines */}
              <rect x="44" y="42" width="72" height="5" rx="2.5" fill="#E2E8F0" />
              <rect x="44" y="54" width="56" height="5" rx="2.5" fill="#E2E8F0" />
              <rect x="44" y="66" width="64" height="5" rx="2.5" fill="#E2E8F0" />
              <rect x="44" y="78" width="44" height="5" rx="2.5" fill="#E2E8F0" />
              {/* Magnifying glass circle (white fill so it overlaps lines) */}
              <circle cx="108" cy="88" r="21" fill="white" stroke="#CBD5E1" strokeWidth="2" />
              <circle cx="108" cy="88" r="13" fill="#F8FAFC" stroke="#94A3B8" strokeWidth="1.5" />
              {/* Handle */}
              <line x1="118" y1="99" x2="130" y2="112" stroke="#94A3B8" strokeWidth="3" strokeLinecap="round" />
              {/* × inside glass */}
              <line x1="103" y1="83" x2="113" y2="93" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
              <line x1="113" y1="83" x2="103" y2="93" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-gray-700 font-semibold text-lg">No roles match your filters</p>
            <p className="text-gray-400 text-sm mt-1">Try clearing some filters to see more results.</p>
            <button
              onClick={() => setFilters(TAB_DEFAULTS[activeTab])}
              className="mt-4 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-sm font-medium hover:bg-indigo-100 transition-colors"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayJobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                status={getStatus(job.id)}
                onCycleStatus={e => { e.stopPropagation(); cycleStatus(job.id) }}
                onClick={() => setSelectedJob(job)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Side panel */}
      {selectedJob && (
        <JobPanel
          job={selectedJob}
          status={getStatus(selectedJob.id)}
          onSetStatus={s => setStatus(selectedJob.id, s)}
          onJobUpdate={handleJobUpdate}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  )
}
